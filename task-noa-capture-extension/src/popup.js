import { captureActiveTab } from "./background.js";

const backendUrlInput = document.getElementById("backendUrl");
const apiTokenInput = document.getElementById("apiToken");
const statusView = document.getElementById("status");
const saveButton = document.getElementById("saveSettings");
const captureButton = document.getElementById("captureNow");

function setStatus(value) {
  statusView.textContent = typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

async function loadSettings() {
  const { backendUrl, apiToken } = await chrome.storage.local.get(["backendUrl", "apiToken"]);
  backendUrlInput.value = backendUrl || "http://127.0.0.1:3000/api/ai/capture";
  apiTokenInput.value = apiToken || "";
}

saveButton.addEventListener("click", async () => {
  const response = await chrome.runtime.sendMessage({
    type: "TASK_NOA_SAVE_SETTINGS",
    backendUrl: backendUrlInput.value.trim(),
    apiToken: apiTokenInput.value.trim(),
  });
  setStatus(response?.ok ? "Settings saved." : response?.error || "Failed to save settings.");
});

captureButton.addEventListener("click", async () => {
  try {
    setStatus("Capturing...");
    const result = await captureActiveTab();
    setStatus(result);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Capture failed");
  }
});

loadSettings().catch((error) => setStatus(error instanceof Error ? error.message : "Failed to load settings"));
