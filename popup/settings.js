const DEFAULT_SETTINGS = {
  assistant: "chatgpt",
  autoSelect: true,
  focusAssistantTab: false,
  confidence: "off",
  advance: false,
};

const fields = {
  assistant: document.getElementById("assistant"),
  autoSelect: document.getElementById("autoSelect"),
  focusAssistantTab: document.getElementById("focusAssistantTab"),
  confidence: document.getElementById("confidence"),
  advance: document.getElementById("advance"),
};

const savedNote = document.getElementById("saved");
const updateButton = document.getElementById("checkUpdate");
const updateStatus = document.getElementById("updateStatus");
let savedTimer = null;

function showSaved() {
  savedNote.hidden = false;
  if (savedTimer) clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    savedNote.hidden = true;
  }, 1200);
}

async function load() {
  document.getElementById("version").textContent =
    `v${chrome.runtime.getManifest().version}`;

  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const settings = Object.assign({}, DEFAULT_SETTINGS, stored);

  fields.assistant.value = settings.assistant;
  fields.autoSelect.checked = Boolean(settings.autoSelect);
  fields.focusAssistantTab.checked = Boolean(settings.focusAssistantTab);
  fields.confidence.value = settings.confidence;
  fields.advance.checked = Boolean(settings.advance);
}

function persist() {
  chrome.storage.sync
    .set({
      assistant: fields.assistant.value,
      autoSelect: fields.autoSelect.checked,
      focusAssistantTab: fields.focusAssistantTab.checked,
      confidence: fields.confidence.value,
      advance: fields.advance.checked,
    })
    .then(showSaved)
    .catch((error) => console.error("Could not save settings:", error));
}

Object.values(fields).forEach((field) =>
  field.addEventListener("change", persist)
);

updateButton.addEventListener("click", async () => {
  updateButton.disabled = true;
  updateStatus.textContent = "Checking...";

  try {
    const result = await chrome.runtime.sendMessage({ type: "checkForUpdate" });

    if (!result || !result.ok) {
      updateStatus.textContent = `Check failed: ${result ? result.error : "no response"}`;
    } else if (result.updateAvailable) {
      updateStatus.textContent = `v${result.latest} is available (you have v${result.current}).`;
    } else {
      updateStatus.textContent = `You are on the latest version (v${result.current}).`;
    }
  } catch (error) {
    updateStatus.textContent = `Check failed: ${error.message}`;
  } finally {
    updateButton.disabled = false;
  }
});

load();
