# 工單 C3：把 TransportBar（整個 topbar header）拆成獨立元件

先讀總規範：`/Users/mickyyang/Projects/pik-pro-player/PROMPT-FOR-OPENCODE-2026-07-02-COMPONENTIZATION.md`（硬性規則全部適用）。
參考已完成的模式：`src/components/SpeakerRoom.tsx`、`src/components/LoudnessPanel.tsx`。

## 這張工單只做一件事

把 `src/main.tsx` 裡整個 `<header class="topbar">`（約 line 1358-1424，含 topbar-left 的曲名+Load、transport-bar 的 Stop/Play/Loop/時間、topbar-right 的 Theme 下拉/Default Size/loadStatus/version meta）搬到新檔 `src/components/TransportBar.tsx`。**純搬移，JSX 與 class 名稱逐字相同。**

## 具體步驟

1. 新增 `src/utils.ts`：把 `formatTime`（main.tsx line ~187）搬過去 export，main.tsx 改 import（main.tsx 很多地方還在用）。
2. 新增 `src/components/TransportBar.tsx`。Props：
   - `trackTitle`、`isPlaying`、`loopEnabled`、`playheadTime`、`loadStatus`（Accessor）
   - `appTheme` / `setAppTheme`
   - `activeVersion`（memo accessor，只用到 `.title` 和 `.label`）
   - callbacks：`onLoadAudioClick`、`onAudioFileChange`、`stopPlayback`、`togglePlay`、`toggleLoop`、`resetWindowSize`（本體全留 main.tsx）
   - **`audioInputRef: (el: HTMLInputElement) => void`**：隱藏 file input 的 `ref` 改成 `ref={(el) => props.audioInputRef(el)}`，main.tsx 傳 `(el) => (audioInputEl = el)` 進來。這樣 main.tsx 的 `onLoadAudioClick` 裡 `audioInputEl?.click()`（非 Tauri fallback）不用改就能繼續運作。**`audioInputEl` 變數宣告留在 main.tsx。**
3. main.tsx 原位置換成 `<TransportBar ...props />`。

## 不准搬（全部留在 main.tsx）

- `togglePlay`/`stopPlayback`/`toggleLoop`/`onLoadAudioClick`/`onAudioFileChange`/`loadAudioPath`/`resetWindowSize` 函式本體
- 播放時鐘、`isPlaying`/`playheadTime`/`loopEnabled`/`trackTitle`/`loadStatus`/`appTheme` signal 本體
- 全域 keydown 快捷鍵邏輯

## 不准做

- 不准動 `src/styles.css`、其他 UI 區塊、不加功能、不改 signal 命名、不 commit
- Theme 下拉的五個 option（light/dark/spotify/ableton/flstudio）文字與 value 逐字保留
- `<main class="review-app" data-theme={appTheme()}>` 的 data-theme 綁定在 main.tsx，不要動

## 完成標準

- `rtk npm run build` 通過、`npx tsc --noEmit` 除 pre-existing `src/services/share.ts(25)` 外零 error
- `git diff` 裡 main.tsx 只有「刪掉搬走的部分 + 加 import + 換元件標籤 + audioInputRef 接線」
- 完成後回報：改了哪些檔、diff 行數、build/tsc 結果
