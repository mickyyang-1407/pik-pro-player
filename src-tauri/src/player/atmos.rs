use serde::Serialize;
use std::ffi::{CStr, CString};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter};

use super::lufs::{LufsSnapshot, LufsState};

extern "C" {
    fn atmos_create(path: *const std::os::raw::c_char) -> *mut std::ffi::c_void;
    fn atmos_destroy(player: *mut std::ffi::c_void);
    fn atmos_play(player: *mut std::ffi::c_void);
    fn atmos_pause(player: *mut std::ffi::c_void);
    fn atmos_set_volume(player: *mut std::ffi::c_void, volume: f32);
    fn atmos_seek(player: *mut std::ffi::c_void, position: f64);
    fn atmos_get_position(player: *mut std::ffi::c_void) -> f64;
    fn atmos_get_duration(player: *mut std::ffi::c_void) -> f64;
    fn atmos_is_playing(player: *mut std::ffi::c_void) -> std::os::raw::c_int;
    fn atmos_get_meter_json(player: *mut std::ffi::c_void) -> *mut std::os::raw::c_char;
    fn atmos_set_channel_mutes(player: *mut std::ffi::c_void, mute_mask: std::os::raw::c_uint);
    fn atmos_generate_waveform(
        path: *const std::os::raw::c_char,
        out: *mut f32,
        num_bins: std::os::raw::c_uint,
    ) -> std::os::raw::c_int;
    fn free_audio_devices_json(ptr: *mut std::os::raw::c_char);
}

#[derive(Clone, Serialize)]
pub struct PositionPayload {
    pub position: f64,
    pub duration: f64,
}

#[derive(Clone)]
pub struct AtmosPlayer {
    player: Arc<Mutex<Option<usize>>>,
    app_handle: Arc<Mutex<Option<AppHandle>>>,
    observer_running: Arc<AtomicBool>,
    lufs_running: Arc<AtomicBool>,
    lufs: LufsState,
}

impl AtmosPlayer {
    pub fn new() -> Self {
        Self {
            player: Arc::new(Mutex::new(None)),
            app_handle: Arc::new(Mutex::new(None)),
            observer_running: Arc::new(AtomicBool::new(false)),
            lufs_running: Arc::new(AtomicBool::new(false)),
            lufs: LufsState::new(),
        }
    }

    pub fn init(&self, app: AppHandle) {
        *self.app_handle.lock().unwrap() = Some(app);
    }

    pub fn load(&self, path: &str) -> Result<PositionPayload, String> {
        let app = self
            .app_handle
            .lock()
            .unwrap()
            .as_ref()
            .cloned()
            .ok_or("No app handle")?;

        self.stop()?;

        let c_path = CString::new(path).map_err(|e| e.to_string())?;
        let player_ptr = unsafe { atmos_create(c_path.as_ptr()) };
        if player_ptr.is_null() {
            return Err("AVFoundation could not create a player for this file".into());
        }

        {
            let mut player = self.player.lock().unwrap();
            *player = Some(player_ptr as usize);
        }

        self.lufs.reset();
        self.start_observer(app);
        self.start_lufs_worker();
        self.position().ok_or("Player loaded without a readable position".into())
    }

    fn start_observer(&self, app: AppHandle) {
        if self.observer_running.swap(true, Ordering::SeqCst) {
            return;
        }

        let player_arc = self.player.clone();
        let running = self.observer_running.clone();

        std::thread::spawn(move || {
            let mut was_playing = false;

            while running.load(Ordering::SeqCst) {
                let snapshot = {
                    let player = player_arc.lock().unwrap();
                    player.map(|ptr| {
                        let ptr = ptr as *mut std::ffi::c_void;
                        let position = unsafe { atmos_get_position(ptr) };
                        let duration = unsafe { atmos_get_duration(ptr) };
                        let is_playing = unsafe { atmos_is_playing(ptr) } != 0;
                        (position, duration, is_playing)
                    })
                };

                let Some((position, duration, is_playing)) = snapshot else {
                    break;
                };

                if is_playing {
                    let _ = app.emit("av:position", PositionPayload { position, duration });
                    if !was_playing {
                        let _ = app.emit("av:playing", ());
                        was_playing = true;
                    }
                } else if was_playing {
                    let _ = app.emit("av:paused", ());
                    was_playing = false;
                }

                if duration > 0.0 && position >= duration - 0.1 && is_playing {
                    let _ = app.emit("av:ended", ());
                }

                std::thread::sleep(std::time::Duration::from_millis(250));
            }

            running.store(false, Ordering::SeqCst);
        });
    }

