use aionui_common::{generate_prefixed_id, now_ms};
use sqlx::{Row, SqlitePool};

use crate::error::DbError;
use crate::models::{
    FolderRow, ProjectExplorerRow, ProjectKind, ProjectPrdRow, ProjectRequirementAnalysisRow, ProjectRow,
};
use crate::repository::project::IProjectStore;

/// SQLite-backed implementation of [`IProjectStore`].
#[derive(Clone, Debug)]
pub struct SqliteProjectStore {
    pool: SqlitePool,
}

impl SqliteProjectStore {
    pub fn new(pool: SqlitePool) -> Self {
        Self { pool }
    }
}

const FOLDER_COLS: &str = "folder_id, resource_uri, resource_canonical, created_at, updated_at";
const PROJECT_COLS: &str = "project_id, name, kind, created_at, updated_at";
const ENTRY_COLS: &str = "pe_id, project_id, folder_id, role, display_name, order_index, created_at, updated_at";
const ANALYSIS_COLS: &str =
    "project_id, source_text, content, status, confirmed_by, confirmed_at, created_at, updated_at";
const PRD_COLS: &str = "project_id, title, content, created_at, updated_at";

#[async_trait::async_trait]
impl IProjectStore for SqliteProjectStore {
    async fn upsert_folder(&self, canonical: &str, raw_uri: &str) -> Result<FolderRow, DbError> {
        let now = now_ms();
        let folder_id = generate_prefixed_id("folder");
        // INSERT OR IGNORE: a canonical collision leaves the existing row
        // untouched (immutable folder rows, no updated_at bump).
        sqlx::query(
            "INSERT OR IGNORE INTO folders (folder_id, resource_uri, resource_canonical, created_at, updated_at) \
             VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&folder_id)
        .bind(raw_uri)
        .bind(canonical)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;

        let row = sqlx::query_as::<_, FolderRow>(&format!(
            "SELECT {FOLDER_COLS} FROM folders WHERE resource_canonical = ?"
        ))
        .bind(canonical)
        .fetch_one(&self.pool)
        .await?;
        Ok(row)
    }

    async fn get_folder(&self, folder_id: &str) -> Result<Option<FolderRow>, DbError> {
        let row = sqlx::query_as::<_, FolderRow>(&format!("SELECT {FOLDER_COLS} FROM folders WHERE folder_id = ?"))
            .bind(folder_id)
            .fetch_optional(&self.pool)
            .await?;
        Ok(row)
    }

    async fn get_project(&self, user_id: &str, project_id: &str) -> Result<Option<ProjectRow>, DbError> {
        let row = sqlx::query_as::<_, ProjectRow>(&format!(
            "SELECT {PROJECT_COLS} FROM projects WHERE project_id = ? AND user_id = ?"
        ))
        .bind(project_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn list_standard_projects(&self, user_id: &str) -> Result<Vec<(ProjectRow, FolderRow)>, DbError> {
        let rows = sqlx::query(
            "SELECT p.project_id, p.name, p.kind, p.created_at, p.updated_at, \
                    f.folder_id, f.resource_uri, f.resource_canonical, \
                    f.created_at AS f_created_at, f.updated_at AS f_updated_at \
             FROM projects p \
             JOIN project_explorer pe ON pe.project_id = p.project_id AND pe.role = 'workspace' \
             JOIN folders f ON f.folder_id = pe.folder_id \
             WHERE p.user_id = ? AND pe.owner_user_id = ? AND p.kind = 'standard' \
             ORDER BY p.updated_at DESC, p.created_at DESC",
        )
        .bind(user_id)
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        Ok(rows
            .into_iter()
            .map(|row| {
                let project = ProjectRow {
                    project_id: row.get("project_id"),
                    name: row.get("name"),
                    kind: row.get("kind"),
                    created_at: row.get("created_at"),
                    updated_at: row.get("updated_at"),
                };
                let folder = FolderRow {
                    folder_id: row.get("folder_id"),
                    resource_uri: row.get("resource_uri"),
                    resource_canonical: row.get("resource_canonical"),
                    created_at: row.get("f_created_at"),
                    updated_at: row.get("f_updated_at"),
                };
                (project, folder)
            })
            .collect())
    }

    async fn rename_project(&self, user_id: &str, project_id: &str, name: &str) -> Result<Option<ProjectRow>, DbError> {
        sqlx::query("UPDATE projects SET name = ?, updated_at = ? WHERE project_id = ? AND user_id = ?")
            .bind(name)
            .bind(now_ms())
            .bind(project_id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        self.get_project(user_id, project_id).await
    }

    async fn touch_project(&self, user_id: &str, project_id: &str) -> Result<Option<ProjectRow>, DbError> {
        sqlx::query("UPDATE projects SET updated_at = ? WHERE project_id = ? AND user_id = ?")
            .bind(now_ms())
            .bind(project_id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        self.get_project(user_id, project_id).await
    }

    async fn get_requirement_analysis(
        &self,
        user_id: &str,
        project_id: &str,
    ) -> Result<Option<ProjectRequirementAnalysisRow>, DbError> {
        Ok(sqlx::query_as::<_, ProjectRequirementAnalysisRow>(&format!(
            "SELECT {ANALYSIS_COLS} FROM project_requirement_analyses WHERE project_id = ? AND owner_user_id = ?"
        ))
        .bind(project_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?)
    }

    async fn save_requirement_analysis(
        &self,
        user_id: &str,
        project_id: &str,
        source_text: &str,
        content: &str,
    ) -> Result<ProjectRequirementAnalysisRow, DbError> {
        let now = now_ms();
        sqlx::query(
            "INSERT INTO project_requirement_analyses \
             (project_id, owner_user_id, source_text, content, status, confirmed_by, confirmed_at, created_at, updated_at) \
             SELECT project_id, user_id, ?, ?, 'draft', NULL, NULL, ?, ? FROM projects \
             WHERE project_id = ? AND user_id = ? \
             ON CONFLICT(project_id) DO UPDATE SET source_text = excluded.source_text, content = excluded.content, \
             status = 'draft', confirmed_by = NULL, confirmed_at = NULL, updated_at = excluded.updated_at \
             WHERE owner_user_id = excluded.owner_user_id",
        )
        .bind(source_text)
        .bind(content)
        .bind(now)
        .bind(now)
        .bind(project_id)
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        self.get_requirement_analysis(user_id, project_id)
            .await?
            .ok_or_else(|| DbError::NotFound(format!("project {project_id}")))
    }

    async fn confirm_requirement_analysis(
        &self,
        user_id: &str,
        project_id: &str,
    ) -> Result<Option<ProjectRequirementAnalysisRow>, DbError> {
        let now = now_ms();
        sqlx::query(
            "UPDATE project_requirement_analyses SET status = 'confirmed', confirmed_by = ?, confirmed_at = ?, \
             updated_at = ? WHERE project_id = ? AND owner_user_id = ?",
        )
        .bind(user_id)
        .bind(now)
        .bind(now)
        .bind(project_id)
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        self.get_requirement_analysis(user_id, project_id).await
    }

    async fn get_project_prd(&self, user_id: &str, project_id: &str) -> Result<Option<ProjectPrdRow>, DbError> {
        Ok(sqlx::query_as::<_, ProjectPrdRow>(&format!(
            "SELECT {PRD_COLS} FROM project_prds WHERE project_id = ? AND owner_user_id = ?"
        ))
        .bind(project_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?)
    }

    async fn save_project_prd(
        &self,
        user_id: &str,
        project_id: &str,
        title: &str,
        content: &str,
    ) -> Result<ProjectPrdRow, DbError> {
        let now = now_ms();
        sqlx::query(
            "INSERT INTO project_prds (project_id, owner_user_id, title, content, created_at, updated_at) \
             SELECT project_id, user_id, ?, ?, ?, ? FROM projects WHERE project_id = ? AND user_id = ? \
             ON CONFLICT(project_id) DO UPDATE SET title = excluded.title, content = excluded.content, \
             updated_at = excluded.updated_at WHERE owner_user_id = excluded.owner_user_id",
        )
        .bind(title)
        .bind(content)
        .bind(now)
        .bind(now)
        .bind(project_id)
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        self.get_project_prd(user_id, project_id)
            .await?
            .ok_or_else(|| DbError::NotFound(format!("project {project_id}")))
    }

    async fn select_workspace_entry_by_folder(
        &self,
        user_id: &str,
        folder_id: &str,
    ) -> Result<Option<ProjectExplorerRow>, DbError> {
        let row = sqlx::query_as::<_, ProjectExplorerRow>(&format!(
            "SELECT {ENTRY_COLS} FROM project_explorer \
             WHERE folder_id = ? AND role = 'workspace' AND owner_user_id = ?"
        ))
        .bind(folder_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn get_entry(&self, user_id: &str, pe_id: &str) -> Result<Option<ProjectExplorerRow>, DbError> {
        let row = sqlx::query_as::<_, ProjectExplorerRow>(&format!(
            "SELECT {ENTRY_COLS} FROM project_explorer WHERE pe_id = ? AND owner_user_id = ?"
        ))
        .bind(pe_id)
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?;
        Ok(row)
    }

    async fn list_entries(
        &self,
        user_id: &str,
        project_id: &str,
    ) -> Result<Vec<(ProjectExplorerRow, FolderRow)>, DbError> {
        // Manual join projection: project_explorer and folders share column
        // names (folder_id / created_at / updated_at), so folder columns are
        // aliased and rows are mapped by name rather than via a tuple FromRow.
        let rows = sqlx::query(
            "SELECT pe.pe_id, pe.project_id, pe.folder_id, pe.role, pe.display_name, pe.order_index, \
                    pe.created_at, pe.updated_at, \
                    f.resource_uri AS f_resource_uri, f.resource_canonical AS f_resource_canonical, \
                    f.created_at AS f_created_at, f.updated_at AS f_updated_at \
             FROM project_explorer pe \
             JOIN folders f ON f.folder_id = pe.folder_id \
             WHERE pe.project_id = ? AND pe.owner_user_id = ? \
             ORDER BY pe.order_index ASC, pe.created_at ASC",
        )
        .bind(project_id)
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?;

        let mut out = Vec::with_capacity(rows.len());
        for r in rows {
            let folder_id: String = r.get("folder_id");
            let entry = ProjectExplorerRow {
                pe_id: r.get("pe_id"),
                project_id: r.get("project_id"),
                folder_id: folder_id.clone(),
                role: r.get("role"),
                display_name: r.get("display_name"),
                order_index: r.get("order_index"),
                created_at: r.get("created_at"),
                updated_at: r.get("updated_at"),
            };
            let folder = FolderRow {
                folder_id,
                resource_uri: r.get("f_resource_uri"),
                resource_canonical: r.get("f_resource_canonical"),
                created_at: r.get("f_created_at"),
                updated_at: r.get("f_updated_at"),
            };
            out.push((entry, folder));
        }
        Ok(out)
    }

    async fn create_project_with_workspace_entry(
        &self,
        user_id: &str,
        folder_id: &str,
        name: &str,
        kind: ProjectKind,
    ) -> Result<(ProjectRow, ProjectExplorerRow), DbError> {
        let now = now_ms();
        let project_id = generate_prefixed_id("project");
        let pe_id = generate_prefixed_id("pe");

        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO projects (project_id, user_id, name, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&project_id)
        .bind(user_id)
        .bind(name)
        .bind(kind.as_str())
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await?;

        let entry_insert = sqlx::query(
            "INSERT INTO project_explorer \
                 (pe_id, project_id, owner_user_id, folder_id, role, display_name, order_index, created_at, updated_at) \
             VALUES (?, ?, ?, ?, 'workspace', NULL, 0, ?, ?)",
        )
        .bind(&pe_id)
        .bind(&project_id)
        .bind(user_id)
        .bind(folder_id)
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await;

        match entry_insert {
            Ok(_) => {
                tx.commit().await?;
                let project = self
                    .get_project(user_id, &project_id)
                    .await?
                    .ok_or_else(|| DbError::NotFound(format!("project {project_id} after insert")))?;
                let entry = self
                    .get_entry(user_id, &pe_id)
                    .await?
                    .ok_or_else(|| DbError::NotFound(format!("project_explorer {pe_id} after insert")))?;
                Ok((project, entry))
            }
            Err(err) => {
                tx.rollback().await?;
                let db_err = DbError::from(err);
                if db_err.is_unique_violation() {
                    // This owner already has a workspace project for this folder — return it.
                    let entry = self
                        .select_workspace_entry_by_folder(user_id, folder_id)
                        .await?
                        .ok_or_else(|| DbError::Conflict(format!("workspace entry for folder {folder_id}")))?;
                    let project = self
                        .get_project(user_id, &entry.project_id)
                        .await?
                        .ok_or_else(|| DbError::NotFound(format!("project {}", entry.project_id)))?;
                    Ok((project, entry))
                } else {
                    Err(db_err)
                }
            }
        }
    }

    async fn insert_attached_entry(
        &self,
        user_id: &str,
        project_id: &str,
        folder_id: &str,
        display_name: Option<&str>,
        order_index: i64,
    ) -> Result<ProjectExplorerRow, DbError> {
        let now = now_ms();
        let pe_id = generate_prefixed_id("pe");
        sqlx::query(
            "INSERT INTO project_explorer \
                 (pe_id, project_id, owner_user_id, folder_id, role, display_name, order_index, created_at, updated_at) \
             VALUES (?, ?, ?, ?, 'attached', ?, ?, ?, ?)",
        )
        .bind(&pe_id)
        .bind(project_id)
        .bind(user_id)
        .bind(folder_id)
        .bind(display_name)
        .bind(order_index)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;
        self.get_entry(user_id, &pe_id)
            .await?
            .ok_or_else(|| DbError::NotFound(format!("project_explorer {pe_id} after insert")))
    }

    async fn remove_entry(&self, user_id: &str, pe_id: &str) -> Result<(), DbError> {
        sqlx::query("DELETE FROM project_explorer WHERE pe_id = ? AND owner_user_id = ?")
            .bind(pe_id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn delete_project(&self, user_id: &str, project_id: &str) -> Result<(), DbError> {
        // Explorer entries first, then the project row — both owner-scoped, one
        // transaction. `folders` are global and intentionally left intact.
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM project_explorer WHERE project_id = ? AND owner_user_id = ?")
            .bind(project_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM projects WHERE project_id = ? AND user_id = ?")
            .bind(project_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    async fn reorder(&self, user_id: &str, project_id: &str, ordered_pe_ids: &[String]) -> Result<(), DbError> {
        let now = now_ms();
        let mut tx = self.pool.begin().await?;
        for (position, pe_id) in ordered_pe_ids.iter().enumerate() {
            sqlx::query(
                "UPDATE project_explorer SET order_index = ?, updated_at = ? \
                 WHERE pe_id = ? AND project_id = ? AND owner_user_id = ?",
            )
            .bind(position as i64)
            .bind(now)
            .bind(pe_id)
            .bind(project_id)
            .bind(user_id)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(())
    }

    async fn rename_entry(
        &self,
        user_id: &str,
        pe_id: &str,
        display_name: Option<&str>,
    ) -> Result<ProjectExplorerRow, DbError> {
        let now = now_ms();
        let result = sqlx::query(
            "UPDATE project_explorer SET display_name = ?, updated_at = ? WHERE pe_id = ? AND owner_user_id = ?",
        )
        .bind(display_name)
        .bind(now)
        .bind(pe_id)
        .bind(user_id)
        .execute(&self.pool)
        .await?;
        if result.rows_affected() == 0 {
            return Err(DbError::NotFound(format!("project_explorer {pe_id}")));
        }
        self.get_entry(user_id, pe_id)
            .await?
            .ok_or_else(|| DbError::NotFound(format!("project_explorer {pe_id}")))
    }
}
