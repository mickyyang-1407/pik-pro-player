# Pik Pro Player — Playback Engine 專案規劃

> 建立時間：2026-07-01
> 現況：目前整個 app（Metering P1-P5、Speaker Room、Timeline/Transport T1-T4）都是**前端 mock UI**。`src-tauri/Cargo.toml` 目前沒有任何音訊相關 dependency，播放、LUFS/PPM 數值、播放時鐘全部是 SolidJS signal 模擬出來的。這份文件規劃怎麼把它變成真正能載入檔案、播放、即時量測的 Atmos mix review player。

---

## 1. 現有可重用資產（重要，不要從零開始）

專案 `~/Projects/pik-player`（消費版 Atmos music player，也是 Tauri + Rust）已經解決了一部分同樣的問題，`src-tauri/src/player/atmos.rs` + `atmos_wrapper.m`：

- **`AtmosPlayer`**：Rust struct 包一層 FFI，橋接一支 Objective-C（`atmos_wrapper.m`）用 `AVPlayer` / `AVMutableAudioMixInputParameters` + `MTAudioProcessingTap` 做多聲道播放
- 已實作：`atmos_create/play/pause/seek/get_position/get_duration/is_playing/set_volume/set_output_device/set_eq`
- **背景 observer thread**：定期把 position/duration 用 Tauri `Emitter` 送到前端 —— 這就是我們要拿來取代目前 `setInterval` mock 時鐘的機制
- **已經有 12 聲道 per-channel meter**：`atmos_get_meter_json` 用 vDSP（`vDSP_svesq` + `vDSP_maxmgv`）算每個聲道的 RMS + Peak，label 剛好就是 `L/R/C/LFE/Ls/Rs/Lrs/Rrs/Ltf/Rtf/Ltr/Rtr`——跟 Pik Pro Player 現在 PPM meter 的 12 軌命名完全一致
- 已有 EQ 注入（vDSP biquad）、CoreAudio 輸出裝置列舉/切換

**結論：PPM per-channel meter 的底層 DSP 幾乎是現成的，可以直接移植，不用重新發明。** LUFS（Integrated/Short-term，K-weighting + gating）目前 pik-player 沒有做，這塊是真的要新蓋。

---

## 2. 關鍵架構決定

### 2.1 音檔格式
- **MVP 先支援純多聲道 interleaved WAV/BWF**（12ch，對應現有 7.1.4 命名），這是 Pro Tools bounce 最容易產出的格式
- **之後才考慮** ADM BWF（Atmos metadata 內嵌）或 Dolby `.atmos` Master File（Pro Tools render 出的專屬格式，需要額外 parser）——這兩個先不做，等 Micky 真的有這類檔案再說

### 2.2 播放引擎
- **沿用 pik-player 的 `AtmosPlayer` 模式**（AVFoundation-based），而不是改用 `cpal`/`symphonia` 從零寫 Rust 音訊管線。理由：
  - macOS 原生 AVFoundation 對多聲道檔案格式支援最穩，不用自己處理各種 WAV 變體的 edge case
  - Position/duration/meter 上報機制已經驗證可用
  - 可以直接把 `atmos.rs` + `atmos_wrapper.m` 複製過來改名做起點，不用重新設計 FFI 介面
- Solo/Mute：目前前端已經有 `activeSpeakers`/`soloGroups`/`speakerMode` 這組 UI state，之後只要新增一個 Tauri command 把「目前哪些聲道要靜音」傳給後端，後端在 tap callback 裡把對應聲道的 buffer 乘 0 即可（vDSP `vDSP_vclr` 或直接 memset）

### 2.3 Metering
- **PPM（12 軌 RMS/Peak）**：移植 pik-player 現成的 vDSP tap，幾乎不用改
- **LUFS（Integrated / Short-term / Momentary）+ True Peak**：新工作。兩個選項：
  1. 綁 `libebur128`（成熟的 C library，實作 ITU-R BS.1770 / EBU R128，有 Rust binding crate `ebur128`）——**建議走這條**，比自己刻 K-weighting filter 快且不容易算錯
  2. 自己在現有 vDSP tap 裡加 K-weighting biquad + gating 邏輯——工程量大，除非要完全脫離額外 C dependency，不然沒必要
- 兩者都需要一個背景 thread 定期把算好的數字用 Tauri event 送到前端，取代目前寫死的 `currentIntegratedLufs`/`currentTruePeak`/`meterRows`

