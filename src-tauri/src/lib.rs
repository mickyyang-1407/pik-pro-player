mod notes;
mod player;

use notes::{FileNotesPayload, NoteInput, NoteRecord, NotesDb};
use player::atmos::{AtmosPlayer, PositionPayload};
use player::lufs::LufsSnapshot;
use std::sync::Arc;
use tauri::{Manager, State};

#[tauri::command]
fn app_status() -> &'static str {
    "pik-pro-player-reset-ready"
}

#[tauri::command]
fn player_load(path: String, player: State<'_, AtmosPlayer>) -> Result<PositionPayload, String> {
    player.load(&path)
}

#[tauri::command]
fn player_play(player: State<'_, AtmosPlayer>) -> Result<(), String> {
    player.play()
}

#[tauri::command]
fn player_pause(player: State<'_, AtmosPlayer>) -> Result<(), String> {
    player.pause()
}

#[tauri::command]
fn player_seek(position: f64, player: State<'_, AtmosPlayer>) -> Result<(), String> {
    player.seek(position)
}

#[tauri::command]
fn player_set_volume(volume: f64, player: State<'_, AtmosPlayer>) -> Result<(), String> {
    player.set_volume(volume)
}

#[tauri::command]
fn player_position(player: State<'_, AtmosPlayer>) -> Option<PositionPayload> {
    player.position()
}

#[tauri::command]
fn player_is_playing(player: State<'_, AtmosPlayer>) -> bool {
    player.is_playing()
}

#[tauri::command]
fn player_meter_json(player: State<'_, AtmosPlayer>) -> Option<String> {
    player.meter_json()
}

#[tauri::command]
fn player_set_channel_mutes(mask: u32, player: State<'_, AtmosPlayer>) -> Result<(), String> {
    player.set_channel_mutes(mask)
}

#[tauri::command]
fn player_lufs_snapshot(player: State<'_, AtmosPlayer>) -> LufsSnapshot {
    player.lufs_snapshot()
}

#[tauri::command]
fn player_reset_lufs(player: State<'_, AtmosPlayer>) -> Result<(), String> {
    player.reset_lufs();
    Ok(())
}

#[tauri::command]
fn player_stop(player: State<'_, AtmosPlayer>) -> Result<(), String> {
    player.stop()
}

// ── E5: Notes SQLite persistence ─────────────────────────────────────────────

#[tauri::command]
fn notes_touch_file(path: String, db: State<'_, Arc<NotesDb>>) -> Result<(), String> {
    db.touch_file(&path)
}

#[tauri::command]
fn notes_get_for_file(path: String, db: State<'_, Arc<NotesDb>>) -> Result<FileNotesPayload, String> {
    db.get_payload(&path)
}

#[tauri::command]
fn notes_set_general(path: String, general: String, db: State<'_, Arc<NotesDb>>) -> Result<(), String> {
    db.set_general_note(&path, &general)
}

#[tauri::command]
fn notes_add(path: String, note: NoteInput, db: State<'_, Arc<NotesDb>>) -> Result<NoteRecord, String> {
    db.add_note(&path, &note)
}

#[tauri::command]
fn notes_update(id: i64, note: NoteInput, db: State<'_, Arc<NotesDb>>) -> Result<(), String> {
    db.update_note(id, &note)
}

#[tauri::command]
fn notes_delete(id: i64, db: State<'_, Arc<NotesDb>>) -> Result<(), String> {
    db.delete_note(id)
}

#[tauri::command]
async fn player_waveform(path: String, num_bins: u32) -> Result<Vec<f32>, String> {
    let bins = num_bins.max(1) as usize;
    tauri::async_runtime::spawn_blocking(move || player::atmos::generate_waveform(&path, bins))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AtmosPlayer::new())
        .setup(|app| {
            app.state::<AtmosPlayer>().init(app.handle().clone());

            // Initialize notes DB at <app_data_dir>/pik-pro-notes.db
            let db_path = app
                .path()
                .app_data_dir()
                .map_err(|e| format!("no app_data_dir: {e}"))?
                .join("pik-pro-notes.db");
            let db = NotesDb::open(&db_path)
                .map_err(|e| format!("failed to open notes db at {}: {e}", db_path.display()))?;
            app.manage(Arc::new(db));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_status,
            player_load,
            player_play,
            player_pause,
            player_seek,
            player_set_volume,
            player_position,
            player_is_playing,
            player_meter_json,
            player_set_channel_mutes,
            player_lufs_snapshot,
            player_reset_lufs,
            player_stop,
            notes_touch_file,
            notes_get_for_file,
            notes_set_general,
            notes_add,
            notes_update,
            notes_delete,
            player_waveform
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
