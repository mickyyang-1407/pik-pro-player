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
- **E1 檔案匯入+播放** ✅ Micky 實測過：Load 按鈕拉檔案進來可以播放，transport/seek/space 快捷鍵都走真 backend
- **E2 多聲道 Solo/Mute 真靜音** ✅ 程式完成（2026-07-02，**Micky 尚未在 app 內實測**）
- **E3 真 PPM** ✅ 程式完成（2026-07-02，**Micky 尚未在 app 內實測**）
- Timeline Shift+Click 展開 range 的 bug 已修（見第 8 節錯誤紀錄）

### 進行中（下一棒從這裡開始）
- [ ] **第一件事：開 `npm run tauri dev` 讓 Micky 實測 E2 + E3**：
  - E2 驗收：載入多聲道檔 → 點 C（solo mode）應該只聽到 Center；點 group pills、shift+click 疊加、MUTE 模式反向，聲音都要對；Clear 恢復全部
  - E3 驗收：播放時 PPM 12 軌 bar 要跟著音樂跳（peak 值）；停止時凍結；瀏覽器 preview 看不到真數值是正常的（fallback mock）
  - 有 bug 修完再往下

### 還沒開始
- [ ] **E4 真 LUFS/True Peak**：用 `ebur128` crate（libebur128 Rust binding），**不要自己刻 K-weighting**。在 tap callback 或 observer thread 餵 samples，算 Integrated/Short-term/Momentary + True Peak，取代前端 `currentIntegratedLufs`/`currentTruePeak` 假數值。P4 的 Pass/Warn/Fail 從此是真的
- [ ] **E5 SQLite 存檔**：notes/general note 綁定檔案，參考 `~/Projects/pik-review-player` 的 schema（projects/versions/notes）
- [ ] E6 波形視覺化（低優先）、E7 ADM BWF（看 Micky 需求）
- [ ] Undo/Redo（10 步，PROGRESS.md 提過，優先度由 Micky 決定）

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

---

## 6. 下一棒請做（依序）

1. `npm run tauri dev` 開播放器，請 Micky 實測 E2（solo/mute 靜音）+ E3（PPM 跳動），有 bug 先修
2. E2/E3 過關後做 **E4**（`ebur128` crate，見第 3 節）——做完一樣開播放器給 Micky 測
3. E4 過關後做 **E5**（SQLite notes 持久化）
4. 每步更新 `~/STATUS.md` + 本文件第 3 節

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

---
*交接前請確認第 3、5、6 節是最新狀態。*
