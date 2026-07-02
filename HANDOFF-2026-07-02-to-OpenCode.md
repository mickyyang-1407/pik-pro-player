# Micky Handoff Document — pik-pro-player
> 版本：2026-07-02 | 上一棒：Claude Code (Fable 5) | 下一棒：OpenCode + GLM 5.2

---

## 1. 開始之前必讀

1. 讀 `~/STATUS.md` 的 pik-pro-player 區塊（最完整的逐輪進度）
2. 讀本文件全部
3. `git status --short` 確認起點（目前有未 commit 改動，這是正常的）
4. **不可以 commit**，除非 Micky 明確說可以。每小時有 cron 自動備份 commit（`auto: ... 自動備份`），進度不會遺失
5. **不可以 commit / revert `canvas/*` 檔案**

### AI 回答規則
- 繁體中文，條列式；程式碼與指令保留英文
- 不解釋基礎概念，直接給程式碼
- 音訊術語保留英文（LUFS、True Peak、PPM、solo/mute…）
- build/test 指令一律加 `rtk` 前綴：`rtk npm run build`、`rtk cargo check`

### ⚠️ 每次修改完的固定流程（Micky 明確要求）
1. `rtk npm run build` + （動到 Rust 時）`cd src-tauri && rtk cargo check`
2. **打開播放器給 Micky 測試**：`npm run tauri dev`（會自動起 vite + 開 app 視窗）
   - port 1420 被佔用時：`lsof -ti :1420 | xargs kill` 再重跑
3. 等 Micky 測試回報，有 bug 先修，OK 才進下一步
4. 每步完成後更新 `~/STATUS.md` pik-pro-player 區塊 + 本 HANDOFF 第 3 節

---

## 2. 這個專案是什麼

**專案**：`~/Projects/pik-pro-player`（Tauri v2 + SolidJS + Rust + Objective-C AVFoundation bridge）
**目標**：專業 Atmos mix review player——載入 7.1.4 多聲道音檔、真實 metering（PPM/LUFS）、speaker room solo/mute、timeline 上打 timecoded notes 給 producer 檢查 mix 用。
**整體規劃**：`PLAYER-ENGINE-PLAN.md`（E1-E7 引擎 phase + N1-N6 workflow phase，必讀）

---

## 3. 目前進度

### 已完成（全部經 build 驗證，多數經 Micky 確認）
- Metering P1-P5、Timeline/Transport T1-T4、Producer Workflow N1-N6（N4-N6 是 mock prototype）——細節見 `~/STATUS.md`
- **E1 檔案匯入+播放** ✅ Micky 實測過
- **E2 多聲道 Solo/Mute 真靜音** ✅ 程式完成 + `cc` incremental build cache bug 已修
- **E3 真 PPM** ✅ 程式完成
- **E4 真 LUFS / True Peak（ebur128 crate）** ✅ 程式完成（2026-07-02 OpenCode/GLM 5.2）
- **E5 SQLite notes 持久化 + Export JSON** ✅ 程式完成（Micky 自訂 schema，不參考 pik-review-player）
- **Undo/Redo（notes + general note，10 步，⌘Z/⌘⇧Z）** ✅ 程式完成
- **E6 波形背景（AVAssetReader offline pre-scan → SVG polyline）** ✅ 程式完成
- Timeline Shift+Click 展開 range 的 bug 已修（見第 8 節錯誤紀錄）

### 進行中（下一棒從這裡開始）
- [ ] **第一件事：Micky 回來實測 E2/E3/E4/E5**：
  - E2 驗收：載入多聲道檔 → 點 C（solo mode）應該只聽到 Center；group pills、shift+click 疊加、MUTE 模式反向，聲音都要對；Clear 恢復全部
  - E3 驗收：播放時 PPM 12 軌 bar 要跟著音樂跳（peak 值）；停止時凍結
  - E4 驗收：播放時 Integrated LUFS / Short / LR / True Peak / Short-Term Max / Momentary Max 都要跳（Integrated 需要 3 秒 short-term window filled 才有值；沒值時顯示 `—`）；切 target platform 下拉 Pass/Warn/Fail 立刻重算；load 新檔會 reset
  - E5 驗收：載一個檔 → 打 note + general note → 關 app → 重開 → Load 同一個檔 → notes 應該還在；Notes panel 右上有 Export JSON 按鈕，下載出來的 .json 內容含 file/loudness/target/notes 完整結構
  - Undo/Redo 驗收：打幾個 note → 隨便刪、改 status、改 severity、打字 → ⌘Z 應該一步一步倒回（包含 DB row 也會被 delete/re-add）；⌘⇧Z 前進；Notes panel 右上有 Undo/Redo 按鈕（stack empty 時 disabled）
  - E6 驗收：載一個檔 → 稍等（AVAssetReader 掃全檔約幾百 ms 到幾秒不等）→ timeline track 背景應該出現波形（淡藍色 filled envelope），800 bins，垂直包覆整個 track；沒生成完前 timeline 是空的乾淨背景
  - 有 bug 修完再往下

