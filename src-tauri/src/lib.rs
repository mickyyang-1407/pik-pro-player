mod player;

use player::atmos::{AtmosPlayer, PositionPayload};
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
fn player_stop(player: State<'_, AtmosPlayer>) -> Result<(), String> {
    player.stop()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AtmosPlayer::new())
        .setup(|app| {
            app.state::<AtmosPlayer>().init(app.handle().clone());
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
            player_stop
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
