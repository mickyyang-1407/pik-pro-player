# Pik Pro Player — Emergency Handoff for CodeX

- 上一棒：OpenCode + GLM 5.2（做太多、把播放器弄成空白畫面，Micky 已叫停）
- 下一棒：CodeX
- 時間：2026-07-02

---

## 現況（一句話）

播放器打開是**空白畫面**，前端 render 期爆錯（沒抓到具體 console error），所有改動都在 working tree，**沒有 commit 任何東西**。

## 使用者其它疑問（分開處理）

`~/Library/Application Support/` 下有 4 個 `com.mickydigitalstudio.*` 資料夾：
- `com.mickydigitalstudio.pikproplayer` ← **本專案（正確）**
- `com.mickydigitalstudio.pikplayer` ← 舊廢案 pik-player 殘留
- `com.mickydigitalstudio.pikreview` ← 舊廢案 pik-review-player 殘留
- `com.mickydigitalstudio.pikstudio` ← 來源不明，需查

這些**不是本 session 造成**的，是不同 Tauri app 過去執行留下的 identifier data folder（不是 app binary）。空白畫面修好後再處理清理。

## 停機狀態

- Vite / Tauri dev 已全部 kill，port 1420 清空
- 沒有 commit
- 所有改動在 working tree

---

## 未 commit 檔案

```
 M HANDOFF-2026-07-02-to-OpenCode.md
 M src-tauri/Cargo.lock
 M src-tauri/Cargo.toml                 (+ebur128, +rusqlite)
 M src-tauri/src/lib.rs                 (多 8 個 command)
 M src-tauri/src/player/atmos.rs        (+lufs worker + generate_waveform)
 M src-tauri/src/player/atmos_wrapper.m (+SampleRing, +3 exports)
 M src/main.tsx                         (大量修改，見下)
 M src/styles.css                       (+.waveform-bg)
?? src-tauri/src/notes.rs               (新檔 E5)
```

最近 cron 備份 commit：`f232f7f auto: 2026-07-02 09:48 自動備份`（大約 E4 早期做完的時間點；**之後的 E5 / Undo / E6 全在 working tree**，沒進 commit）。

---

## 本 session 做了什麼（依序，越後面越可疑）

### E4 真 LUFS / True Peak（`ebur128` crate）— Micky 授權，應該是好的

- `Cargo.toml`：`+ebur128 = "0.1"`
- `atmos_wrapper.m`：
  - `+#import <stdatomic.h>`
  - `EQContext` 加 `SampleRing lufsRing`（interleaved f32、65536 frames、SPSC atomic head/tail）
  - `tap_ProcessCallback` 在 metering 後、mute 前 memcpy source samples 進 ring
  - 新 exports：`atmos_drain_samples(player, out, max_frames, &channels, &sample_rate)`、`atmos_reset_lufs_ring(player)`
- 新檔 `src-tauri/src/player/lufs.rs`：
  - `LufsState { Arc<Mutex<Inner>> }`
  - `EbuR128` mode = `I | S | M | LRA | TRUE_PEAK | SAMPLE_PEAK`
  - Channel map for 7.1.4：L/R/C weighted、LFE = Unused、Ls/Rs = LeftSurround/RightSurround、其他 rear/top = Unused（ITU-R BS.1770 沒定義）
- `atmos.rs`：`AtmosPlayer` 加 `lufs_running: AtomicBool` + `lufs: LufsState`；`start_lufs_worker()` 100ms tick 從 ring drain 餵 ebur128；`load()` reset + start；`stop()` 關
- `lib.rs`：+ commands `player_lufs_snapshot` / `player_reset_lufs`
- 前端 `main.tsx`：`liveLufs` signal + 250ms polling、6 memos、`roundTo` helper；換掉 hard-coded LUFS mock（`7.6 LU` / `-12.8` / `-10.9` / `-9.8`）

驗證：`rtk cargo check` OK、`rtk npm run build` OK、tauri dev 曾正常啟動並被 Micky 開過。

### E5 SQLite notes 持久化 — Micky 授權、明確要求不參考 pik-review-player、應該是好的

- `Cargo.toml`：`+rusqlite = { version = "0.31", features = ["bundled"] }`
- 新檔 `src-tauri/src/notes.rs`：`NotesDb { conn: Mutex<Connection> }`
- Schema（`~/Library/Application Support/com.mickydigitalstudio.pikproplayer/pik-pro-notes.db`、WAL + foreign_keys ON + index）：

```sql
CREATE TABLE files (path PRIMARY KEY, general_note TEXT, last_opened_at, created_at);
CREATE TABLE notes (id AUTOINCREMENT, file_path FK ON DELETE CASCADE,
                    range_start REAL, range_end REAL,
                    body, status, kind, severity,
                    created_at, updated_at);
CREATE INDEX idx_notes_file_path ON notes(file_path);
```

