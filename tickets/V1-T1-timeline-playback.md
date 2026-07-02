# 工單 V1-T1：Timeline 播放與 Note 互動邏輯

來源：Micky 總修改單 V1（2026-07-02）Timeline 和 Note 互動 1-2。
功能工單：改 `src/main.tsx` 的 timeline pointer 邏輯為主；`src/components/Timeline.tsx` 只在需要加 event 時小改（JSX 結構盡量不動）。

## 需求（這是製作人的工作播放邏輯，語意要精準）

1. **雙擊 = 插入 point note（不受 link 影響）**：在 `.timeline-track` 上雙擊任何位置 → 在該時間點建立 point note 並進入 inline 編輯（走既有 `addPointNote` 路徑但時間用點擊位置，不是 playheadTime）。不管音樂正在播放或停止、link 開或關，都成立。雙擊不應觸發兩次單擊 seek 或建立 drag 框選。
2. **單擊 = 定位（一定成立，與 link 無關）**：
   - **停止狀態**：點哪裡，playhead（藍點）就移到哪裡。之後按 Space，從該位置開始播放。
   - **播放中**：點哪裡，播放立刻跳到哪裡繼續播（不中斷播放狀態）。
3. **link（Link Edit to Playhead）開啟時的差異**：單擊除了定位，**還會立刻開始播放**（即使原本是停止狀態）。
4. 既有行為必須保留：拖曳框選 range、shift+click 展開 range、點擊已存在 note = 選取、框內點擊生成 range note（這條跟新的「單擊=定位」有衝突風險——**解法**：框內單擊仍優先「生成 range note」（既有守衛 `selectedNoteId() === null` 等照舊），框外單擊才走定位邏輯。雙擊在框內也是插 point note 優先於 range note？不——**雙擊一律插 point note**，優先級最高）。

## ⚠️ 歷史坑（必讀）

- 任何設 `isDraggingTimeline(true)` 的路徑都要同時設好 `dragStart`（之前 shift+click 就是漏這個壞掉）
- 單擊 vs 雙擊 vs 拖曳的判別：pointerdown→move 超過閾值（如 4px）= 拖曳；否則等 pointerup 判單/雙擊。不要讓雙擊的第一擊就把 lockedRange 清掉造成閃爍
- seek 用既有 `seekTo`（尊重真音檔/mock clock 雙模式）；「播放中跳播」不可造成 pause/play 閃斷

## 不准做

- 不動 NotesPanel textarea 邏輯、不動 Transport 手勢（U1 剛做好）、不動 Rust、不 commit
- 不改 note 資料結構

## 完成標準

- `rtk npm run build` ✅、`npx tsc --noEmit` ✅
- 實測矩陣（在 preview 用 pointer events 模擬）：停止+unlink 單擊、播放中+unlink 單擊、停止+link 單擊、雙擊（播放中/停止各一）、拖曳框選、shift+click、框內單擊生成 range note、點 note 選取——全部符合上面語意
- 回報：實測矩陣結果逐項列出
