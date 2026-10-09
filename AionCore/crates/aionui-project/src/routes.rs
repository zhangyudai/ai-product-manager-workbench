// `ApiError` is the intended error type at this HTTP boundary (routes map the
// crate-owned `ProjectError` to it here), so the disallowed_types lint that
// steers service code away from `ApiError` does not apply to this module.
#![allow(clippy::disallowed_types)]

//! Project Explorer control-plane HTTP routes.
//!
//! Read a project's roots (`GET /api/projects/{id}`) and mutate its attached
//! folders (`POST`/`DELETE .../folders`). Filesystem content is served
//! separately over the `fs/*` WebSocket protocol; these routes only expose the
//! project shell + root list the explorer needs to open subscriptions.
//!
//! Handlers do request/response transformation only; all business logic lives
//! in [`ProjectService`]. Domain [`ProjectError`]s map to `ApiError` with
//! stable, machine-readable codes (`project_explorer_duplicate`,
//! `project_explorer_overlap`, …) so the frontend can branch without parsing
//! human messages.

use std::sync::Arc;

use aionui_api_types::{
    ApiResponse, AttachFolderRequest, CreateProjectRequest, ProjectDetailResponse, ProjectEntry, ProjectExplorer,
    ProjectPrdResponse, ProjectRequirementAnalysisResponse, ProjectSummaryResponse, RenameProjectRequest,
    ResolveRefRequest, ResolveRefResponse, SaveProjectPrdRequest, SaveProjectRequirementAnalysisRequest,
};
use aionui_auth::CurrentUser;
use aionui_common::ApiError;
use axum::extract::rejection::JsonRejection;
use axum::extract::{Json, Path, State};
use axum::http::StatusCode;
use axum::routing::{delete, get, patch, post};
use axum::{Extension, Router};
use serde_json::json;

use crate::canonical;
use crate::service::ProjectService;
use crate::types::{AttachInput, ProjectDetail, ProjectError, ProjectExplorerEntry};

/// Shared state for project route handlers.
#[derive(Clone)]
pub struct ProjectRouterState {
    pub project: Arc<ProjectService>,
}

/// Build the project control-plane router (`/api/projects/*`).
///
/// All routes require authentication (applied by the caller).
pub fn project_routes(state: ProjectRouterState) -> Router {
    Router::new()
        .route("/api/projects", get(list_projects).post(create_project))
        .route("/api/projects/{project_id}", get(get_project))
        .route("/api/projects/{project_id}/name", patch(rename_project))
        .route("/api/projects/{project_id}/open", post(open_project))
        .route(
            "/api/projects/{project_id}/requirement-analysis",
            get(get_requirement_analysis).put(save_requirement_analysis),
        )
        .route(
            "/api/projects/{project_id}/requirement-analysis/confirm",
            post(confirm_requirement_analysis),
        )
        .route(
            "/api/projects/{project_id}/prd",
            get(get_project_prd).put(save_project_prd),
        )
        .route("/api/projects/{project_id}/folders", post(attach_folder))
        .route("/api/projects/{project_id}/folders/{pe_id}", delete(remove_folder))
        .route("/api/projects/{project_id}/resolve-ref", post(resolve_ref))
        .with_state(state)
}

async fn get_requirement_analysis(
    State(state): State<ProjectRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(project_id): Path<String>,
) -> Result<Json<ApiResponse<Option<ProjectRequirementAnalysisResponse>>>, ApiError> {
    let row = state.project.get_requirement_analysis(&user.id, &project_id).await?;
    Ok(Json(ApiResponse::ok(row.map(to_analysis_response))))
}