### 還沒開始
- [ ] E6 波形視覺化（低優先）
- [ ] E7 ADM BWF（看 Micky 需求）
- [ ] Undo/Redo（10 步，PROGRESS.md 提過，優先度由 Micky 決定）
- [ ] Google Apps Script + email 通道：把 `exportNotesJson` 的內容 POST 到 GAS webhook，後端 email 出去（Micky 明確提過會用到，時機由他決定）

---

## 4. 重要決定與結論（鎖死，不可推翻）

- 播放引擎用 **AVFoundation bridge**（`atmos_wrapper.m` + `atmos.rs`，從姊妹專案 pik-player 移植），**不要**換 cpal/symphonia 重寫
- LUFS 用 **`ebur128` crate**，不自己刻 DSP
- Speaker layout 用 **CSS grid named areas**，不用 left/top 百分比
- 視窗固定 1500×940 不可自由縮放，只有 zoom 選項（75/100/125/150）
- Notes Panel 固定 25% 寬，只能收/開，不做拖曳調寬
- PPM 是**單欄 12 軌直向堆疊**（不是 2 欄×6 列，做錯過一次被糾正）
- Metering 先算、mute 後清零：**PPM 顯示 source levels**，耳朵聽到 mute 後的（E2 的刻意設計）
- 本地優先，禁止提雲端替代方案

---

## 5. 目前產出（本輪關鍵程式碼位置）

### E2 Solo/Mute（2026-07-02）
- `src-tauri/src/player/atmos_wrapper.m`：`EQContext.muteMask`；`tap_ProcessCallback` 在 metering 後對 mute 聲道 `vDSP_vclr` 清零；`atmos_set_channel_mutes(player, mask)`
- `src-tauri/src/player/atmos.rs`：`set_channel_mutes(&self, mask: u32)`
- `src-tauri/src/lib.rs`：command `player_set_channel_mutes`（已註冊）
- `src/main.tsx`：
  - `channelOrder = ['L','R','C','LFE','Ls','Rs','Lrs','Rrs','Ltf','Rtf','Ltr','Rtr']`（module level，backend buffer 順序）
  - `channelMuteMask` memo：solo mode = mute 未選取聲道；mute mode = mute 選取聲道；沒選（All）= 0
  - createEffect 選取變化自動 invoke；`loadAudioPath` 成功後補送一次 mask（新 player context 是重置的）

### E3 真 PPM（2026-07-02）
- `src/main.tsx`：
  - `ppmTickDb = [-60,-54,-45,-36,-27,-24,-18,-9,-6,-1]` + `ppmPercentFromDb()`（piecewise-linear，刻度等距排列）+ `linearToDb()`
  - `liveMeter` signal + createEffect：Tauri runtime + 已載檔 + PPM 開啟時，100ms 輪詢 `invoke('player_meter_json')`
  - `displayMeterRows` memo：真資料用真的（bar = peak），沒有就 fallback mock `meterRows`

### E4 LUFS / True Peak（2026-07-02，ebur128）
- Cargo dep：`ebur128 = "0.1"`
- `src-tauri/src/player/atmos_wrapper.m`：
  - `SampleRing`（`stdatomic.h` 的 `_Atomic unsigned int` head/tail，SPSC；`LUFS_RING_FRAMES = 65536`；相容 12 ch）
  - `EQContext.lufsRing`；tap process 在 metering 後、mute 前 memcpy source samples 到 ring（**pre-mute**，反映實際檔案內容）；lazy allocate（第一次拿到 channels/frames 才 `calloc`）
  - `atmos_drain_samples(player, out, max_frames, &channels, &sample_rate)`；`atmos_reset_lufs_ring(player)`
