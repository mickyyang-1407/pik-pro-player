# OpenCode (GLM 5.2) 任務：main.tsx Componentization

> Orchestrator：Claude Code | Reviewer：Antigravity (AGY)
> 依據：`/Users/mickyyang/.gemini/antigravity/brain/ac5cd206-f307-4ec7-90a8-cb43857651f7/handoff.md` Roadmap #1

## 任務目標

`src/main.tsx`（2173 行）拆成獨立 SolidJS components，放進新的 `src/components/` 目錄。
**這是純 refactor：行為、視覺、DOM 結構一律不准改變。**

## Phase 順序（一次只做一個，過關才下一個）

依耦合度低→高：

1. **C1 `src/components/SpeakerRoom.tsx`** — speaker grid、group pills、SOLO/MUTE toggle 的 JSX
2. **C2 `src/components/LoudnessPanel.tsx`** — LUFS 卡片、target 下拉、status pills、PPM 12 軌
3. **C3 `src/components/Timeline.tsx`** — track、playhead、note markers、drag 框選、waveform bg
4. **C4 `src/components/NotesPanel.tsx`** — note list、inline 編輯、篩選、Version Compare、Reference、Phase/Spectrum 卡片

每個 Phase 完成後：
1. `rtk npm run build` ✅ + `npx tsc --noEmit` ✅
2. `npm run tauri:dev` 開起來**給 Micky 實測**，等他說 OK 才做下一個 Phase
3. 更新本檔案底部的進度區

## 硬性規則（違反任何一條 = 重做）

- **禁止加任何新功能**。上次 session 自作主張加 Undo/Redo 和波形，造成空白畫面事故。這次只准搬 code，不准發明。
- **State 全部留在 main.tsx**，用 props 傳進 component。Context/createStore 遷移是之後的獨立任務（Roadmap #2），這輪不做。
- **不准 commit**。所有改動留在 working tree，cron 每小時自動備份。
- **不准動 `canvas/*`**。
- **CSS 一律用 theme 變數**（`var(--surface)` `var(--ink)` `var(--cyan)` `var(--line)` `var(--bg)` 等），不准新增 hardcoded hex。
- **不准動 `handleShareNotes` 的 email payload 結構**——對應的 Google Apps Script（Code.gs）目前不在 repo 裡，改了 payload 沒地方同步。
- styles.css 這輪原則上不動；若 component 拆分真的需要調整 selector，逐條列出改了什麼。

## 已知的坑（前人踩過，不要再踩）

1. **`<For>` 裡的編輯輸入框必須 uncontrolled**：ref 設初始值、只在 commit（Enter/blur）時寫回 signal。onInput 直接寫回會讓每個按鍵摧毀重建整個 list item DOM。NotesPanel（C4）搬的時候這段邏輯原封不動搬過去。
2. **`.workspace` grid 底下的 item 都要 `min-height: 0`**，不然內容多時會 blowout 撐爆被裁掉。
3. **聲道 bitmask 一律用 `channelOrder`（L/R/C/LFE/Ls/Rs/Lrs/Rrs/Ltf/Rtf/Ltr/Rtr）**，不是 `speakers` 陣列的顯示順序。C1 搬 SpeakerRoom 時 `channelMuteMask` 的計算邏輯留在 main.tsx（它跟 backend invoke 綁在一起）。
4. **任何設 `isDraggingTimeline(true)` 的路徑都要同時設 `dragStart`**（C3 注意，之前 shift+click 就是漏這個壞掉的）。
5. Rust 端有改動要 restart `tauri dev`，只靠 Vite HMR 不夠（這輪不該碰 Rust，僅備忘）。
6. Vite dev server 偶爾有 HMR 殘留假錯誤——build 過但 preview 報錯時，先重啟 dev server 再判斷是不是真 bug。

## 拆分手法建議

- 每個 component 檔案：props 介面明確列出需要的 signals/memos/callbacks，型別寫清楚
- Note、MixVersion 等共用型別抽到 `src/types.ts`
- 純函式（`formatTime`、`ppmPercentFromDb` 等）抽到 `src/utils.ts`
- 搬移時保持 JSX 與 class 名稱逐字相同，方便 AGY review diff

## 進度（每個 Phase 完成後更新這裡）

- [x] C1 SpeakerRoom — 完成，orchestrator 驗收 ✅ + AGY review PASS
- [x] C2 LoudnessPanel — 完成，orchestrator 驗收 ✅ + AGY review 實質項目 (a)-(d) 全過。AGY 判 FAIL 的唯一 finding（share.ts 被偷改）經 orchestrator 查證是 AGY 自己在 C1 review 時改的（mtime 17:10:33 落在其 review 窗內，developer 兩輪 log 均未碰該檔），屬誤判，裁決推翻改判 PASS。share.ts 的 `: string` 註記無害保留。
- [x] C3 TransportBar（整個 topbar header）— 完成，orchestrator 驗收 ✅ + AGY review PASS
- [x] C4 Timeline — 完成，orchestrator 驗收 ✅ + AGY review PASS
- [x] C5 NotesPanel — 完成，orchestrator 驗收 ✅（uncontrolled textarea 坑實測過：打字 DOM node 不重建）+ AGY review PASS。（註：第一次派工 OpenCode session 靜默中斷什麼都沒做，重派後成功）

**全部完成（2026-07-02）**：main.tsx 2173 → 1443 行；五支元件 SpeakerRoom/LoudnessPanel/TransportBar/Timeline/NotesPanel + speakerConfig/meteringConfig/types/utils 四支共用檔。整合驗證全過（五元件跨元件互動、5 themes、export、無 global scroll）。
