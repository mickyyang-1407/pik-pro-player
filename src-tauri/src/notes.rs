use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

// Notes DB — one row per note, keyed to the audio file's absolute path.
// Simple design: no projects, no versions. Files table stores general_note + last_opened.
//
// Trade-off: if a file is moved/renamed we lose its notes. A future migration can add a
// checksum column and fall back to that. For a mix-review workflow this is fine.

pub struct NotesDb {
    conn: Mutex<Connection>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteRecord {
    pub id: i64,
    pub file_path: String,
    pub range_start: f64,
    pub range_end: f64,
    pub body: String,
    pub status: String,   // 'open' | 'checking' | 'done'
    pub kind: String,     // 'point' | 'range'
    pub severity: String, // 'critical' | 'minor'
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NoteInput {
    pub range_start: f64,
    pub range_end: f64,
    pub body: String,
    pub status: String,
    pub kind: String,
    pub severity: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileNotesPayload {
    pub general_note: String,
    pub notes: Vec<NoteRecord>,
}

impl NotesDb {
    pub fn open(db_path: &PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("mkdir failed: {e}"))?;
        }
        let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
        conn.execute_batch(
            r#"
            PRAGMA foreign_keys = ON;
            PRAGMA journal_mode = WAL;

            CREATE TABLE IF NOT EXISTS files (
                path TEXT PRIMARY KEY,
                general_note TEXT NOT NULL DEFAULT '',
                last_opened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS notes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                range_start REAL NOT NULL,
                range_end REAL NOT NULL,
                body TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'open',
                kind TEXT NOT NULL DEFAULT 'range',
                severity TEXT NOT NULL DEFAULT 'minor',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (file_path) REFERENCES files(path) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_notes_file_path ON notes(file_path);
            "#,
        )
        .map_err(|e| e.to_string())?;
        Ok(Self { conn: Mutex::new(conn) })
    }

    /// Ensure a file row exists and bump last_opened_at.
    pub fn touch_file(&self, path: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO files (path) VALUES (?1)
             ON CONFLICT(path) DO UPDATE SET last_opened_at = CURRENT_TIMESTAMP",
            params![path],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_payload(&self, path: &str) -> Result<FileNotesPayload, String> {
        let conn = self.conn.lock().unwrap();
        let general: Option<String> = conn
            .query_row(
                "SELECT general_note FROM files WHERE path = ?1",
                params![path],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let mut stmt = conn.prepare(
            "SELECT id, file_path, range_start, range_end, body, status, kind, severity, created_at, updated_at
             FROM notes WHERE file_path = ?1
             ORDER BY range_start ASC, id ASC",
        ).map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![path], |row| {
                Ok(NoteRecord {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    range_start: row.get(2)?,
                    range_end: row.get(3)?,
                    body: row.get(4)?,
                    status: row.get(5)?,
                    kind: row.get(6)?,
                    severity: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut notes = Vec::new();
        for r in rows {
            notes.push(r.map_err(|e| e.to_string())?);
        }

        Ok(FileNotesPayload {
            general_note: general.unwrap_or_default(),
            notes,
        })
    }

    pub fn set_general_note(&self, path: &str, general: &str) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO files (path, general_note) VALUES (?1, ?2)
             ON CONFLICT(path) DO UPDATE SET general_note = excluded.general_note",
            params![path, general],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn add_note(&self, path: &str, input: &NoteInput) -> Result<NoteRecord, String> {
        let conn = self.conn.lock().unwrap();
        // Make sure the parent file row exists first (FK).
        conn.execute(
            "INSERT INTO files (path) VALUES (?1) ON CONFLICT(path) DO NOTHING",
            params![path],
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT INTO notes (file_path, range_start, range_end, body, status, kind, severity)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                path,
                input.range_start,
                input.range_end,
                input.body,
                input.status,
                input.kind,
                input.severity,
            ],
        )
        .map_err(|e| e.to_string())?;

        let id = conn.last_insert_rowid();
        conn.query_row(
            "SELECT id, file_path, range_start, range_end, body, status, kind, severity, created_at, updated_at
             FROM notes WHERE id = ?1",
            params![id],
            |row| {
                Ok(NoteRecord {
                    id: row.get(0)?,
                    file_path: row.get(1)?,
                    range_start: row.get(2)?,
                    range_end: row.get(3)?,
                    body: row.get(4)?,
                    status: row.get(5)?,
                    kind: row.get(6)?,
                    severity: row.get(7)?,
                    created_at: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        )
        .map_err(|e| e.to_string())
    }

    pub fn update_note(&self, id: i64, input: &NoteInput) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE notes SET range_start = ?1, range_end = ?2, body = ?3, status = ?4,
             kind = ?5, severity = ?6, updated_at = CURRENT_TIMESTAMP WHERE id = ?7",
            params![
                input.range_start,
                input.range_end,
                input.body,
                input.status,
                input.kind,
                input.severity,
                id,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn delete_note(&self, id: i64) -> Result<(), String> {
        let conn = self.conn.lock().unwrap();
        conn.execute("DELETE FROM notes WHERE id = ?1", params![id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}