- `src-tauri/src/player/lufs.rs`（新檔）：`LufsState { Arc<Mutex<Inner>> }`、`Inner { analyzer: Option<EbuR128>, channels, sample_rate, short_term_max, momentary_max, snapshot }`；channel_map = L/R/C/**Unused (LFE)**/LeftSurround/RightSurround/其他 Unused；mode = I|S|M|LRA|TRUE_PEAK|SAMPLE_PEAK
- `src-tauri/src/player/atmos.rs`：`AtmosPlayer` 加 `lufs_running: AtomicBool` + `lufs: LufsState`；`start_lufs_worker()` 100ms tick 每次最多 drain 4×8192 frames；`load()` reset + start；`stop()` 關 worker + reset；新 methods `lufs_snapshot()` / `reset_lufs()`
- `src-tauri/src/lib.rs`：新 commands `player_lufs_snapshot` / `player_reset_lufs`
- `src/main.tsx`：
  - `LufsSnapshotDto` type；`liveLufs` signal + createEffect 250ms 輪詢
  - `selectedIntegratedLufs`/`selectedTruePeak`/`selectedShortTerm`/`selectedLoudnessRange`/`selectedShortTermMax`/`selectedMomentaryMax` 六個 memo（有真值用真值，`selectedIntegratedLufs`/`selectedTruePeak` fallback 到 mock activeVersion；其他 fallback 到 `—`）
  - `roundTo(value, digits)` helper
  - Hard-coded `'7.6 LU'`/`'-12.8'`/`'-10.9'`/`'-9.8'` 全換掉

### E5 SQLite notes 持久化（2026-07-02）
- Cargo dep：`rusqlite = { version = "0.31", features = ["bundled"] }`（bundled 靜態 link SQLite）
- DB 位置：`<app_data_dir>/pik-pro-notes.db`（macOS：`~/Library/Application Support/com.mickydigitalstudio.pikproplayer/`）；WAL mode + `foreign_keys = ON` + `idx_notes_file_path`
- Schema：
  ```sql
  files(path PK, general_note TEXT, last_opened_at, created_at)
  notes(id AUTO, file_path FK ON DELETE CASCADE, range_start REAL, range_end REAL,
        body, status, kind, severity, created_at, updated_at)
  ```
- `src-tauri/src/notes.rs`（新檔）：`NotesDb { conn: Mutex<Connection> }`；`open/touch_file/get_payload/set_general_note/add_note/update_note/delete_note`；`FileNotesPayload { general_note, notes[] }` serde camelCase
- `src-tauri/src/lib.rs`：`.setup` 中 open DB 並 `app.manage(Arc::new(db))`；新 commands `notes_touch_file` / `notes_get_for_file` / `notes_set_general` / `notes_add` / `notes_update` / `notes_delete`
- `src/main.tsx`：
  - 新增 `loadedFilePath: Signal<string | null>` （之前只有 `trackTitle` = basename，DB key 必須絕對路徑）
  - `NoteRecordDto` / `FileNotesPayloadDto` types；`dtoToNote` / `noteToInput` helpers
  - `persistedNoteIds: Set<number>` 追蹤哪些 id 已寫過 DB（決定 add vs update）；`persistNote(note)` 首次寫入時後端回傳的 DB id 替換前端 local id，並同步 `editingNoteId`/`selectedNoteId`/`lastPointNoteId`
  - `persistNoteById(id)` 即時；`persistNoteByIdDebounced(id)` 350ms debounce（body 打字用）；`persistDeleteNote(id)` 會 cancel pending debounce timer
  - `loadAudioPath` 成功後呼叫 `loadNotesForFile(path)` 覆蓋 signals；`updateNoteBody`/`toggleSeverity`/`cycleStatus`/`deleteNote`/`onTimelineDown` 內部 shift+click promote point→range 全部接上 persist
  - `generalNote` 有 400ms debounce auto-save 到 `notes_set_general`
  - **E6 波形背景**：
    - Objective-C 新 export `atmos_generate_waveform(path, out, num_bins)`：AVAssetReader 讀 LinearPCM float32 interleaved（settings dict）掃全檔，各 channel abs 取 max → mono peak envelope，每 `framesPerBin = totalFrames / num_bins` 收一個 bin 值（[0,1]），寫入 out array；rc=0 成功
    - `player/atmos.rs` 新 `pub fn generate_waveform(path, num_bins) -> Result<Vec<f32>>`（模組級 fn，不依賴 AtmosPlayer state）
    - `lib.rs` 新 `async fn player_waveform(path, num_bins) -> Result<Vec<f32>>` 用 `tauri::async_runtime::spawn_blocking` 跑 blocking pool（decode 可能幾百 ms 到幾秒）
    - 前端：`waveformPeaks: number[] | null` signal + `WAVEFORM_BINS = 800`；`loadWaveformForFile(path)` 在 `loadAudioPath` 成功後 fire-and-forget；`waveformPath()` memo 把 peaks 對稱鏡射 top/bottom 組成 filled SVG path 圍繞 y=50 (viewBox 0..100 height)；`.timeline-track` 內先渲染 `<svg class="waveform-bg" viewBox={\`0 0 ${peaks.length} 100\`} preserveAspectRatio="none">` 讓 SVG 自動拉伸貼齊 timeline 寬度
    - CSS `.waveform-bg { position: absolute; inset: 0; pointer-events: none; z-index: 0; }` — note-range / playhead 疊在上面
  - **Undo/Redo**：`NotesSnapshot = { notes, generalNote }`；`undoStack`/`redoStack` signals max 10；`pushHistory()` 即時 + `pushHistoryDebounced()` 500ms（body/general typing 用）；`applySnapshot(target)` 套回 signals 並 delete/upsert DB rows（`suppressHistory = true` 防 recursive）；⌘Z / ⌘⇧Z 全域快捷鍵、Notes panel Undo/Redo 按鈕
  - 新增 `exportNotesJson()` + Notes panel Export JSON 按鈕，輸出 schemaVersion=1 的完整 payload（file/loudness/target/generalNote/notes[]），設計目標：未來 POST 到 Google Apps Script webhook 讓 GAS 直接 email 出去

