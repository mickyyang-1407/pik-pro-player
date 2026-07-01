use serde::Serialize;
use std::ffi::{CStr, CString};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{AppHandle, Emitter};

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
}

impl AtmosPlayer {
    pub fn new() -> Self {
        Self {
            player: Arc::new(Mutex::new(None)),
            app_handle: Arc::new(Mutex::new(None)),
            observer_running: Arc::new(AtomicBool::new(false)),
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

        self.start_observer(app);
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

    pub fn stop(&self) -> Result<(), String> {
        self.observer_running.store(false, Ordering::SeqCst);

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
