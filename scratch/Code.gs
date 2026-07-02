/**
 * Pik Pro Player — "Send Notes via Email" webhook
 *
 * 部署帳號：pikproplayer@gmail.com（2026-07-02 起，取代舊個人帳號通道）
 *
 * ── 部署步驟（換帳號後必做）─────────────────────────────
 * 1. 用 pikproplayer@gmail.com 登入 https://script.google.com
 * 2. 新專案 → 把本檔全部貼上 → 存檔
 * 3. 部署 → 新增部署作業 → 類型「網頁應用程式」
 *    - 執行身分：我（pikproplayer@gmail.com）
 *    - 具有存取權的使用者：所有人
 * 4. 複製 Web App URL，交給 Claude Code 更新 src/services/share.ts 的 APPS_SCRIPT_URL
 * 5. ⚠️ 之後每次改本檔，都要「部署 → 管理部署作業 → 編輯 → 新版本」
 *    只按存檔不會更新線上的 webhook！
 * ──────────────────────────────────────────────────
 *
 * Payload（由 src/main.tsx handleShareNotes 送出，改這裡要同步改那邊）：
 * {
 *   senderEmail, recipient, projectName, versionLabel,
 *   analytics: { integratedLufs, truePeak, loudnessRange, targetPlatform },
 *   notes: [{ type: 'point'|'range', start, end|null, text, severity: 'critical'|'minor' }],
 *   screenshot: base64 dataURL (image/png)
 * }
 */

function doPost(e) {
  try {
    var payload = JSON.parse(e.postData.contents);

    var subject = '[Pik Pro] ' + payload.projectName + ' — ' + payload.versionLabel + ' Mix Notes';
    var htmlBody = buildHtml_(payload);

    var options = {
      htmlBody: htmlBody,
      name: 'Pik Pro Player',
      replyTo: payload.senderEmail || undefined,
    };

    // 截圖夾帶為附件（inline 圖太大時 Gmail 會裁切，附件較穩）
    if (payload.screenshot && payload.screenshot.indexOf('base64,') !== -1) {
      var b64 = payload.screenshot.split('base64,')[1];
      var blob = Utilities.newBlob(Utilities.base64Decode(b64), 'image/png', 'mix-review-screenshot.png');
      options.attachments = [blob];
    }

    MailApp.sendEmail(payload.recipient, subject, '', options);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'ok' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Light Theme HTML 版型；severity 色彩分級：critical=紅、minor/range=藍
function buildHtml_(p) {
  var critical = '#c0392b';
  var blue = '#2471a3';
  var ink = '#1c2833';
  var muted = '#6b7a8a';
  var line = '#e2e8ee';

  var notesHtml = (p.notes || []).map(function (n) {
    var isCritical = n.severity === 'critical';
    var color = isCritical ? critical : blue;
    var label = isCritical ? 'CRITICAL' : (n.type === 'range' ? 'RANGE' : 'NOTE');
    var time = n.end ? (n.start + ' – ' + n.end) : n.start;
    return (
      '<div style="border-left:4px solid ' + color + ';background:#fbfcfd;' +
      'padding:10px 14px;margin:8px 0;border-radius:0 6px 6px 0;">' +
      '<div style="font-size:11px;letter-spacing:1px;color:' + color + ';font-weight:bold;">' +
      label + ' &nbsp;·&nbsp; <span style="color:' + muted + ';font-weight:normal;">' + time + '</span></div>' +
      '<div style="color:' + ink + ';font-size:14px;margin-top:4px;white-space:pre-wrap;">' +
      escapeHtml_(n.text || '(no text)') + '</div>' +
      '</div>'
    );
  }).join('');

  var a = p.analytics || {};
  var statRow = function (k, v) {
    return '<td style="padding:8px 16px;border:1px solid ' + line + ';">' +
      '<div style="font-size:10px;letter-spacing:1px;color:' + muted + ';">' + k + '</div>' +
      '<div style="font-size:16px;color:' + ink + ';font-weight:bold;margin-top:2px;">' + v + '</div></td>';
  };

  return (
    '<div style="font-family:-apple-system,Helvetica,Arial,sans-serif;background:#f4f6f8;padding:24px;">' +
    '<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid ' + line + ';border-radius:10px;overflow:hidden;">' +
    '<div style="padding:20px 24px;border-bottom:1px solid ' + line + ';">' +
    '<div style="font-size:11px;letter-spacing:2px;color:' + muted + ';">PIK PRO PLAYER · MIX REVIEW</div>' +
    '<div style="font-size:20px;color:' + ink + ';font-weight:bold;margin-top:4px;">' +
    escapeHtml_(p.projectName || 'Mix') + ' <span style="color:' + muted + ';font-weight:normal;">' +
    escapeHtml_(p.versionLabel || '') + '</span></div></div>' +
    '<div style="padding:16px 24px;"><table style="border-collapse:collapse;width:100%;"><tr>' +
    statRow('INTEGRATED', a.integratedLufs + ' LUFS') +
    statRow('TRUE PEAK', a.truePeak + ' dBTP') +
    statRow('RANGE', a.loudnessRange + ' LU') +
    statRow('TARGET', escapeHtml_(String(a.targetPlatform || '—'))) +
    '</tr></table></div>' +
    '<div style="padding:0 24px 8px;"><div style="font-size:12px;letter-spacing:1px;color:' + muted + ';margin:8px 0;">NOTES (' + (p.notes || []).length + ')</div>' +
    notesHtml + '</div>' +
    '<div style="padding:14px 24px;border-top:1px solid ' + line + ';font-size:11px;color:' + muted + ';">' +
    'Sent from Pik Pro Player · reply goes to ' + escapeHtml_(p.senderEmail || '') + ' · screenshot attached</div>' +
    '</div></div>'
  );
}

function escapeHtml_(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
