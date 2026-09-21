const ASSISTANTS = {
  chatgpt: {
    label: "ChatGPT",
    url: "https://chatgpt.com/",
    match: "https://chatgpt.com/*",
    responseType: "chatgptResponse",
  },
  gemini: {
    label: "Gemini",
    url: "https://gemini.google.com/app",
    match: "https://gemini.google.com/*",
    responseType: "geminiResponse",
  },
  deepseek: {
    label: "DeepSeek",
    url: "https://chat.deepseek.com/",
    match: "https://chat.deepseek.com/*",
    responseType: "deepseekResponse",
  },
};

const DEFAULT_SETTINGS = {
  assistant: "chatgpt",
  autoSelect: true,
  focusAssistantTab: false,
};

const RELEASES_ENDPOINT =
  "https://api.github.com/repos/bmccarthy678-cmd/HW_helper/releases/latest";

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getSettings() {
  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const settings = Object.assign({}, DEFAULT_SETTINGS, stored);
  if (!ASSISTANTS[settings.assistant]) {
    settings.assistant = DEFAULT_SETTINGS.assistant;
  }
  return settings;
}

async function setPending(pending) {
  await chrome.storage.session.set({ pendingRequest: pending });
}

async function takePending() {
  const { pendingRequest } = await chrome.storage.session.get("pendingRequest");
  if (pendingRequest) await chrome.storage.session.remove("pendingRequest");
  return pendingRequest || null;
}

function assistantForResponseType(type) {
  return Object.keys(ASSISTANTS).find(
    (key) => ASSISTANTS[key].responseType === type
  );
}

async function ensureAssistantTab(assistantKey, focus) {
  const config = ASSISTANTS[assistantKey];
  const existing = await chrome.tabs.query({ url: config.match });

  if (existing.length) {
    const tab = existing[0];
    if (focus) {
      await chrome.tabs.update(tab.id, { active: true });
      await chrome.windows.update(tab.windowId, { focused: true });
    }
    return tab;
  }

  return chrome.tabs.create({ url: config.url, active: Boolean(focus) });
}

async function sendWhenReady(tabId, message, attempts = 24) {
  let lastError = null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;
      await delay(750);
    }
  }

  throw new Error(
    `Assistant tab never became ready: ${lastError ? lastError.message : "unknown error"}`
  );
}

async function handleAskQuestion(message, sender) {
  if (!sender.tab || sender.tab.id == null) {
    throw new Error("Question did not come from a tab");
  }

  const settings = await getSettings();
  const config = ASSISTANTS[settings.assistant];

  await setPending({
    sourceTabId: sender.tab.id,
    assistant: settings.assistant,
    autoSelect: settings.autoSelect,
    startedAt: Date.now(),
  });

  const tab = await ensureAssistantTab(
    settings.assistant,
    settings.focusAssistantTab
  );

  const ack = await sendWhenReady(tab.id, {
    type: "receiveQuestion",
    question: message.question,
  });

  if (ack && ack.received === false) {
    await takePending();
    throw new Error(ack.error || "Assistant refused the question");
  }

  return { ok: true, assistant: config.label };
}

function parseAnswer(raw) {
  if (raw && typeof raw === "object") return raw;

  try {
    return JSON.parse(raw);
  } catch (error) {
    const match = String(raw).match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Assistant response was not JSON");
    return JSON.parse(match[0]);
  }
}

async function handleAssistantResponse(message) {
  const pending = await takePending();
  if (!pending) return;

  let parsed;
  try {
    parsed = parseAnswer(message.response);
  } catch (error) {
    await notifySource(pending.sourceTabId, {
      type: "answerFailed",
      error: error.message,
    });
    return;
  }

  await notifySource(pending.sourceTabId, {
    type: "applyAnswer",
    answer: parsed.answer,
    explanation: parsed.explanation || "",
    autoSelect: pending.autoSelect,
    elapsedMs: Date.now() - pending.startedAt,
  });
}

async function notifySource(tabId, payload) {
  try {
    await chrome.tabs.sendMessage(tabId, payload);
  } catch (error) {
    console.error("Could not reach the source tab:", error);
  }
}

function compareVersions(a, b) {
  const left = String(a).split(".").map(Number);
  const right = String(b).split(".").map(Number);
  const length = Math.max(left.length, right.length);

  for (let i = 0; i < length; i += 1) {
    const diff = (left[i] || 0) - (right[i] || 0);
    if (diff) return diff;
  }

  return 0;
}

async function checkForUpdate() {
  const response = await fetch(RELEASES_ENDPOINT, {
    headers: { Accept: "application/vnd.github+json" },
  });

  if (!response.ok) {
    throw new Error(`GitHub responded with ${response.status}`);
  }

  const release = await response.json();
  const latest = String(release.tag_name || "").replace(/^v/, "");
  const current = chrome.runtime.getManifest().version;

  return {
    current,
    latest,
    updateAvailable: Boolean(latest) && compareVersions(latest, current) > 0,
    url: release.html_url || "",
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.type) return;

  if (message.type === "askQuestion") {
    handleAskQuestion(message, sender)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (assistantForResponseType(message.type)) {
    handleAssistantResponse(message)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => {
        console.error("Failed to route assistant response:", error);
        sendResponse({ ok: false, error: error.message });
      });
    return true;
  }

  if (message.type === "checkForUpdate") {
    checkForUpdate()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

});
