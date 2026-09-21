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

const SITES = {
  smartbook: {
    question: [
      "[data-automation-id='question-stem']",
      "[class*='questionStem']",
      ".probe-question",
      ".question-stem",
      "[class*='prompt-text']",
      "[class*='stem']",
    ],
    choice: [
      "[data-automation-id='choice']",
      "[class*='choiceRow']",
      "[class*='choice-row']",
      "[class*='answerChoice']",
      ".choice",
      "label[for^='choice']",
    ],
  },
  ezto: {
    question: [
      "[class*='questionText']",
      "[class*='question-text']",
      ".question-body",
      "[class*='stem']",
    ],
    choice: [
      "[class*='answerChoice']",
      "[class*='answer-choice']",
      "tr[class*='choice']",
      ".choice-container",
      "label[class*='choice']",
    ],
  },
};

function scrapeInPage(questionSelectors, choiceSelectors) {
  const norm = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

  const all = (selectors) => {
    for (const selector of selectors) {
      let nodes;
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (error) {
        continue;
      }
      nodes = nodes.filter((node) => norm(node.textContent));
      if (nodes.length) return { selector, nodes };
    }
    return { selector: null, nodes: [] };
  };

  const stem = all(questionSelectors);
  const choices = all(choiceSelectors);

  if (!stem.nodes.length && !choices.nodes.length) return null;

  const inputs = choices.nodes.filter((node) =>
    node.querySelector("input[type='checkbox']")
  );

  return {
    questionText: norm(stem.nodes.length ? stem.nodes[0].textContent : ""),
    choices: choices.nodes.map((node, index) => ({
      label: String.fromCharCode(65 + index),
      text: norm(node.textContent),
    })),
    questionType: !choices.nodes.length
      ? "fill-in-the-blank"
      : inputs.length
        ? "multiple-select"
        : "multiple-choice",
    matchedSelectors: { question: stem.selector, choice: choices.selector },
  };
}

function applyInPage(choiceSelectors, answer, allowMultiple) {
  const norm = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

  let nodes = [];
  for (const selector of choiceSelectors) {
    try {
      const found = Array.from(document.querySelectorAll(selector)).filter(
        (node) => norm(node.textContent)
      );
      if (found.length) {
        nodes = found;
        break;
      }
    } catch (error) {
      continue;
    }
  }

  if (!nodes.length) return 0;

  const wanted = (Array.isArray(answer) ? answer : [answer])
    .map((value) => norm(value).toLowerCase())
    .filter(Boolean);

  const click = (node) => {
    const input = node.querySelector("input[type='radio'], input[type='checkbox']");
    let label = node.querySelector("label");
    if (!label && input && input.id) {
      try {
        label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      } catch (error) {
        label = null;
      }
    }

    const target = label || input || node;
    const wasChecked = input ? input.checked : null;
    const options = { bubbles: true, cancelable: true, view: window };

    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
      try {
        const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
        target.dispatchEvent(new Ctor(type, options));
      } catch (error) {
        target.dispatchEvent(new MouseEvent("click", options));
      }
    });

    if (input && input.checked === wasChecked) {
      input.checked = !wasChecked;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  let clicked = 0;
  nodes.forEach((node, index) => {
    const label = String.fromCharCode(65 + index).toLowerCase();
    const text = norm(node.textContent).toLowerCase();

    const matches = wanted.some(
      (value) =>
        value === label ||
        value === text ||
        (value.length > 3 && text.includes(value)) ||
        (text.length > 3 && value.includes(text))
    );

    if (matches && (allowMultiple || !clicked)) {
      click(node);
      clicked += 1;
    }
  });

  return clicked;
}

async function scrapeAcrossFrames(tabId, site) {
  const config = SITES[site] || SITES.smartbook;

  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: scrapeInPage,
    args: [config.question, config.choice],
  });

  const hits = results
    .filter((entry) => entry && entry.result)
    .sort((a, b) => b.result.choices.length - a.result.choices.length);

  if (!hits.length) return null;

  return { frameId: hits[0].frameId, question: hits[0].result };
}

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

  const tabId = sender.tab.id;
  const found = await scrapeAcrossFrames(tabId, message.site);

  if (!found) {
    throw new Error("No question found on this page");
  }

  const settings = await getSettings();
  const config = ASSISTANTS[settings.assistant];

  await setPending({
    sourceTabId: tabId,
    frameId: found.frameId,
    site: message.site,
    questionType: found.question.questionType,
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
    question: found.question,
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
      type: "status",
      text: `Could not read the reply: ${error.message}`,
    });
    return;
  }

  const answerText = JSON.stringify(parsed.answer);

  if (!pending.autoSelect) {
    await notifySource(pending.sourceTabId, {
      type: "status",
      text: `Answer: ${answerText}. ${parsed.explanation || ""}`,
    });
    return;
  }

  const config = SITES[pending.site] || SITES.smartbook;

  let clicked = 0;
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId: pending.sourceTabId, frameIds: [pending.frameId] },
      func: applyInPage,
      args: [
        config.choice,
        parsed.answer,
        pending.questionType === "multiple-select",
      ],
    });
    clicked = results && results[0] ? results[0].result : 0;
  } catch (error) {
    await notifySource(pending.sourceTabId, {
      type: "status",
      text: `Could not reach the question frame: ${error.message}`,
    });
    return;
  }

  await notifySource(pending.sourceTabId, {
    type: "status",
    text: clicked
      ? `Selected ${clicked} choice${clicked === 1 ? "" : "s"}. ${parsed.explanation || ""}`
      : `No choice matched. Answer: ${answerText}`,
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
