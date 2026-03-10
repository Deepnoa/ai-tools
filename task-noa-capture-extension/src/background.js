const DEFAULT_BACKEND_URL = "http://127.0.0.1:3000/api/ai/capture";
const DEFAULT_API_TOKEN = "";

async function getSettings() {
  const stored = await chrome.storage.local.get(["backendUrl", "apiToken"]);
  return {
    backendUrl: stored.backendUrl || DEFAULT_BACKEND_URL,
    apiToken: stored.apiToken || DEFAULT_API_TOKEN,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== "TASK_NOA_SAVE_SETTINGS") {
    return false;
  }
  chrome.storage.local
    .set({
      backendUrl: message.backendUrl || DEFAULT_BACKEND_URL,
      apiToken: message.apiToken || DEFAULT_API_TOKEN,
    })
    .then(() => sendResponse({ ok: true }))
    .catch((error) => sendResponse({ ok: false, error: error.message }));
  return true;
});

chrome.action.onClicked?.addListener(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    return;
  }
  await chrome.action.openPopup();
});

export async function captureActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab");
  }

  const response = await chrome.tabs.sendMessage(tab.id, { type: "TASK_NOA_CAPTURE_PAGE" });
  if (!response?.ok) {
    throw new Error(response?.error || "Capture failed");
  }

  const settings = await getSettings();
  const captureResponse = await fetch(settings.backendUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${settings.apiToken}`,
    },
    body: JSON.stringify(response.payload),
  });

  const payload = await captureResponse.json().catch(() => ({}));
  if (!captureResponse.ok) {
    throw new Error(payload.error || `Capture upload failed (${captureResponse.status})`);
  }

  return payload;
}
