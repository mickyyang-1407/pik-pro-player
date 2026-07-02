# 工單 C1：把 SpeakerRoom 拆成獨立元件

先讀總規範：`/Users/mickyyang/Projects/pik-pro-player/PROMPT-FOR-OPENCODE-2026-07-02-COMPONENTIZATION.md`（硬性規則全部適用）。

## 這張工單只做一件事

把 `src/main.tsx` 裡 `<section class="speaker-view">`（約 line 1614-1697）搬到新檔 `src/components/SpeakerRoom.tsx`。**純搬移，JSX 與 class 名稱逐字相同，不改任何行為。**

## 具體步驟

1. 新增 `src/speakerConfig.ts`：把 `Speaker` type（main.tsx line ~14）、`speakers` const（line ~78）、`channelOrder` const（line ~93 附近）從 main.tsx 搬過去並 export。main.tsx 改成 import（`channelMuteMask`、E2 mute 邏輯還需要它們，**那些邏輯留在 main.tsx 不准搬**）。
2. 新增 `src/components/SpeakerRoom.tsx`：
   - 搬入 `speaker-view` section 的完整 JSX（speaker-control-bar、SOLO/MUTE mode toggle、group pills、Clear pill、speaker-view-title、room-plane、speaker-grid、speaker buttons）
   - 這些搬進元件內部：`gridScale` signal（line ~572）、`BASE_ROOM_W = 420`（line ~573）、`roomPlaneEl` ref（line ~569）、ResizeObserver 那段 onMount/onCleanup（line ~1395-1402，注意只搬 ResizeObserver 這段，同一個 onMount 裡的 keydown handler 留在 main.tsx）
   - Props（全部從 main.tsx 傳入，用 Solid 的 accessor 形式）：
     - `speakerMode: Accessor<'solo' | 'mute'>`、`setSpeakerMode`
     - `soloGroups: Accessor<Set<Speaker['group']>>`、`activeSpeakers: Accessor<Set<string>>`
     - `toggleGroup`、`toggleSpeaker`（callbacks，邏輯留 main.tsx）
     - `selectionLabel: Accessor<string>`
     - `onClear: () => void`（Clear pill 原本 inline 的 `setLockedRange/setSelectedNoteId/setSoloGroups/setActiveSpeakers` 四連發包成 main.tsx 裡的一個函式傳進來，因為它動到 timeline/notes 的 state）
3. main.tsx 原位置換成 `<SpeakerRoom ...props />`。

## 不准做

- 不准動 `channelMuteMask`、`player_set_channel_mutes` 相關邏輯（留 main.tsx）
- 不准動 `src/styles.css`
- 不准動其他任何 UI 區塊（Timeline、Notes、Loudness、Transport 都是之後的工單）
- 不准加新功能、不准「順手優化」、不准改 signal 命名
- 不准 commit

## 完成標準

- `rtk npm run build` 通過
- `npx tsc --noEmit` 通過
- `git diff` 裡 main.tsx 只有「刪掉搬走的部分 + 加 import + 換成元件標籤」，沒有其他改動

完成後回報：改了哪些檔、diff 行數、build/tsc 結果。
