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

// 2026-07-02 起：pikproplayer@gmail.com 帳號的部署（原始碼在 scratch/Code.gs，改動後記得在 IDE 部署「新版本」）
const APPS_SCRIPT_URL: string = 'https://script.google.com/macros/s/AKfycby5QiFxSQ2Em3HFlltPnHYKwL7eystwoWPdj6w_7Tgg9CxSM9tN46x8oeEJO0pLUxT7Ug/exec';

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