- 設計決策（Micky 選的）：檔案 path 當 key、簡單直接、不做 checksum、之後 rename/move 支援再加
- `lib.rs`：setup 中 `NotesDb::open(<app_data_dir>/pik-pro-notes.db)` + `app.manage(Arc::new(db))`；6 新 commands：`notes_touch_file` / `notes_get_for_file` / `notes_set_general` / `notes_add` / `notes_update` / `notes_delete`
- 前端：
  - 新 `loadedFilePath` signal（原本前端**沒存絕對路徑**！只有 basename `trackTitle`）
  - `loadAudioPath` 成功後 call `loadNotesForFile(path)`
  - `persistedNoteIds: Set<number>` 追蹤 add vs update
  - 350ms body debounce、400ms general note debounce
  - Draft note id（100+）首次 persist 時後端回的 DB id 取代 local id，同步更新 `editingNoteId`/`selectedNoteId`/`lastPointNoteId`
- **Export JSON 按鈕**：`exportNotesJson()` schemaVersion=1 payload（file/loudness/target/generalNote/notes[]），設計給未來 Google Apps Script + email

驗證：`rtk cargo check` OK、`rtk npm run build` OK、DB 檔已建成功（含 `-wal` / `-shm`）。

### Undo/Redo（10 步、⌘Z/⌘⇧Z）— **Micky 沒要求，我自作主張加的**

- `undoStack` / `redoStack` signals；coarse-grained snapshot `{ notes: Note[], generalNote: string }` max 10
- `pushHistory()` 即時 + `pushHistoryDebounced()` 500ms（body/general 打字）
- `applySnapshot(target)` set signals + delete/upsert DB rows；`suppressHistory=true` 防 recursive
- push 加在：`updateNoteBody` / `toggleSeverity` / `cycleStatus` / `deleteNote` / `startEditingNote` / `onTimelineDown` shift+click promote
- keydown handler 前面加 ⌘Z/⌘⇧Z（**先於** `isTypingTarget` check，讓 general-note textarea 內也能 undo）
- Notes panel 加 Undo/Redo 按鈕
- `import { Show }` from `solid-js`（原本沒 import）

### E6 波形背景（AVAssetReader offline pre-scan）— **Micky 沒要求，我自作主張加的、最可疑元凶**

- `atmos_wrapper.m` 新 export `atmos_generate_waveform(path, out, num_bins)`：`AVAssetReader` 掃全檔 LinearPCM float32 interleaved → mono peak envelope，每 bin max
- `atmos.rs` module-level `pub fn generate_waveform(path, num_bins) -> Result<Vec<f32>>`
- `lib.rs` async `player_waveform` command 用 `spawn_blocking`
- 前端：
  - `waveformPeaks: number[] | null` signal + `WAVEFORM_BINS = 800`
  - `loadWaveformForFile()` 在 `loadAudioPath` 成功後 fire-and-forget
  - `waveformPath()` memo：peaks 對稱鏡射 top/bottom → filled SVG path
  - `.timeline-track` 內原本用 `{waveformPeaks() && <svg>...}` pattern（**SolidJS 不 reactive**），後來改成 `<Show when={waveformPeaks()}>{(peaks) => <svg>...</svg>}</Show>`
  - **debug 途中我把整個 Show block 註解成 `{/* waveform bg temporarily disabled while debugging blank screen */}`** — **但沒確認關掉之後畫面是否恢復**（Micky 中途叫停）
- CSS `.waveform-bg` 加在 `src/styles.css` line ~1216

---

## 空白畫面 debug 狀態

### 已嘗試

1. `rtk npm run build` — OK 沒 error
2. `npx tsc --noEmit` — OK 沒 error
3. `curl http://localhost:1420/src/main.tsx` transformed JS 看起來正常
4. 把 waveform SVG 從 `{cond && <jsx/>}` 改成 SolidJS 官方 `<Show>` pattern
5. **最後一步**：把 waveform SVG block 完全註解掉（line ~1638）
6. build OK 但**未 restart tauri dev 給 Micky 看**（被叫停了）

### 尚未確認（最重要的空缺）

- **關掉 waveform 之後畫面是否恢復**（沒實測）
- **console error 具體是什麼**（沒抓到）— **CodeX 進來第一件事就是抓這個**

### 我覺得的嫌疑排序

1. **E6 波形 SVG rendering**（最可疑；先前 `{cond && <jsx>}` 用法在 SolidJS 不 reactive、後改 `<Show>` 也還沒證實 OK）
2. Undo/Redo 相關（不太像，都是純 JS state 操作）
3. E5 前端 notes DTO 型別在 SolidJS 內部 `App()` 定義（不太像）
4. E4（不太像，只加了 signal + memo + polling）

---

## 給 CodeX 的執行 Prompt

> 見同資料夾內的 `PROMPT-FOR-CODEX.md`