async fn save_requirement_analysis(
    State(state): State<ProjectRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(project_id): Path<String>,
    body: Result<Json<SaveProjectRequirementAnalysisRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<ProjectRequirementAnalysisResponse>>, ApiError> {
    let Json(req) = body.map_err(ApiError::from)?;
    let row = state
        .project
        .save_requirement_analysis(&user.id, &project_id, req.source_text, req.content)
        .await?;
    Ok(Json(ApiResponse::ok(to_analysis_response(row))))
}

async fn confirm_requirement_analysis(
    State(state): State<ProjectRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(project_id): Path<String>,
) -> Result<Json<ApiResponse<ProjectRequirementAnalysisResponse>>, ApiError> {
    let row = state
        .project
        .confirm_requirement_analysis(&user.id, &project_id)
        .await?;
    Ok(Json(ApiResponse::ok(to_analysis_response(row))))
}

async fn get_project_prd(
    State(state): State<ProjectRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(project_id): Path<String>,
) -> Result<Json<ApiResponse<Option<ProjectPrdResponse>>>, ApiError> {
    let row = state.project.get_project_prd(&user.id, &project_id).await?;
    Ok(Json(ApiResponse::ok(row.map(to_prd_response))))
}

async fn save_project_prd(
    State(state): State<ProjectRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(project_id): Path<String>,
    body: Result<Json<SaveProjectPrdRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<ProjectPrdResponse>>, ApiError> {
    let Json(req) = body.map_err(ApiError::from)?;
    let row = state
        .project
        .save_project_prd(&user.id, &project_id, req.title, req.content)
        .await?;
    Ok(Json(ApiResponse::ok(to_prd_response(row))))
}

async fn list_projects(
    State(state): State<ProjectRouterState>,
    Extension(user): Extension<CurrentUser>,
) -> Result<Json<ApiResponse<Vec<ProjectSummaryResponse>>>, ApiError> {
    let projects = state
        .project
        .list_projects(&user.id)
        .await?
        .into_iter()
        .map(|project| ProjectSummaryResponse {
            project_id: project.id,
            name: project.name,
            workspace_path: project.workspace_path,
            created_at: project.created_at,
            updated_at: project.updated_at,
        })
        .collect();
    Ok(Json(ApiResponse::ok(projects)))
}

async fn create_project(
    State(state): State<ProjectRouterState>,
    Extension(user): Extension<CurrentUser>,
    body: Result<Json<CreateProjectRequest>, JsonRejection>,
) -> Result<(StatusCode, Json<ApiResponse<ProjectDetailResponse>>), ApiError> {
    let Json(req) = body.map_err(ApiError::from)?;
    let detail = state
        .project
        .create_standard_named(&user.id, req.name, req.workspace_uri)
        .await?;
    Ok((StatusCode::CREATED, Json(ApiResponse::ok(to_detail_response(detail)))))
}

async fn rename_project(
    State(state): State<ProjectRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(project_id): Path<String>,
    body: Result<Json<RenameProjectRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<ProjectDetailResponse>>, ApiError> {
    let Json(req) = body.map_err(ApiError::from)?;
    let detail = state.project.rename_project(&user.id, &project_id, req.name).await?;
    Ok(Json(ApiResponse::ok(to_detail_response(detail))))
}

async fn open_project(
    State(state): State<ProjectRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(project_id): Path<String>,
) -> Result<Json<ApiResponse<ProjectDetailResponse>>, ApiError> {
    let detail = state.project.open_project(&user.id, &project_id).await?;
    Ok(Json(ApiResponse::ok(to_detail_response(detail))))
}

/// `GET /api/projects/{project_id}` — full project detail + all roots in one
/// call (frontend does not fan out per root).
async fn get_project(
    State(state): State<ProjectRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(project_id): Path<String>,
) -> Result<Json<ApiResponse<ProjectDetailResponse>>, ApiError> {
    let detail = state.project.get_project(&user.id, &project_id).await?;
    Ok(Json(ApiResponse::ok(to_detail_response(detail))))
}

/// `POST /api/projects/{project_id}/resolve-ref` — re-express a `ChatFileRef` in
/// its strongest form for this project.
///
/// The explorer and a chat link produce different refs for the same file
/// (`Project` vs `Local`), so callers that key on the ref — tab identity, the
/// `fs` change signal — would otherwise treat one file as two. This resolves a
/// `Local` path that lives under one of the project's roots into the `Project`
/// form; `Project` and `Upload` come back untouched.
///
/// Always succeeds with a usable ref: a path outside every root, or one that does
/// not exist, is echoed back unchanged rather than raising. "Not upgradeable" is
/// an ordinary answer here, and a caller mid-way through opening a missing file
/// still needs its ref to render that state.
///
/// The judgement stays server-side because case folding is a compile-time
/// platform fork (`canonical::IGNORE_PATH_CASING`); a client comparing path
/// strings would miss matches on macOS and merge distinct files on Linux.
async fn resolve_ref(
    State(state): State<ProjectRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(project_id): Path<String>,
    body: Result<Json<ResolveRefRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<ResolveRefResponse>>, ApiError> {
    let Json(req) = body.map_err(ApiError::from)?;
    let file = state
        .project
        .upgrade_chat_file_ref(&user.id, &project_id, &req.file)
        .await?;
    let upgraded = file != req.file;
    Ok(Json(ApiResponse::ok(ResolveRefResponse { file, upgraded })))
}

/// `POST /api/projects/{project_id}/folders` — attach a folder. Returns the
/// single new (or focused-existing) entry so the frontend can splice it in
/// without re-fetching the project.
async fn attach_folder(
    State(state): State<ProjectRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path(project_id): Path<String>,
    body: Result<Json<AttachFolderRequest>, JsonRejection>,
) -> Result<Json<ApiResponse<ProjectEntry>>, ApiError> {
    let Json(req) = body.map_err(ApiError::from)?;
    let row = state
        .project
        .attach_folder(
            &user.id,
            AttachInput {
                project_id: project_id.clone(),
                uri: req.uri,
                display_name: req.display_name,
            },
        )
        .await?;

    // `attach_folder` returns the bare explorer row (no folder metadata). Re-read
    // the project to build the fully-shaped entry (display_path + runtime_status).
    // A descendant-attach focuses an existing entry, so match on the returned
    // pe_id rather than assuming the last row.
    let detail = state.project.get_project(&user.id, &project_id).await?;
    let entry = detail
        .explorer
        .entries
        .into_iter()
        .find(|e| e.pe_id == row.pe_id)
        .ok_or_else(|| ApiError::Internal("attached entry missing after insert".to_owned()))?;
    Ok(Json(ApiResponse::ok(to_entry(entry))))
}

/// `DELETE /api/projects/{project_id}/folders/{pe_id}` — detach an attached
/// folder. The workspace root is immutable (`workspace_entry_immutable`).
async fn remove_folder(
    State(state): State<ProjectRouterState>,
    Extension(user): Extension<CurrentUser>,
    Path((_project_id, pe_id)): Path<(String, String)>,
) -> Result<StatusCode, ApiError> {
    state.project.remove_attached(&user.id, &pe_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

// ── mapping: domain → wire DTO ───────────────────────────────────────────────

fn to_detail_response(detail: ProjectDetail) -> ProjectDetailResponse {
    ProjectDetailResponse {
        project_id: detail.id,
        name: detail.name,
        explorer: ProjectExplorer {
            workspace_pe_id: detail.explorer.workspace_pe_id,
            // `get_project` yields entries ordered by order_index ASC.
            entries: detail.explorer.entries.into_iter().map(to_entry).collect(),
        },
    }
}

fn to_entry(entry: ProjectExplorerEntry) -> ProjectEntry {
    // `display_path` is a human-facing rendering of the folder's original
    // resource_uri; fall back to the raw uri if it is not a decodable path.
    let display_path = canonical::uri_to_path(&entry.folder.resource_uri)
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| entry.folder.resource_uri.clone());
    ProjectEntry {
        pe_id: entry.pe_id,
        role: entry.role,
        display_name: entry.display_name,
        display_path,
        order_index: entry.order_index,
        runtime_status: entry.folder.runtime_status.as_str().to_owned(),
    }
}

fn to_analysis_response(row: aionui_db::ProjectRequirementAnalysisRow) -> ProjectRequirementAnalysisResponse {
    ProjectRequirementAnalysisResponse {
        project_id: row.project_id,
        source_text: row.source_text,
        content: row.content,
        status: row.status,
        confirmed_by: row.confirmed_by,
        confirmed_at: row.confirmed_at,
        updated_at: row.updated_at,
    }
}

fn to_prd_response(row: aionui_db::ProjectPrdRow) -> ProjectPrdResponse {
    ProjectPrdResponse {
        project_id: row.project_id,
        title: row.title,
        content: row.content,
        updated_at: row.updated_at,
    }
}

// ── error mapping: ProjectError → ApiError (stable domain codes) ─────────────

impl From<ProjectError> for ApiError {
    fn from(err: ProjectError) -> Self {
        let (status, code, details) = match &err {
            ProjectError::InvalidProjectName => (StatusCode::BAD_REQUEST, "invalid_project_name", None),
            ProjectError::ProjectNotFound { project_id } => (
                StatusCode::NOT_FOUND,
                "project_not_found",
                Some(json!({ "project_id": project_id })),
            ),
            ProjectError::ProjectExplorerNotFound { pe_id } => (
                StatusCode::NOT_FOUND,
                "project_explorer_not_found",
                Some(json!({ "pe_id": pe_id })),
            ),
            ProjectError::ProjectExplorerDuplicate { project_id, folder_id } => (
                StatusCode::CONFLICT,
                "project_explorer_duplicate",
                Some(json!({ "project_id": project_id, "folder_id": folder_id })),
            ),
            ProjectError::ProjectExplorerOverlap { project_id } => (
                StatusCode::CONFLICT,
                "project_explorer_overlap",
                Some(json!({ "project_id": project_id })),
            ),
            ProjectError::WorkspaceEntryImmutable { pe_id } => (
                StatusCode::CONFLICT,
                "workspace_entry_immutable",
                Some(json!({ "pe_id": pe_id })),
            ),
            ProjectError::RequirementAnalysisEmpty => (StatusCode::CONFLICT, "requirement_analysis_empty", None),
            ProjectError::RequirementAnalysisNotConfirmed => {
                (StatusCode::CONFLICT, "requirement_analysis_not_confirmed", None)
            }
            ProjectError::InvalidPrd => (StatusCode::BAD_REQUEST, "invalid_prd", None),
            ProjectError::ArtifactWriteFailed { path } => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "artifact_write_failed",
                Some(json!({ "path": path })),
            ),
            ProjectError::StandardProjectConflict { folder_id } => (
                StatusCode::CONFLICT,
                "standard_project_conflict",
                Some(json!({ "folder_id": folder_id })),
            ),
            ProjectError::WorkspaceFolderMismatch { project_id, folder_id } => (
                StatusCode::CONFLICT,
                "workspace_folder_mismatch",
                Some(json!({ "project_id": project_id, "folder_id": folder_id })),
            ),
            ProjectError::FolderNotFound { .. } => (StatusCode::NOT_FOUND, "folder_not_found", None),
            ProjectError::FolderNotDirectory { .. } => (StatusCode::BAD_REQUEST, "folder_not_directory", None),
            ProjectError::FolderPermissionDenied { .. } => (StatusCode::FORBIDDEN, "folder_permission_denied", None),
            ProjectError::FolderCanonicalizeFailed { .. }
            | ProjectError::UnsupportedResourceScheme { .. }
            | ProjectError::InvalidRelativePath { .. }
            | ProjectError::ResourceOutsideFolder { .. } => (StatusCode::BAD_REQUEST, "invalid_resource", None),
            ProjectError::TempDirExists { .. } | ProjectError::WorkspaceMissing => {
                (StatusCode::BAD_REQUEST, "invalid_request", None)
            }
            ProjectError::UploadPathOutsideRoot { path } => (
                StatusCode::BAD_REQUEST,
                "upload_path_outside_root",
                Some(json!({ "path": path })),
            ),
            ProjectError::ChatFileMissing { path } => (
                StatusCode::NOT_FOUND,
                "chat_file_missing",
                Some(json!({ "path": path })),
            ),
            ProjectError::LocalPathNotReadable { path } => (
                StatusCode::BAD_REQUEST,
                "local_path_not_readable",
                Some(json!({ "path": path })),
            ),
            ProjectError::Database(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal_error", None),
        };
        // Never leak internal DB detail to clients (Security: no internal leakage).
        let message = match &err {
            ProjectError::Database(_) => "internal error".to_owned(),
            other => other.to_string(),
        };
        ApiError::coded(status, code, message, details)
    }
}

#[cfg(test)]
#[path = "routes_test.rs"]
mod routes_test;