---

## 6. 下一棒請做（依序）

1. 開 `npm run tauri dev`，請 Micky 實測 E2/E3/E4/E5 —— 有 bug 先修
2. Bug 修完後，看 Micky 要走哪條：
   - **E6 波形視覺化**：低優先，Micky 也沒特別要求；如果做，可考慮從 tap callback 抓 downsampled peaks（每 N samples 一格）寫進另一個 ring，前端 canvas 畫
   - **E6 波形背景**：
    - Objective-C 新 export `atmos_generate_waveform(path, out, num_bins)`：AVAssetReader 讀 LinearPCM float32 interleaved（settings dict）掃全檔，各 channel abs 取 max → mono peak envelope，每 `framesPerBin = totalFrames / num_bins` 收一個 bin 值（[0,1]），寫入 out array；rc=0 成功
    - `player/atmos.rs` 新 `pub fn generate_waveform(path, num_bins) -> Result<Vec<f32>>`（模組級 fn，不依賴 AtmosPlayer state）
    - `lib.rs` 新 `async fn player_waveform(path, num_bins) -> Result<Vec<f32>>` 用 `tauri::async_runtime::spawn_blocking` 跑 blocking pool（decode 可能幾百 ms 到幾秒）
    - 前端：`waveformPeaks: number[] | null` signal + `WAVEFORM_BINS = 800`；`loadWaveformForFile(path)` 在 `loadAudioPath` 成功後 fire-and-forget；`waveformPath()` memo 把 peaks 對稱鏡射 top/bottom 組成 filled SVG path 圍繞 y=50 (viewBox 0..100 height)；`.timeline-track` 內先渲染 `<svg class="waveform-bg" viewBox={\`0 0 ${peaks.length} 100\`} preserveAspectRatio="none">` 讓 SVG 自動拉伸貼齊 timeline 寬度
    - CSS `.waveform-bg { position: absolute; inset: 0; pointer-events: none; z-index: 0; }` — note-range / playhead 疊在上面
  - **Undo/Redo**：10 步的 note 編輯 undo/redo（PROGRESS.md 提過）
   - **Google Apps Script + email**：接 `exportNotesJson()` 輸出 → HTTPS POST 到 GAS webhook → GAS 收件、email 出去。前端只要加一個「Send to reviewer」按鈕 + email 輸入框；GAS 那端 Micky 自己寫。schemaVersion=1 的 JSON 結構已定，未來加欄位就升 version
   - **E7 ADM BWF**：ADM Broadcast Wave Format metadata（object-based audio）——scope 較大，等 Micky 明確需求
