export interface SharePayload {
  senderEmail: string;
  recipient: string;
  projectName: string;
  versionLabel: string;
  analytics: {
    integratedLufs: string | number;
    truePeak: string | number;
    loudnessRange: string | number;
    targetPlatform: string;
  };
  notes: Array<{
    type: string;
    start: string;
    end: string | null;
    text: string;
  }>;
  screenshot: string; // Base64
}

// TODO(2026-07-02): email 通道要換到 pikproplayer@gmail.com——用該帳號部署 scratch/Code.gs 後，把新的 Web App URL 換進來（舊 URL 在此之前仍可用）
const APPS_SCRIPT_URL: string = 'https://script.google.com/macros/s/AKfycbzTZqIPXJStmzf7P2LeTeBSbDv5ne3z27FqD6uEkgMQRBiPtxY_hstd0wsbAVOF8GD-/exec';

export async function sendNotes(payload: SharePayload): Promise<boolean> {
  if (APPS_SCRIPT_URL === 'YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE') {
    throw new Error('Please configure your Google Apps Script URL in src/services/share.ts');
  }

  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain;charset=utf-8',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Failed to send notes: ${response.statusText}`);
    }

    const result = await response.json();
    if (result.error) {
      throw new Error(result.error);
    }

    return true;
  } catch (error) {
    console.error('Error sending notes:', error);
    throw error;
  }
}
