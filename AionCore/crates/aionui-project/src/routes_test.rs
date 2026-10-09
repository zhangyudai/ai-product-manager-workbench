//! Route-level tests for the project control plane: response shape,
//! attach idempotency (focus / duplicate / overlap), remove semantics, and
//! error-code mapping. Uses a real in-memory DB store + a fresh tempdir
//! workspace, exercised through the axum router via `oneshot`.

// `ApiError` is the type under test in the wire-mapping cases below.
#![allow(clippy::disallowed_types)]

use std::sync::Arc;

use aionui_common::ApiError;
use aionui_db::{Database, IProjectStore, SqliteProjectStore, init_database, init_database_memory};
use axum::Router;
use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::response::IntoResponse;
use http_body_util::BodyExt;
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::ServiceExt;

use super::{ProjectRouterState, project_routes};
use crate::ProjectService;
use crate::canonical::to_file_uri;
use crate::types::ProjectError;

/// Build a router over an in-memory-DB `ProjectService` with a fresh tempdir
/// registered as the standard (workspace) project. Returns the project_id, the
/// workspace pe_id, and the tempdir + Database (kept alive for the test).
async fn setup() -> (Router, String, String, TempDir, Database) {
    let db = init_database_memory().await.unwrap();
    let store: Arc<dyn IProjectStore> = Arc::new(SqliteProjectStore::new(db.pool().clone()));
    let service = Arc::new(ProjectService::new(Arc::clone(&store), std::env::temp_dir()));

    let dir = tempfile::tempdir().unwrap();
    let created = service
        .create_standard("system_default_user", to_file_uri(dir.path()).unwrap())
        .await
        .unwrap();
    let project_id = created.project.project_id;
    let workspace_pe_id = created.project_explorer.pe_id;

    // Handlers extract `Extension<CurrentUser>`; production wiring injects it
    // via the auth middleware — tests inject the seeded default user directly.
    let router =
        project_routes(ProjectRouterState { project: service }).layer(axum::Extension(aionui_auth::CurrentUser {
            id: "system_default_user".to_owned(),
            username: "admin".to_owned(),
            user_type: aionui_db::UserType::Local,
            status: aionui_db::UserStatus::Active,
        }));
    (router, project_id, workspace_pe_id, dir, db)
}

/// Fire one request through the router and return `(status, parsed_body)`.
/// An empty body (e.g. 204) parses to `Value::Null`.
async fn send(router: &Router, method: &str, uri: &str, body: Option<Value>) -> (StatusCode, Value) {
    let builder = Request::builder().method(method).uri(uri);
    let request = match body {
        Some(v) => builder
            .header("content-type", "application/json")
            .body(Body::from(v.to_string()))
            .unwrap(),
        None => builder.body(Body::empty()).unwrap(),
    };
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let parsed = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes).unwrap()
    };
    (status, parsed)
}

fn folders_url(project_id: &str) -> String {
    format!("/api/projects/{project_id}/folders")
}

/// Render the `From<ProjectError> for ApiError` wire mapping to `(status,
/// body)`. These errors are produced by `resolve_chat_message` (called from
/// conversation/team), not by any route in this crate's router, so the mapping
/// arc — HTTP status + stable `code` string the frontend branches on — must be
/// asserted directly rather than through a request.
async fn map_error(err: ProjectError) -> (StatusCode, Value) {
    let response = ApiError::from(err).into_response();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let body: Value = serde_json::from_slice(&bytes).unwrap();
    (status, body)
}

#[tokio::test]
async fn local_path_not_readable_maps_to_400_with_stable_code() {
    let (status, body) = map_error(ProjectError::LocalPathNotReadable {
        path: "/host/file".into(),
    })
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "local_path_not_readable");
    assert_eq!(body["success"], false);
}

#[tokio::test]
async fn upload_path_outside_root_maps_to_400_with_stable_code() {
    let (status, body) = map_error(ProjectError::UploadPathOutsideRoot {
        path: "/outside/root".into(),
    })
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "upload_path_outside_root");
    assert_eq!(body["success"], false);
}