3. 每步完成後更新 `~/STATUS.md` + 本文件第 3、5 節

---

## 7. 禁止事項

- 不可 commit（除非 Micky 明說）；不可動 `canvas/*`
- 不可推翻第 4 節任何決定
- 不可重新設計已完成並經 Micky 確認的 UI（speaker room、metering layout、notes panel 都是定版）
- 不可用雲端方案取代本地方案

---

## 8. 錯誤紀錄（踩過的坑，不要重踩）

- **聲道順序**：backend buffer/meter 順序 = `channelOrder`（L/R/C/LFE/...），前端 `speakers` 陣列是顯示順序（L/C/R/...）——算 mute mask、對 meter label 一律用 `channelOrder`
- **Timeline Shift+Click 塌陷 bug**（已修）：`onTimelineDown` 的 shift 分支原本沒 `setDragStart(origin)`，pointer up 補跑的 `onTimelineMove` 用 `dragStart() ?? current` fallback 把 range 壓回單點。**pattern：任何設定 `isDraggingTimeline(true)` 的路徑都必須同時設好 `dragStart`**
- **`<For>` 裡的編輯輸入框要用 uncontrolled textarea**：onInput 就寫回驅動 `<For>` 的 signal 會讓每個按鍵重建整個 DOM node（焦點/游標中斷）。ref 設初始值、Enter/blur 才 commit
- **`.workspace` grid 下新增 item 要設 `min-height: 0`**，不然內容多會 blowout 撐爆而不是內部捲動
- **select/pill 加 `overflow:hidden` 前先確認文字長度**，不然重要數字被 ellipsis 吃掉（寧可縮短文字）
- **build 過但 dev server 報怪錯**：先重啟 vite 再判斷是不是真 bug（HMR 殘留狀態出過假錯誤）
- **port 1420 被佔**：`lsof -ti :1420 | xargs kill`；vite 是 strictPort，Tauri devUrl 寫死 1420
- **Zoom 縮放未解之謎**：選 75% 時視窗可能不會跟著縮，嫌疑是 `tauri.conf.json` 的 `minWidth/minHeight: 1500×940` 擋住縮小方向的 `setSize()`（capabilities 權限已確認有給）。診斷被 Micky 喊停，**先不要主動去修**，等 Micky 提出再處理
- **`brew upgrade ollama` 禁止**（環境層面，跟本專案無關但別建議）

- **`cc` crate incremental build cache 陷阱**：改了 `atmos_wrapper.m` 加新的 export 函式，但 `cc` crate 沒偵測到 static lib 需要重建，導致 `_atmos_xxx` symbol 不在 `libatmos_wrapper.a` 裡，link 就失敗。修法：`touch src-tauri/build.rs && touch src-tauri/src/player/atmos_wrapper.m && find src-tauri/target/debug/build -name libatmos_wrapper.a -delete` 再 build。之後每次改 `.m` 加/移新的 export，最好都跑這個
- **ebur128 channel_map for 7.1.4 Atmos**：ITU-R BS.1770 只定義 L/R/C/LFE/Ls/Rs 的權重（其中 LFE 排除、Ls/Rs +1.5 dB）。**Lrs/Rrs（rear surround）與 Ltf/Rtf/Ltr/Rtr（top）沒有標準權重**，目前設為 `Channel::Unused`（不計入 loudness）。這是刻意的、對 EBU R128 相容，不要改。如果之後 Micky 要「Atmos 全通道加總」語意，得改成 sum energy manually，而不是動 ebur128 channel map
- **`app_data_dir()` in setup**：Tauri v2 用 `app.path().app_data_dir()`；Bundle identifier 決定資料夾名（`com.mickydigitalstudio.pikproplayer`），如果之後改 identifier，DB 資料會被切斷（新 identifier 對應新資料夾）。要遷移的話寫 script 手動 mv
- **前端 note draft id vs DB id**：draft 用 `nextNoteId()` 給的 local 100+ id，第一次 persist 時 backend 回的 DB id 會取代。任何地方比對 note id 時要意識到 id 會**變**一次（draft→persisted），因此 persist 完後要同時更新 `editingNoteId`/`selectedNoteId`/`lastPointNoteId` 三個相關 signal
---
*交接前請確認第 3、5、6 節是最新狀態。*
