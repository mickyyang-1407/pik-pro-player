# 工單 C5：把 NotesPanel 拆成獨立元件（最後一張，最大最複雜）

先讀總規範：`/Users/mickyyang/Projects/pik-pro-player/PROMPT-FOR-OPENCODE-2026-07-02-COMPONENTIZATION.md`。
參考已完成模式：`src/components/` 下四支元件，特別是 ref-forwarding 做法（TransportBar 的 `audioInputRef`、Timeline 的 `timelineRef`）。

## 這張工單只做一件事

把 `src/main.tsx` 裡整個 `<aside class="notes-panel">…</aside>`（含 collapse 按鈕、notes-heading 的 Analytics/CSV/JSON/Undo/Redo 按鈕、version-compare-card、reference-card、phase-card、general-note-card、note-filter-bar、note-list、share/email 按鈕）搬到新檔 `src/components/NotesPanel.tsx`。**純搬移，JSX 與 class 名稱逐字相同。**

## Props 做法

搬移的 JSX 裡引用到的每一個外部識別字（signal accessor、memo、callback、常數），**逐一以同名 prop 傳入**，元件內用 `props.xxx` 呼叫。不准解構 props（會破壞 Solid reactivity）。預估 30+ 個 props，這是預期中的，不要為了減少 props 數量而搬移邏輯或改造介面。

共用型別（`Note`、`MixVersion`、`ReferenceTrack`、`SpectrumBand` 等，元件 props 需要的）搬到 `src/types.ts` 並 export，main.tsx 改 import。

Ref 轉發：`referenceInputEl`（reference-card 的隱藏 file input）比照 TransportBar 做 `referenceInputRef: (el) => void`，變數宣告留 main.tsx。

## ⚠️ 兩個致命坑（歷史上都出過事，違反 = 重做）

1. **note-list `<For>` 裡的編輯 textarea 是 uncontrolled**（用 `ref={(el) => {...}}` 設初始值、不在 onInput 寫回 notes signal）。**逐字保留這個 pattern**。絕對不准「順手」改成 `value={...}` controlled——之前這樣改過一次，每敲一鍵整個 list item DOM 被摧毀重建，打字完全不能用。
2. `general-note-card` 的 textarea 是 controlled——這是刻意的（它不在 `<For>` 裡，安全），**也逐字保留**，不要「統一」成 uncontrolled。

## 絕對不准搬（全部留在 main.tsx）

- 所有 notes CRUD / DB persist 邏輯（`persistNote`、debounce timers、`notes_*` invoke）
- Undo/Redo 邏輯（`undoStack`/`redoStack`/`undo`/`redo`/`pushHistory*`/`applySnapshot`）
- `exportNotesCsv`/`exportNotesJson`/`handleShareNotes`/`exportComplianceReport` 本體
- `filteredSortedNotes`/`sortedNotes` memo、篩選 signals 本體
- `notesCollapsed` signal 本體（`panelWidth`/`workspaceGrid` memo 依賴它，必須留 main）
- 全域 keydown、mixVersions 資料與 A/B 邏輯本體、reference/spectrum mock 資料常數（若 JSX 需要直接引用的常數，跟型別一起放 `src/types.ts` 或既有 config 檔，並在回報中列出放哪）

## 不准做

- 不准動 `src/styles.css`、不加功能、不改 signal 命名、不 commit、不動 email payload 結構
- 不動任何 server（orchestrator preview 在 port 1421）

## 完成標準

- `rtk npm run build` 通過、`npx tsc --noEmit` 零 error
- `git diff` 裡 main.tsx 只有「刪掉搬走的部分 + import + 換元件標籤 + referenceInputRef 接線」
- 完成後回報：改了哪些檔、diff 行數、build/tsc 結果、共用型別/常數放哪