#[tokio::test]
async fn get_project_returns_workspace_root() {
    let (router, project_id, workspace_pe_id, _dir, _db) = setup().await;

    let (status, body) = send(&router, "GET", &format!("/api/projects/{project_id}"), None).await;
    assert_eq!(status, StatusCode::OK);

    let data = &body["data"];
    assert_eq!(data["project_id"], project_id);
    let entries = data["explorer"]["entries"].as_array().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["role"], "workspace");
    assert_eq!(entries[0]["pe_id"], workspace_pe_id);
    assert_eq!(data["explorer"]["workspace_pe_id"], workspace_pe_id);
    assert_eq!(entries[0]["runtime_status"], "available");
    // display_path is derived + non-empty; absolute path / canonical are absent.
    assert!(!entries[0]["display_path"].as_str().unwrap().is_empty());
    assert!(entries[0].get("resource_canonical").is_none());
    assert!(entries[0].get("resource_uri").is_none());
    assert!(entries[0].get("folder_id").is_none());
}

#[tokio::test]
async fn get_project_not_found_returns_domain_code() {
    let (router, _pid, _ws, _dir, _db) = setup().await;

    let (status, body) = send(&router, "GET", "/api/projects/does-not-exist", None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "project_not_found");
    assert_eq!(body["success"], false);
}

