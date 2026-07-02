# 工單 V1-U1：Topbar / Transport 重設計（Apple Music 風格）

來源：Micky 總修改單 V1（2026-07-02）UI 面 1-8。
這是**功能/視覺工單**（不是 refactor）：可以改 `src/styles.css` 和加新邏輯，但所有顏色一律用 theme 變數（`var(--surface)` `var(--ink)` `var(--cyan)` `var(--line)` `var(--bg)` 等），5 個 theme（light/dark/spotify/ableton/flstudio）都要成立。

## 需求

1. **整體包覆感（UI-1）**：參考 Apple Music——現在 topbar 像一條獨立的橫帶壓在播放器上面，要改成整個 app 是一個包起來的容器，topbar 融入整體（同色系背景、無生硬分界線）。
2. **移除 Stop 按鈕（UI-2）**：Stop 功能由「⏮ 雙擊回到頭」取代。
3. **新增左右 seek 按鈕（UI-2）**，包在 Play 兩側：
   - 左鈕：單擊 = 回 10 秒；**按住** = 連續 rewind（建議 >400ms 起跳、每 ~150ms 退 2 秒，數值可調但要順手）；**雙擊** = 回到 00:00
   - 右鈕：單擊 = 進 10 秒；**按住** = 連續 forward
   - 單擊/雙擊/長按三者不能互相誤觸發（用 click-count window 或 pointerdown 計時，實作自選，但要在 preview 實測三種手勢都正確）
   - seek 邏輯走 main.tsx 既有的 `seekTo`/`nudgePlayhead`，尊重已載入音檔與 mock clock 兩種模式
4. **Loop 按鈕自身變色（UI-3）**：拿掉現在的框框高亮，改成按鈕本身變色——未啟用是預設色，啟用時**琥珀黃**（新增 `--loop-active` theme 變數，預設黃色系，各 theme 可微調）。
5. **Transport pill（UI-4）**：整組播放按鈕（⏪ ▶ ⏩ 🔁 + 時間碼）包進一個大 pill，微懸浮（subtle shadow），置中，Apple Music 感。
6. **Theme 選擇器 pill（UI-5）**：包成 pill，「THEME」label 在左、下拉選單在右，跟右側其他元素垂直置中對齊。
7. **Default Size 移到 Load 按鈕右邊（UI-6）**。
8. **loadStatus 文字處理（UI-7）**：「Loaded through AVFoundation」這類狀態文字平常不顯示，只在「載入中」和「載入失敗」時短暫出現（載入成功後 3 秒淡出或直接不顯示成功訊息）。topbar-meta 的 Current Mix 版本顯示**保留**（Micky 確認要）。
9. **圓角統一（UI-8）**：pills 和卡片的 border-radius 現在不一致。定一組一致的 radius scale（卡片一個值、pill/按鈕一個值），整體調小（不要那麼圓），全 app 套用。用 CSS 變數（如 `--radius-card`/`--radius-pill`）定義後全面替換。

## 不准做

- 不動 NotesPanel 的 textarea 邏輯（uncontrolled in For / controlled general-note 的 pattern 是鐵律）
- 不動 Timeline 播放/點擊邏輯（那是下一張工單 V1-T1 的範圍）
- 不動 email payload、不動 Rust、不 commit
- 不硬編 hex 色碼（新色一律進 theme 變數區）

## 完成標準

- `rtk npm run build` ✅、`npx tsc --noEmit` ✅
- 5 個 theme 逐一切換檢查無爆版、無不可讀的對比
- 三種 seek 手勢（單擊/雙擊/長按）實測正確
- 回報：改了哪些檔、新增了哪些 CSS 變數、手勢實作方式