### 2.4 Timeline / Playhead
- 目前 `playheadTime` 是純前端 `setInterval` 模擬，介面（signal）已經刻意設計成獨立的一塊——**接真引擎時只要把驅動 `setPlayheadTime` 的來源，從 `setInterval` 換成監聽後端 Tauri event，UI 邏輯（N 熱鍵、playhead 畫線、loop 邏輯）完全不用改**
- Waveform 視覺化（Timeline 背景顯示真正的波形）是 nice-to-have，優先度低，可以晚一點做

### 2.5 專案存檔
- 目前 notes / general note / locked range **全部只在記憶體裡**，重整頁面就消失，還沒有任何持久化
- 姊妹專案 `pik-review-player` 已經做過 SQLite schema（projects/versions/notes），可以參考那套設計，不用重新想
- 這塊建議跟真音檔載入一起做（因為 notes 需要綁定「這是哪個檔案/哪個版本的 note」）

---

## 3. Phase 規劃（Engine 側，代號 E）

| Phase | 內容 | 依賴 | 備註 |
|---|---|---|---|
| **E1** | 檔案匯入 + 基本播放：把 `atmos.rs`/`atmos_wrapper.m` 移植/改名進 pik-pro-player；Tauri command 開檔案對話框；Play/Stop/Loop 接上真的 play/pause/seek；`playheadTime` 改成監聽後端 position event | 無 | 第一個里程碑，先証明整條管線通 |
| **E2** | 多聲道 Solo/Mute 真的靜音：把現有 UI state 接到後端 per-channel gain | E1 | |
| **E3** | 真 PPM：移植 vDSP per-channel RMS/Peak tap，取代 `meterRows` 假資料 | E1 | 這塊幾乎是搬過來就好 |
| **E4** | 真 LUFS/True Peak：整合 `ebur128`，取代 `currentIntegratedLufs`/`currentTruePeak` 假資料，P4 的 pass/warn/fail 從此是真數字 | E1 | |
| **E5** | 專案存檔：SQLite（參考 pik-review-player schema），notes/general note/locked range 綁定檔案，app 重開不會消失 | E1 | |
| **E6** | Timeline 波形視覺化 | E1 | 優先度低，可延後 |
| **E7** | ADM BWF / `.atmos` 檔案支援（如果 plain WAV 不夠用） | E1 | 看 Micky 實際檔案需求再決定要不要做 |

---

## 4. Phase 規劃（Producer Workflow 功能側，代號 N，接續 T1-T4）

這些大多不需要真音檔就能做，UI/資料結構層面即可：

| Phase | 內容 | 是否需要真音檔 |
|---|---|---|
| **N1** | Note 嚴重程度標籤（Critical/Minor/…）+ 搜尋/篩選（關鍵字、狀態、嚴重度） | 否 |
| **N2** | 匯出 Notes（CSV/文字，含時間碼）+ Loudness 合規報告匯出（用現有 P4 pass/warn/fail 資料） | 否 |
| **N3** | Transport 標準快捷鍵（Space=play/pause、方向鍵微調/scrub） | 否 |
| **N4** | A/B 版本比較（V1/V2，note 綁版本） | 資料結構可先做，實際比較效果要等 E1 |
| **N5** | 參考曲載入比較、Loudness 隨時間變化曲線 | 要等 E1-E4 |
| **N6** | 相位/相關性 meter、頻譜分析 | 要等 E1，且是全新 DSP，工程量較大 |

---

## 5. 建議下一步順序

1. 先把 N1-N3（不需要真音檔、風險低、馬上有感）做完，讓 Notes 系統更好用
2. 同時/接著啟動 E1（檔案匯入 + 基本播放），這是整個「player」名副其實的關鍵一步
3. E1 通了之後，E2/E3 幾乎是移植既有程式碼，可以快速跟上
4. E4（真 LUFS）+ E5（存檔）是下一批重點
5. N4/N5/N6、E6/E7 視情況排在更後面

## 6. 待確認事項

- Micky 實際會載入的檔案格式是什麼？（Pro Tools bounce 出的 12ch WAV？還是有 ADM BWF / `.atmos`？）這會影響 E1 的 scope
- pik-player 的 `atmos_wrapper.m` 是否可以直接拿來改，還是授權/依賴上有考量（純自己專案應該沒問題，但先跟 Micky 確認一下要不要共用同一份 Obj-C 橋接檔案，或是複製一份獨立維護）