#[tokio::test]
async fn project_lifecycle_lists_renames_and_updates_recent_order() {
    let (router, first_id, _ws, _first_dir, _db) = setup().await;
    let second_dir = tempfile::tempdir().unwrap();

    let (status, created) = send(
        &router,
        "POST",
        "/api/projects",
        Some(json!({
            "name": "第二个产品",
            "workspace_uri": to_file_uri(second_dir.path()).unwrap()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let second_id = created["data"]["project_id"].as_str().unwrap().to_owned();
    assert_eq!(created["data"]["name"], "第二个产品");

    let (status, list) = send(&router, "GET", "/api/projects", None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(list["data"].as_array().unwrap().len(), 2);
    assert_eq!(list["data"][0]["project_id"], second_id);
    assert!(!list["data"][0]["workspace_path"].as_str().unwrap().is_empty());

    let (status, renamed) = send(
        &router,
        "PATCH",
        &format!("/api/projects/{first_id}/name"),
        Some(json!({ "name": "  新项目名称  " })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(renamed["data"]["name"], "新项目名称");

    tokio::time::sleep(std::time::Duration::from_millis(2)).await;
    let (status, opened) = send(&router, "POST", &format!("/api/projects/{first_id}/open"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(opened["data"]["project_id"], first_id);

    let (_status, reordered) = send(&router, "GET", "/api/projects", None).await;
    assert_eq!(reordered["data"][0]["project_id"], first_id);
}

#[tokio::test]
async fn create_and_rename_reject_blank_project_names() {
    let (router, project_id, _ws, _dir, _db) = setup().await;
    let other_dir = tempfile::tempdir().unwrap();

    let (status, body) = send(
        &router,
        "POST",
        "/api/projects",
        Some(json!({
            "name": "   ",
            "workspace_uri": to_file_uri(other_dir.path()).unwrap()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "invalid_project_name");

    let (status, body) = send(
        &router,
        "PATCH",
        &format!("/api/projects/{project_id}/name"),
        Some(json!({ "name": "" })),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "invalid_project_name");
}

#[tokio::test]
async fn requirement_confirmation_gates_prd_and_survives_reopen() {
    let (router, project_id, _ws, dir, _db) = setup().await;
    let analysis_url = format!("/api/projects/{project_id}/requirement-analysis");
    let prd_url = format!("/api/projects/{project_id}/prd");

    let (status, blocked) = send(
        &router,
        "PUT",
        &prd_url,
        Some(json!({ "title": "PRD", "content": "正文" })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(blocked["code"], "requirement_analysis_not_confirmed");

    let (status, draft) = send(
        &router,
        "PUT",
        &analysis_url,
        Some(json!({ "source_text": "原始想法", "content": "## 产品目标\n提高效率" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(draft["data"]["status"], "draft");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("docs").join("需求分析.md")).unwrap(),
        "## 产品目标\n提高效率"
    );

    let (status, confirmed) = send(&router, "POST", &format!("{analysis_url}/confirm"), None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(confirmed["data"]["status"], "confirmed");
    assert!(confirmed["data"]["confirmed_at"].is_number());

    let (status, saved_prd) = send(
        &router,
        "PUT",
        &prd_url,
        Some(json!({ "title": "产品 PRD", "content": "# 产品 PRD\n已确认内容" })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(saved_prd["data"]["title"], "产品 PRD");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("docs").join("PRD.md")).unwrap(),
        "# 产品 PRD\n已确认内容\n"
    );

    let (status, reopened) = send(&router, "GET", &prd_url, None).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(reopened["data"]["content"], "# 产品 PRD\n已确认内容");

    let (_status, edited) = send(
        &router,
        "PUT",
        &analysis_url,
        Some(json!({ "source_text": "原始想法", "content": "## 产品目标\n改过" })),
    )
    .await;
    assert_eq!(edited["data"]["status"], "draft");
    assert_eq!(
        std::fs::read_to_string(dir.path().join("docs").join("需求分析.md")).unwrap(),
        "## 产品目标\n改过"
    );
}

#[tokio::test]
async fn workflow_data_is_isolated_between_projects() {
    let (router, first_id, _ws, _dir, _db) = setup().await;
    let second_dir = tempfile::tempdir().unwrap();
    let (_status, second) = send(
        &router,
        "POST",
        "/api/projects",
        Some(json!({
            "name": "另一个项目",
            "workspace_uri": to_file_uri(second_dir.path()).unwrap()
        })),
    )
    .await;
    let second_id = second["data"]["project_id"].as_str().unwrap();

    let (_status, _) = send(
        &router,
        "PUT",
        &format!("/api/projects/{first_id}/requirement-analysis"),
        Some(json!({ "source_text": "A", "content": "仅属于 A" })),
    )
    .await;
    let (status, second_analysis) = send(
        &router,
        "GET",
        &format!("/api/projects/{second_id}/requirement-analysis"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert!(second_analysis["data"].is_null());
}

#[tokio::test]
async fn project_reads_are_isolated_by_user() {
    let db = init_database_memory().await.unwrap();
    let store: Arc<dyn IProjectStore> = Arc::new(SqliteProjectStore::new(db.pool().clone()));
    let service = Arc::new(ProjectService::new(Arc::clone(&store), std::env::temp_dir()));
    let dir = tempfile::tempdir().unwrap();
    let created = service
        .create_standard("system_default_user", to_file_uri(dir.path()).unwrap())
        .await
        .unwrap();
    let project_id = created.project.project_id;

    let router =
        project_routes(ProjectRouterState { project: service }).layer(axum::Extension(aionui_auth::CurrentUser {
            id: "another-user".to_owned(),
            username: "other".to_owned(),
            user_type: aionui_db::UserType::Local,
            status: aionui_db::UserStatus::Active,
        }));

    let (status, list) = send(&router, "GET", "/api/projects", None).await;
    assert_eq!(status, StatusCode::OK);
    assert!(list["data"].as_array().unwrap().is_empty());

    let (status, body) = send(&router, "GET", &format!("/api/projects/{project_id}"), None).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "project_not_found");
}

#[tokio::test]
async fn folders_attached_to_one_project_do_not_appear_in_another_project() {
    let (router, first_id, _ws, _first_dir, _db) = setup().await;
    let second_dir = tempfile::tempdir().unwrap();
    let attached_to_first = tempfile::tempdir().unwrap();

    let (status, created) = send(
        &router,
        "POST",
        "/api/projects",
        Some(json!({
            "name": "项目 B",
            "workspace_uri": to_file_uri(second_dir.path()).unwrap()
        })),
    )
    .await;
    assert_eq!(status, StatusCode::CREATED);
    let second_id = created["data"]["project_id"].as_str().unwrap();

    let (status, _) = send(
        &router,
        "POST",
        &folders_url(&first_id),
        Some(json!({ "uri": to_file_uri(attached_to_first.path()).unwrap() })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);

    let (_, first) = send(&router, "GET", &format!("/api/projects/{first_id}"), None).await;
    let (_, second) = send(&router, "GET", &format!("/api/projects/{second_id}"), None).await;

    assert_eq!(first["data"]["explorer"]["entries"].as_array().unwrap().len(), 2);
    assert_eq!(second["data"]["explorer"]["entries"].as_array().unwrap().len(), 1);
    assert_ne!(
        first["data"]["explorer"]["workspace_pe_id"],
        second["data"]["explorer"]["workspace_pe_id"]
    );
}

#[tokio::test]
async fn project_state_is_restored_after_database_reopen() {
    let data_dir = tempfile::tempdir().unwrap();
    let db_path = data_dir.path().join("projects.sqlite");
    let workspace = tempfile::tempdir().unwrap();

    let db = init_database(&db_path).await.unwrap();
    let store: Arc<dyn IProjectStore> = Arc::new(SqliteProjectStore::new(db.pool().clone()));
    let service = ProjectService::new(store, std::env::temp_dir());
    let created = service
        .create_standard_named(
            "system_default_user",
            "重启后仍存在".to_owned(),
            to_file_uri(workspace.path()).unwrap(),
        )
        .await
        .unwrap();
    let project_id = created.id.clone();
    db.close().await;

    let reopened = init_database(&db_path).await.unwrap();
    let reopened_store: Arc<dyn IProjectStore> = Arc::new(SqliteProjectStore::new(reopened.pool().clone()));
    let reopened_service = ProjectService::new(reopened_store, std::env::temp_dir());
    let restored = reopened_service
        .get_project("system_default_user", &project_id)
        .await
        .unwrap();

    assert_eq!(restored.name, "重启后仍存在");
    assert_eq!(restored.explorer.entries.len(), 1);
    assert_eq!(restored.explorer.entries[0].role, "workspace");
    reopened.close().await;
}

#[tokio::test]
async fn attach_new_folder_returns_attached_entry() {
    let (router, project_id, _ws, _dir, _db) = setup().await;
    let other = tempfile::tempdir().unwrap();

    let (status, body) = send(
        &router,
        "POST",
        &folders_url(&project_id),
        Some(json!({ "uri": to_file_uri(other.path()).unwrap() })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["role"], "attached");
    assert!(!body["data"]["pe_id"].as_str().unwrap().is_empty());
    assert_eq!(body["data"]["order_index"], 1);

    // Now visible as a second root via GET.
    let (_s, detail) = send(&router, "GET", &format!("/api/projects/{project_id}"), None).await;
    assert_eq!(detail["data"]["explorer"]["entries"].as_array().unwrap().len(), 2);
}

#[tokio::test]
async fn attach_idempotency_focus_duplicate_overlap() {
    let (router, project_id, _ws, _dir, _db) = setup().await;

    // A controlled parent/child hierarchy independent of the workspace dir.
    let parent = tempfile::tempdir().unwrap();
    let child = parent.path().join("child");
    std::fs::create_dir(&child).unwrap();
    let grandchild = child.join("g");
    std::fs::create_dir(&grandchild).unwrap();

    // Attach `child` → new attached entry.
    let (status, body) = send(
        &router,
        "POST",
        &folders_url(&project_id),
        Some(json!({ "uri": to_file_uri(&child).unwrap() })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    let child_pe = body["data"]["pe_id"].as_str().unwrap().to_string();

    // Attach a descendant of `child` → focus-in-place: 200 returning the SAME entry.
    let (status, body) = send(
        &router,
        "POST",
        &folders_url(&project_id),
        Some(json!({ "uri": to_file_uri(&grandchild).unwrap() })),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["pe_id"].as_str().unwrap(), child_pe);

    // Attach the exact same folder again → 409 duplicate.
    let (status, body) = send(
        &router,
        "POST",
        &folders_url(&project_id),
        Some(json!({ "uri": to_file_uri(&child).unwrap() })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "project_explorer_duplicate");

    // Attach an ancestor of an existing entry → 409 overlap.
    let (status, body) = send(
        &router,
        "POST",
        &folders_url(&project_id),
        Some(json!({ "uri": to_file_uri(parent.path()).unwrap() })),
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "project_explorer_overlap");
}

#[tokio::test]
async fn remove_attached_then_workspace_immutable() {
    let (router, project_id, workspace_pe_id, _dir, _db) = setup().await;
    let other = tempfile::tempdir().unwrap();

    let (_s, body) = send(
        &router,
        "POST",
        &folders_url(&project_id),
        Some(json!({ "uri": to_file_uri(other.path()).unwrap() })),
    )
    .await;
    let attached_pe = body["data"]["pe_id"].as_str().unwrap().to_string();

    // Remove the attached root → 204, gone from the project.
    let (status, _b) = send(
        &router,
        "DELETE",
        &format!("/api/projects/{project_id}/folders/{attached_pe}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    let (_s, detail) = send(&router, "GET", &format!("/api/projects/{project_id}"), None).await;
    assert_eq!(detail["data"]["explorer"]["entries"].as_array().unwrap().len(), 1);

    // The workspace root cannot be removed → 409 with a stable code.
    let (status, body) = send(
        &router,
        "DELETE",
        &format!("/api/projects/{project_id}/folders/{workspace_pe_id}"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(body["code"], "workspace_entry_immutable");
}

// ── POST /api/projects/{id}/resolve-ref ────────────────────────────────

#[tokio::test]
async fn resolve_ref_upgrades_a_local_path_under_a_root() {
    let (router, project_id, workspace_pe_id, dir, _db) = setup().await;
    std::fs::create_dir(dir.path().join("src")).unwrap();
    let file = dir.path().join("src/main.rs");
    std::fs::write(&file, b"fn main() {}").unwrap();

    let (status, body) = send(
        &router,
        "POST",
        &format!("/api/projects/{project_id}/resolve-ref"),
        Some(json!({"file": {"kind": "local", "path": file.to_string_lossy()}})),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["file"]["kind"], "project");
    assert_eq!(body["data"]["file"]["pe_id"], workspace_pe_id);
    assert_eq!(body["data"]["file"]["relative_path"], "src/main.rs");
    assert_eq!(body["data"]["upgraded"], true);

    // The absolute path must not come back in any form: the client addresses by
    // identity and never had this path to begin with.
    let rendered = body.to_string();
    assert!(
        !rendered.contains("src/main.rs\"") || !rendered.contains(&dir.path().to_string_lossy().to_string()),
        "response must not echo the absolute path, got {rendered}"
    );
    assert!(
        !rendered.contains(&dir.path().to_string_lossy().to_string()),
        "response must not echo the root's absolute path, got {rendered}"
    );
}

#[tokio::test]
async fn resolve_ref_echoes_a_path_outside_every_root() {
    let (router, project_id, _pe, _dir, _db) = setup().await;
    let outside = tempfile::tempdir().unwrap();
    let file = outside.path().join("other.txt");
    std::fs::write(&file, b"x").unwrap();

    let (status, body) = send(
        &router,
        "POST",
        &format!("/api/projects/{project_id}/resolve-ref"),
        Some(json!({"file": {"kind": "local", "path": file.to_string_lossy()}})),
    )
    .await;

    // Not an error: the caller still needs an addressable ref, and "outside the
    // project" is an ordinary answer.
    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["file"]["kind"], "local");
    assert_eq!(body["data"]["upgraded"], false);
}

/// `upgraded` exists so a caller can skip a state write; it must track whether the
/// ref actually changed, not merely whether the request succeeded.
#[tokio::test]
async fn resolve_ref_reports_not_upgraded_for_an_already_project_ref() {
    let (router, project_id, workspace_pe_id, _dir, _db) = setup().await;

    let (status, body) = send(
        &router,
        "POST",
        &format!("/api/projects/{project_id}/resolve-ref"),
        Some(json!({
            "file": {"kind": "project", "pe_id": workspace_pe_id, "relative_path": "a.md"}
        })),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["file"]["kind"], "project");
    assert_eq!(body["data"]["upgraded"], false);
}

/// An unknown project must not resolve. The file has to exist for this to prove
/// anything: a missing path returns early — before any project lookup — so pointing
/// at a nonexistent file would yield 200 regardless of the project id and the test
/// would assert nothing about scoping.
#[tokio::test]
async fn resolve_ref_on_an_unknown_project_is_not_found() {
    let (router, _project_id, _pe, dir, _db) = setup().await;
    let file = dir.path().join("real.md");
    std::fs::write(&file, b"x").unwrap();

    let (status, body) = send(
        &router,
        "POST",
        "/api/projects/proj_does_not_exist/resolve-ref",
        Some(json!({"file": {"kind": "local", "path": file.to_string_lossy()}})),
    )
    .await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "project_not_found");
}

/// The early return for a missing file happens before the project is read, so an
/// unknown project plus a missing file is a 200 with the ref echoed back. Pinned
/// deliberately: it is the ordering that makes the missing-file contract work, and
/// a future reader moving the project lookup earlier would turn a renderable
/// missing-file state into an error.
#[tokio::test]
async fn resolve_ref_returns_the_ref_when_the_file_is_missing_even_for_an_unknown_project() {
    let (router, _project_id, _pe, dir, _db) = setup().await;
    let missing = dir.path().join("never-written.md");

    let (status, body) = send(
        &router,
        "POST",
        "/api/projects/proj_does_not_exist/resolve-ref",
        Some(json!({"file": {"kind": "local", "path": missing.to_string_lossy()}})),
    )
    .await;

    assert_eq!(status, StatusCode::OK);
    assert_eq!(body["data"]["file"]["kind"], "local");
    assert_eq!(body["data"]["upgraded"], false);
}
