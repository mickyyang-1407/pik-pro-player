# 工單 C4：把 Timeline 拆成獨立元件

先讀總規範：`/Users/mickyyang/Projects/pik-pro-player/PROMPT-FOR-OPENCODE-2026-07-02-COMPONENTIZATION.md`（硬性規則全部適用）。
參考已完成模式：`src/components/SpeakerRoom.tsx`、`LoudnessPanel.tsx`、`TransportBar.tsx`（特別是 TransportBar 的 ref-forwarding 做法）。

## 這張工單只做一件事

把 `src/main.tsx` 裡 `<div class="timeline-card">…</div>` 加上緊接的 `<div class="timeline-hotkeys">…</div>` 兩塊搬到新檔 `src/components/Timeline.tsx`。**純搬移，JSX 與 class 名稱逐字相同。**

## Props（全部 accessor / callback，邏輯不搬）

- `selectedRangeLabel`、`linkTimelineEdit` / `setLinkTimelineEdit`
- `onTimelineDown` / `onTimelineMove` / `onTimelineUp`（pointer handlers 本體留 main.tsx）
- **`timelineRef: (el: HTMLDivElement) => void`**：`.timeline-track` 的 `ref` 轉發回 main.tsx（跟 TransportBar 的 `audioInputRef` 同款做法）。main.tsx 的 `timelineEl` 變數宣告與所有用到它的函式（`timeFromPointer` 的 getBoundingClientRect、setPointerCapture）不用改。
- `waveformPeaks`、`waveformPath`
- `filteredSortedNotes`、`selectedNoteId`、`selectNote`、`deleteNote`
- `playbackDuration`、`displayRange`、`playheadTime`、`timelineTicks`
- `formatTime` 從 `src/utils.ts` import（C3 已抽出）

## 絕對不准搬（全部留在 main.tsx）

- `onTimelineDown`/`onTimelineMove`/`onTimelineUp`/`timeFromPointer` 本體——**這裡有歷史 bug**：任何設 `isDraggingTimeline(true)` 的路徑都必須同時設好 `dragStart`，之前 shift+click 就是漏這個壞掉的。純搬移不碰這些函式就不會踩到，但如果你發現搬移需要動到它們，停下來在回報裡說明，不要自己改。
- `lockedRange`/`dragStart`/`isDraggingTimeline`/`selectedNoteId` 等 signal 本體
- 波形載入邏輯（`loadWaveformForFile`、`player_waveform` invoke）
- Note 的新增/刪除/選取邏輯本體

## 不准做

- 不准動 `src/styles.css`、其他 UI 區塊、不加功能、不改 signal 命名、不 commit
- `<For each={filteredSortedNotes()}>` 內的 note-range JSX（含 stopPropagation、delete 按鈕）逐字保留

## 完成標準

- `rtk npm run build` 通過、`npx tsc --noEmit` 零 error
- `git diff` 裡 main.tsx 只有「刪掉搬走的部分 + 加 import + 換元件標籤 + timelineRef 接線」
- 完成後回報：改了哪些檔、diff 行數、build/tsc 結果
