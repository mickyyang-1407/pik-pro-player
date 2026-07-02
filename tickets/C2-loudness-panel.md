# 工單 C2：把 LoudnessPanel（Metering/Loudness + PPM）拆成獨立元件

先讀總規範：`/Users/mickyyang/Projects/pik-pro-player/PROMPT-FOR-OPENCODE-2026-07-02-COMPONENTIZATION.md`（硬性規則全部適用）。
參考 C1 已完成的模式：`src/components/SpeakerRoom.tsx` + `src/speakerConfig.ts`（照同樣風格做）。

## 這張工單只做一件事

把 `src/main.tsx` 裡 `<section class="analysis-panel">`（line 1466-1585）搬到新檔 `src/components/LoudnessPanel.tsx`。**純搬移，JSX 與 class 名稱逐字相同，不改任何行為。**

## 具體步驟

1. 新增 `src/meteringConfig.ts`，從 main.tsx 搬過去並 export（這些是純常數/純函式，main.tsx 也還會用到，改成 import）：
   - `TargetStatus` type（line ~31）、`statusLabel` const（line ~33）
   - `loudnessTicks`（~89）、`ppmTicks`（~90）、`ppmTickDb`（~93）、`ppmPercentFromDb`（~95）、`loudnessPosition`（~117）
   - `TargetPlatform` type（~119）、`targetPlatforms` const（~128）——**數值一個字都不准改**（這些是查證過的官方交付規格）
2. 新增 `src/components/LoudnessPanel.tsx`，搬入 analysis-panel 的完整 JSX。Props（全部 accessor 形式，邏輯不搬）：
   - `lufsEnabled` / `setLufsEnabled`、`ppmEnabled` / `setPpmEnabled`
   - `lufsStatus` / `truePeakStatus`（`Accessor<TargetStatus>`）
   - `selectedIntegratedLufs`、`selectedLoudnessRange`、`selectedShortTerm`、`selectedTruePeak`、`selectedShortTermMax`、`selectedMomentaryMax`
   - `targetPlatformId` / `setTargetPlatformId`、`targetPlatform`（memo accessor）
   - `displayMeterRows`（`Accessor<{label: string; value: number}[]>`）
   - `onExportReport`（= main.tsx 的 `exportComplianceReport`，函式留在 main.tsx）
3. main.tsx 原位置換成 `<LoudnessPanel ...props />`。

## 不准搬（全部留在 main.tsx）

- LUFS/PPM 輪詢邏輯（`player_lufs_snapshot`、`player_meter_json` invoke、`liveLufs` signal、`displayMeterRows` memo 本體）
- `lufsStatus`/`truePeakStatus` memo 本體、所有 `selected*` memo 本體
- `exportComplianceReport` 函式本體
- `lufsEnabled`/`ppmEnabled`/`targetPlatformId` signal 本體（注意 `ppmEnabled` 被 PPM 輪詢 guard 用到，一定留 main.tsx）

## 不准做

- 不准動 `src/styles.css`、不准動其他 UI 區塊、不准加功能、不准改 signal 命名、不准 commit
- setLufsEnabled/setPpmEnabled 原本是 functional update（`(enabled) => !enabled`），props 介面要能保留同樣呼叫方式（直接把 setter 傳下去即可）

## 完成標準

- `rtk npm run build` 通過、`npx tsc --noEmit` 除了 pre-existing 的 `src/services/share.ts(25)` 外零 error
- `git diff` 裡 main.tsx 只有「刪掉搬走的部分 + 加 import + 換成元件標籤」
- 完成後回報：改了哪些檔、diff 行數、build/tsc 結果