    fn start_lufs_worker(&self) {
        if self.lufs_running.swap(true, Ordering::SeqCst) {
            return;
        }

        let player_arc = self.player.clone();
        let running = self.lufs_running.clone();
        let lufs = self.lufs.clone();

        std::thread::spawn(move || {
            while running.load(Ordering::SeqCst) {
                let ptr_opt = {
                    let p = player_arc.lock().unwrap();
                    *p
                };
                if let Some(ptr) = ptr_opt {
                    let ptr = ptr as *mut std::ffi::c_void;
                    // Drain repeatedly to keep the ring below overflow when playback is running.
                    // Loop bounded so we don't starve — max 4 drains per tick (~32k frames).
                    for _ in 0..4 {
                        if !lufs.process_from_player(ptr) {
                            break;
                        }
                    }
                }
                std::thread::sleep(std::time::Duration::from_millis(100));
            }
            running.store(false, Ordering::SeqCst);
        });
    }

    pub fn play(&self) -> Result<(), String> {
        self.with_player(|ptr| unsafe { atmos_play(ptr) })
    }

    pub fn pause(&self) -> Result<(), String> {
        self.with_player(|ptr| unsafe { atmos_pause(ptr) })
    }

    pub fn set_volume(&self, volume_percent: f64) -> Result<(), String> {
        let volume = (volume_percent / 100.0).clamp(0.0, 1.0) as f32;
        self.with_player(|ptr| unsafe { atmos_set_volume(ptr, volume) })
    }

    pub fn seek(&self, position: f64) -> Result<(), String> {
        self.with_player(|ptr| unsafe { atmos_seek(ptr, position.max(0.0)) })
    }

    pub fn position(&self) -> Option<PositionPayload> {
        let player = self.player.lock().unwrap();
        player.map(|ptr| {
            let ptr = ptr as *mut std::ffi::c_void;
            PositionPayload {
                position: unsafe { atmos_get_position(ptr) },
                duration: unsafe { atmos_get_duration(ptr) },
            }
        })
    }

    pub fn set_channel_mutes(&self, mask: u32) -> Result<(), String> {
        self.with_player(|ptr| unsafe { atmos_set_channel_mutes(ptr, mask) })
    }

    pub fn meter_json(&self) -> Option<String> {
        let player = self.player.lock().unwrap();
        let ptr = (*player)? as *mut std::ffi::c_void;
        let json_ptr = unsafe { atmos_get_meter_json(ptr) };
        if json_ptr.is_null() {
            return None;
        }

        let json = unsafe { CStr::from_ptr(json_ptr).to_string_lossy().into_owned() };
        unsafe { free_audio_devices_json(json_ptr) };
        Some(json)
    }

    pub fn is_playing(&self) -> bool {
        let player = self.player.lock().unwrap();
        player
            .map(|ptr| unsafe { atmos_is_playing(ptr as *mut std::ffi::c_void) != 0 })
            .unwrap_or(false)
    }

    pub fn lufs_snapshot(&self) -> LufsSnapshot {
        self.lufs.snapshot()
    }

    pub fn reset_lufs(&self) {
        let ptr = {
            let p = self.player.lock().unwrap();
            (*p).map(|ptr| ptr as *mut std::ffi::c_void)
        };
        if let Some(ptr) = ptr {
            self.lufs.reset_with_player(ptr);
        } else {
            self.lufs.reset();
        }
    }

    pub fn stop(&self) -> Result<(), String> {
        self.observer_running.store(false, Ordering::SeqCst);
        self.lufs_running.store(false, Ordering::SeqCst);
        self.lufs.reset();

        let mut player = self.player.lock().unwrap();
        if let Some(ptr) = player.take() {
            unsafe { atmos_destroy(ptr as *mut std::ffi::c_void) };
        }

        Ok(())
    }

    fn with_player(&self, action: impl FnOnce(*mut std::ffi::c_void)) -> Result<(), String> {
        let player = self.player.lock().unwrap();
        let Some(ptr) = *player else {
            return Err("No audio file is loaded".into());
        };

        action(ptr as *mut std::ffi::c_void);
        Ok(())
    }
}

/// Offline waveform overview — reads the file with AVAssetReader and produces
/// `num_bins` peak values in [0.0, 1.0]. Runs on the caller's thread and can be slow
/// for long files; call from a spawn_blocking / std::thread::spawn context.
pub fn generate_waveform(path: &str, num_bins: usize) -> Result<Vec<f32>, String> {
    if num_bins == 0 {
        return Err("num_bins must be > 0".into());
    }
    let c_path = CString::new(path).map_err(|e| e.to_string())?;
    let mut buf = vec![0.0f32; num_bins];
    let rc = unsafe { atmos_generate_waveform(c_path.as_ptr(), buf.as_mut_ptr(), num_bins as u32) };
    if rc != 0 {
        return Err("waveform generation failed".into());
    }
    Ok(buf)
}
