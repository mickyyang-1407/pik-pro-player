use ebur128::{Channel, EbuR128, Mode};
use serde::Serialize;
use std::sync::{Arc, Mutex};

extern "C" {
    fn atmos_drain_samples(
        player: *mut std::ffi::c_void,
        out: *mut f32,
        max_frames: std::os::raw::c_uint,
        out_channels: *mut std::os::raw::c_uint,
        out_sample_rate: *mut std::os::raw::c_uint,
    ) -> std::os::raw::c_uint;
    fn atmos_reset_lufs_ring(player: *mut std::ffi::c_void);
}

/// Snapshot returned to the front-end. All values in dB / LU units.
#[derive(Clone, Debug, Default, Serialize)]
pub struct LufsSnapshot {
    pub available: bool,
    pub sample_rate: u32,
    pub channels: u32,
    pub integrated: Option<f64>,
    pub short_term: Option<f64>,
    pub momentary: Option<f64>,
    pub loudness_range: Option<f64>,
    pub short_term_max: Option<f64>,
    pub momentary_max: Option<f64>,
    pub true_peak_db: Option<f64>,
    pub true_peak_per_channel: Vec<f64>,
    pub sample_peak_db: Option<f64>,
}

pub struct LufsState {
    inner: Arc<Mutex<Inner>>,
}

struct Inner {
    analyzer: Option<EbuR128>,
    channels: u32,
    sample_rate: u32,
    // Running maxima across the session (not per drain).
    short_term_max: Option<f64>,
    momentary_max: Option<f64>,
    // Cached latest snapshot for cheap polling.
    snapshot: LufsSnapshot,
}

impl LufsState {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner {
                analyzer: None,
                channels: 0,
                sample_rate: 0,
                short_term_max: None,
                momentary_max: None,
                snapshot: LufsSnapshot::default(),
            })),
        }
    }

    /// Called when a new file is loaded — clears everything.
    pub fn reset(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.analyzer = None;
        inner.channels = 0;
        inner.sample_rate = 0;
        inner.short_term_max = None;
        inner.momentary_max = None;
        inner.snapshot = LufsSnapshot::default();
    }

    /// Drain samples from the C-side ring and feed them into ebur128.
    /// Returns true if any frames were processed.
    pub fn process_from_player(&self, player_ptr: *mut std::ffi::c_void) -> bool {
        if player_ptr.is_null() {
            return false;
        }

        // Drain up to 8192 frames per call — comfortably above a typical 1024-2048 tap slice at 100Hz poll.
        const MAX_FRAMES: usize = 8192;
        const MAX_CHANNELS: usize = 12;
        let mut buf = vec![0.0f32; MAX_FRAMES * MAX_CHANNELS];
        let mut channels: u32 = 0;
        let mut sample_rate: u32 = 0;

        let frames_read = unsafe {
            atmos_drain_samples(
                player_ptr,
                buf.as_mut_ptr(),
                MAX_FRAMES as u32,
                &mut channels,
                &mut sample_rate,
            )
        };

        if frames_read == 0 || channels == 0 || sample_rate == 0 {
            return false;
        }

        let channels = channels.min(MAX_CHANNELS as u32);
        let mut inner = self.inner.lock().unwrap();

        // (Re)create analyzer if config changed.
        let needs_rebuild = match inner.analyzer.as_ref() {
            None => true,
            Some(_) => inner.channels != channels || inner.sample_rate != sample_rate,
        };

        if needs_rebuild {
            let mode = Mode::I | Mode::S | Mode::M | Mode::LRA | Mode::TRUE_PEAK | Mode::SAMPLE_PEAK;
            match EbuR128::new(channels, sample_rate, mode) {
                Ok(mut analyzer) => {
                    apply_channel_map(&mut analyzer, channels);
                    inner.analyzer = Some(analyzer);
                    inner.channels = channels;
                    inner.sample_rate = sample_rate;
                    inner.short_term_max = None;
                    inner.momentary_max = None;
                }
                Err(_) => return false,
            }
        }

        let slice_len = (frames_read as usize) * (channels as usize);
        let slice = &buf[..slice_len];

        if let Some(analyzer) = inner.analyzer.as_mut() {
            let _ = analyzer.add_frames_f32(slice);
        }

        // Update running maxima.
        let (st_now, m_now) = if let Some(analyzer) = inner.analyzer.as_ref() {
            (
                analyzer.loudness_shortterm().ok().filter(|v| v.is_finite()),
                analyzer.loudness_momentary().ok().filter(|v| v.is_finite()),
            )
        } else {
            (None, None)
        };
        if let Some(s) = st_now {
            let update = match inner.short_term_max {
                Some(m) => s > m,
                None => true,
            };
            if update {
                inner.short_term_max = Some(s);
            }
        }
        if let Some(m) = m_now {
            let update = match inner.momentary_max {
                Some(mx) => m > mx,
                None => true,
            };
            if update {
                inner.momentary_max = Some(m);
            }
        }

        // Rebuild cached snapshot.
        inner.snapshot = build_snapshot(&inner);
        true
    }

    /// Fetch the latest cached snapshot — cheap, no locks on the analyzer.
    pub fn snapshot(&self) -> LufsSnapshot {
        let inner = self.inner.lock().unwrap();
        inner.snapshot.clone()
    }

    /// Reset the LUFS analyser AND clear the C-side ring so we don't process stale samples.
    pub fn reset_with_player(&self, player_ptr: *mut std::ffi::c_void) {
        self.reset();
        if !player_ptr.is_null() {
            unsafe { atmos_reset_lufs_ring(player_ptr) };
        }
    }
}

