# CodeX Prompt — 修救 pik-pro-player 空白畫面

> 直接把下面這整段貼給 CodeX：

---

接手 `~/Projects/pik-pro-player` 修救工作。上一棒 OpenCode + GLM 5.2 做太多、把播放器弄成空白畫面，Micky 已叫停。

## 必讀（依序）

1. `~/Projects/pik-pro-player/HANDOFF-CODEX-2026-07-02-RESCUE.md` ← 這份最重要
2. `~/Projects/pik-pro-player/HANDOFF-2026-07-02-to-OpenCode.md` ← 原本 OpenCode 的交接
3. `~/STATUS.md` 的 pik-pro-player 區塊
4. `git status --short` + `git diff --stat` 大致看範圍 — **不要 commit / 不要 reset / 不要 checkout**，先觀察

## 環境限制

- 音訊 / DSP 術語保留英文（LUFS、True Peak、PPM、SPSC ring、tap callback）
- 繁體中文、條列式回覆
- 每個 build / test 指令用 `rtk` 前綴（例：`rtk npm run build`、`rtk cargo check`）
- port 1420 被佔就 `lsof -ti :1420 | xargs kill` 再重跑
- **不可以 commit，除非 Micky 明說**
- **不可以動 `canvas/*`**
- **不可以推翻 HANDOFF 第 4 節鎖定的決定**（AVFoundation bridge、CSS grid speaker layout、ebur128、Notes 25% 固定寬、PPM 12 軌單欄、metering 先算 mute 後清零）
- 不可以用雲端方案取代本地方案

## 你的任務（依序）

### 第一步：**先開起來讓 Micky 看到播放器**，不要碰任何東西

```bash
cd ~/Projects/pik-pro-player
lsof -ti :1420 | xargs kill 2>/dev/null
pkill -f "target/debug/pik-pro-player" 2>/dev/null
pkill -f "cargo run" 2>/dev/null
sleep 2
npm run tauri dev
```

等 tauri app 視窗開起來，**確認是空白還是有畫面**。

### 第二步：抓 console error

- macOS：Tauri v2 webview 支援用 Safari 遠端 debugger。或用 `RUST_LOG=debug npm run tauri dev` 看 Rust log
- 開 tauri app 後在 Safari → Develop → localhost → 選 pik-pro-player 的 webview → Console
- 把**確切的 error message + stack trace 抓下來**貼回來給 Micky

### 第三步：根據 error 對症下藥

**嫌疑最大**是 E6 波形 SVG rendering。我在 debug 過程已經把它註解掉了（`src/main.tsx` line ~1638 附近搜 `waveform bg temporarily disabled`），但**沒有實測是否恢復**。

如果 restart tauri dev 後畫面恢復：
- 確認是 E6 波形問題
- **建議下一步**：把 E6 相關全部乾淨移除（Objective-C `atmos_generate_waveform` + `atmos.rs` `generate_waveform` fn + `lib.rs` `player_waveform` command + `main.tsx` `waveformPeaks` / `WAVEFORM_BINS` / `loadWaveformForFile` / `waveformPath` + 那個註解掉的 Show block + `src/styles.css` `.waveform-bg` + `import { Show }` 如果沒別的地方用）
- 保留 E4 + E5 + Undo/Redo（雖然 Undo/Redo 是自作主張，但如果 Micky 沒特別反對可以留下）

如果 restart 後畫面**還是空白**：
- 依 emergency-handoff 的「嫌疑排序」往下查
- 可以考慮 `git stash` 全部改動，逐一 stash pop 找出 breaking change

### 第四步：修好後跟 Micky 確認

- 修好第一件事：`npm run tauri dev` 開播放器讓 Micky 實測 E2/E3/E4/E5
- 用 `rtk npm run build` + `rtk cargo check` 驗證
- 一定要 Micky 明確確認 OK 才能繼續動下一步
- **不要自作主張加功能**（我上一棒犯的錯）

## 使用者其它疑問（**空白畫面修好後再處理**）

`~/Library/Application Support/` 下有 4 個 `com.mickydigitalstudio.*` 資料夾：
- `com.mickydigitalstudio.pikproplayer` ← 本專案（正確）
- `com.mickydigitalstudio.pikplayer` ← 舊 pik-player 廢案
- `com.mickydigitalstudio.pikreview` ← 舊 pik-review-player 廢案
- `com.mickydigitalstudio.pikstudio` ← 來源不明

這些是不同 Tauri app 過去執行留下的 identifier data folder（**不是 app binary**）。Micky 反映「application 裡一堆 pik player 是不是把所有 player 混在一起了」→ 幫他確認：

1. `ls /Applications/ | grep -i pik` + `find /Applications -maxdepth 3 -iname "*pik*"` 看是不是 `/Applications` 下真的有多個
2. `ls -la ~/Library/Application\ Support/ | grep -i pik` 只是 data folder
3. 舊廢案 identifier 的 data folder 要不要清是 Micky 決定，別自己動

## 完成後

- 更新 `~/STATUS.md` pik-pro-player 區塊
- 更新 `HANDOFF-CODEX-2026-07-02-RESCUE.md` 或另建新的 HANDOFF 檔記錄結果
- **絕對不 commit** 除非 Micky 明說可以

祝順利。