impl Clone for LufsState {
    fn clone(&self) -> Self {
        Self {
            inner: self.inner.clone(),
        }
    }
}

fn build_snapshot(inner: &Inner) -> LufsSnapshot {
    let mut snap = LufsSnapshot {
        available: inner.analyzer.is_some(),
        sample_rate: inner.sample_rate,
        channels: inner.channels,
        short_term_max: inner.short_term_max,
        momentary_max: inner.momentary_max,
        ..Default::default()
    };

    let Some(analyzer) = inner.analyzer.as_ref() else {
        return snap;
    };

    snap.integrated = analyzer.loudness_global().ok().filter(|v| v.is_finite());
    snap.short_term = analyzer.loudness_shortterm().ok().filter(|v| v.is_finite());
    snap.momentary = analyzer.loudness_momentary().ok().filter(|v| v.is_finite());
    snap.loudness_range = analyzer.loudness_range().ok().filter(|v| v.is_finite());

    // True peak in dBTP: 20*log10(max linear peak). ebur128 returns per-channel linear peaks.
    let mut max_tp_linear = 0.0f64;
    let mut per_channel: Vec<f64> = Vec::with_capacity(inner.channels as usize);
    for ch in 0..inner.channels {
        if let Ok(p) = analyzer.true_peak(ch) {
            let db = linear_to_db(p);
            per_channel.push(db);
            if p > max_tp_linear {
                max_tp_linear = p;
            }
        } else {
            per_channel.push(f64::NEG_INFINITY);
        }
    }
    snap.true_peak_per_channel = per_channel;
    snap.true_peak_db = if max_tp_linear > 0.0 {
        Some(linear_to_db(max_tp_linear))
    } else {
        None
    };

    let mut max_sp_linear = 0.0f64;
    for ch in 0..inner.channels {
        if let Ok(p) = analyzer.sample_peak(ch) {
            if p > max_sp_linear {
                max_sp_linear = p;
            }
        }
    }
    snap.sample_peak_db = if max_sp_linear > 0.0 {
        Some(linear_to_db(max_sp_linear))
    } else {
        None
    };

    snap
}

fn linear_to_db(x: f64) -> f64 {
    if x <= 0.0 {
        f64::NEG_INFINITY
    } else {
        20.0 * x.log10()
    }
}

// Map channel index -> ebur128 Channel type for BS.1770 weighting.
// Backend buffer / meter order (from HANDOFF §8): L R C LFE Ls Rs Lrs Rrs Ltf Rtf Ltr Rtr
fn apply_channel_map(analyzer: &mut EbuR128, channels: u32) {
    // Only apply the ones ebur128 knows how to weight; others stay Unused (not counted).
    let map: &[Channel] = &[
        Channel::Left,          // 0 L
        Channel::Right,         // 1 R
        Channel::Center,        // 2 C
        Channel::Unused,        // 3 LFE (excluded from loudness per BS.1770)
        Channel::LeftSurround,  // 4 Ls  (+1.5 dB weighting)
        Channel::RightSurround, // 5 Rs  (+1.5 dB weighting)
        Channel::Unused,        // 6 Lrs (rear surround — no standard weighting; treat as unused)
        Channel::Unused,        // 7 Rrs
        Channel::Unused,        // 8 Ltf (top front — not in ITU-R BS.1770; unused)
        Channel::Unused,        // 9 Rtf
        Channel::Unused,        // 10 Ltr (top rear)
        Channel::Unused,        // 11 Rtr
    ];
    let n = (channels as usize).min(map.len());
    let _ = analyzer.set_channel_map(&map[..n]);
}
