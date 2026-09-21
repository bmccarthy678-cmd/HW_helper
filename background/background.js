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

function pageAgent(op, questionSelectors, answer, allowMultiple) {
  const norm = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

  const NOISE =
    /^(exit assignment|concepts? completed|need help|read about the concept|rate your confidence|high|medium|low|reading|privacy center|terms of use|multiple choice question|select all that apply|ask ai|next|submit|back)\b/i;

  const visible = (el) => {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return true;
    return el.offsetParent !== null;
  };

  const labelTextFor = (input) => {
    if (input.id) {
      try {
        const explicit = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        const text = explicit ? norm(explicit.textContent) : "";
        if (text) return text;
      } catch (error) {
        // malformed id, fall through
      }
    }

    const wrapping = input.closest("label");
    if (wrapping) {
      const text = norm(wrapping.textContent);
      if (text) return text;
    }

    let node = input.parentElement;
    for (let depth = 0; depth < 4 && node; depth += 1, node = node.parentElement) {
      if (node.querySelectorAll("input[type='radio'], input[type='checkbox']").length > 1) break;
      const text = norm(node.textContent);
      if (text && text.length <= 300) return text;
    }

    return "";
  };

  const collectChoices = () => {
    const inputs = Array.from(
      document.querySelectorAll("input[type='radio'], input[type='checkbox']")
    ).filter(visible);

    return inputs
      .map((input) => ({ input, text: labelTextFor(input) }))
      .filter((choice) => choice.text && !NOISE.test(choice.text));
  };

  const findStem = (anchor) => {
    for (const selector of questionSelectors || []) {
      try {
        const node = document.querySelector(selector);
        const text = node ? norm(node.textContent) : "";
        if (text && !NOISE.test(text)) return text;
      } catch (error) {
        continue;
      }
    }

    if (!anchor) return "";

    const candidates = Array.from(
      document.querySelectorAll("p, div, span, h1, h2, h3, h4, legend, li")
    );

    let best = "";
    for (const el of candidates) {
      if (el.contains(anchor)) continue;
      const rel = el.compareDocumentPosition(anchor);
      if (!(rel & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      if (el.querySelector("input, textarea, select, button")) continue;
      if (!visible(el)) continue;

      const text = norm(el.textContent);
      if (text.length < 12 || text.length > 900) continue;
      if (NOISE.test(text)) continue;

      best = text;
    }

    return best;
  };

  const choices = collectChoices();

  if (op === "scrape") {
    const resultScreen = Array.from(
      document.querySelectorAll("button, [role='button'], input[type='button']")
    ).some((node) => {
      const text = norm(node.textContent || node.value || node.getAttribute("aria-label"));
      return (text === "next question" || text === "next") && visible(node);
    });

    if (resultScreen) return { resultScreen: true };

    const anchor = choices.length ? choices[0].input : null;
    const stem = findStem(anchor);

    if (!stem && !choices.length) return null;

    const isMulti = choices.some((c) => c.input.type === "checkbox");

    return {
      questionText: stem,
      choices: choices.map((choice, index) => ({
        label: String.fromCharCode(65 + index),
        text: choice.text,
      })),
      questionType: !choices.length
        ? "fill-in-the-blank"
        : isMulti
          ? "multiple-select"
          : "multiple-choice",
    };
  }

  if (!choices.length) return 0;

  const wanted = (Array.isArray(answer) ? answer : [answer])
    .map((value) => norm(value).toLowerCase())
    .filter(Boolean);

  const click = (input) => {
    let label = null;
    if (input.id) {
      try {
        label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
      } catch (error) {
        label = null;
      }
    }
    if (!label) label = input.closest("label");

    const target = label || input;
    const wasChecked = input.checked;
    const options = { bubbles: true, cancelable: true, view: window };

    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
      try {
        const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
        target.dispatchEvent(new Ctor(type, options));
      } catch (error) {
        target.dispatchEvent(new MouseEvent("click", options));
      }
    });

    if (input.checked === wasChecked) {
      input.checked = !wasChecked;
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    }
  };

  let clicked = 0;
  choices.forEach((choice, index) => {
    const label = String.fromCharCode(65 + index).toLowerCase();
    const text = choice.text.toLowerCase();

    const matches = wanted.some(
      (value) =>
        value === label ||
        value === text ||
        value === `${label}. ${text}` ||
        (value.length > 2 && text === value) ||
        (value.length > 3 && text.includes(value)) ||
        (text.length > 3 && value.includes(text))
    );

    if (matches && (allowMultiple || !clicked)) {
      click(choice.input);
      clicked += 1;
    }
  });

  return clicked;
}

async function nextAgent() {
  const norm = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().toLowerCase();

  const node = Array.from(
    document.querySelectorAll("button, [role='button'], input[type='button']")
  ).find((el) => {
    const text = norm(el.textContent || el.value || el.getAttribute("aria-label"));
    return text === "next question" || text === "next";
  });

  if (!node) return false;

  const options = { bubbles: true, cancelable: true, view: window };
  ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
    try {
      const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
      node.dispatchEvent(new Ctor(type, options));
    } catch (error) {
      node.dispatchEvent(new MouseEvent("click", options));
    }
  });

  return true;
}

async function submitAgent(level, advance) {
  const norm = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().toLowerCase();
  const wanted = norm(level);

  const candidates = () =>
    Array.from(
      document.querySelectorAll(
        "button, [role='button'], input[type='button'], input[type='submit']"
      )
    );

  const findButton = () =>
    candidates().find((node) => {
      const text = norm(node.textContent || node.value || node.getAttribute("aria-label"));
      return text === wanted;
    }) || null;

  const isEnabled = (node) =>
    !(
      node.disabled ||
      node.getAttribute("aria-disabled") === "true" ||
      node.getAttribute("data-disabled") === "true" ||
      node.className.toString().toLowerCase().includes("disabled")
    );

  const deadline = Date.now() + 8000;
  let button = null;

  while (Date.now() < deadline) {
    const found = findButton();
    if (found && isEnabled(found)) {
      button = found;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const press = (node) => {
    const options = { bubbles: true, cancelable: true, view: window };
    ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
      try {
        const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
        node.dispatchEvent(new Ctor(type, options));
      } catch (error) {
        node.dispatchEvent(new MouseEvent("click", options));
      }
    });
  };

  if (!button) {
    return { clicked: false, reason: findButton() ? "button stayed disabled" : "button not found" };
  }

  press(button);

  if (!advance) return { clicked: true, advanced: false };

  const findNext = () =>
    candidates().find((node) => {
      const text = norm(node.textContent || node.value || node.getAttribute("aria-label"));
      return text === "next question" || text === "next";
    }) || null;

  const nextDeadline = Date.now() + 10000;
  while (Date.now() < nextDeadline) {
    const next = findNext();
    if (next && isEnabled(next)) {
      press(next);
      return { clicked: true, advanced: true };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return { clicked: true, advanced: false, reason: "next button never appeared" };
}

async function scrapeAcrossFrames(tabId, site) {
  const config = SITES[site] || SITES.smartbook;

  const results = await chrome.scripting.executeScript({
    target: { tabId, allFrames: true },
    func: pageAgent,
    args: ["scrape", config.question, null, false],
  });

  const entries = results.filter((entry) => entry && entry.result);

  const questions = entries
    .filter((entry) => !entry.result.resultScreen)
    .sort((a, b) => b.result.choices.length - a.result.choices.length);

  if (questions.length) {
    return { frameId: questions[0].frameId, question: questions[0].result };
  }

  const resultScreen = entries.find((entry) => entry.result.resultScreen);
  if (resultScreen) return { frameId: resultScreen.frameId, resultScreen: true };

  return null;
}

const DEFAULT_SETTINGS = {
  assistant: "chatgpt",
  autoSelect: true,
  focusAssistantTab: false,
  confidence: "off",
  advance: false,
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

  if (found.resultScreen) {
    const results = await chrome.scripting.executeScript({
      target: { tabId, frameIds: [found.frameId] },
      func: nextAgent,
      args: [],
    });

    const moved = results && results[0] ? results[0].result : false;
    return {
      ok: true,
      done: true,
      status: moved
        ? "Moved to the next question."
        : "This is the answer screen; could not find Next Question.",
    };
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
    confidence: settings.confidence,
    advance: settings.advance,
    startedAt: Date.now(),
  });

  const tab = await ensureAssistantTab(
    settings.assistant,
    settings.focusAssistantTab
  );

  let ack;
  try {
    ack = await sendWhenReady(tab.id, {
      type: "receiveQuestion",
      question: found.question,
    });
  } catch (error) {
    await takePending();
    throw error;
  }

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
      func: pageAgent,
      args: [
        "apply",
        config.question,
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

  if (!clicked) {
    await notifySource(pending.sourceTabId, {
      type: "status",
      text: `No choice matched. Answer: ${answerText}`,
    });
    return;
  }

  let note = "";
  const level = pending.confidence;

  if (level && level !== "off") {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: pending.sourceTabId, frameIds: [pending.frameId] },
        func: submitAgent,
        args: [level, Boolean(pending.advance)],
      });

      const outcome = results && results[0] ? results[0].result : null;
      if (outcome && outcome.clicked) {
        note = outcome.advanced
          ? ` Submitted as ${level} and moved on.`
          : ` Submitted as ${level}.`;
      } else {
        note = ` Not submitted: ${outcome ? outcome.reason : "no result"}.`;
      }
    } catch (error) {
      note = ` Not submitted: ${error.message}.`;
    }
  }

  await notifySource(pending.sourceTabId, {
    type: "status",
    text: `Selected ${clicked} choice${clicked === 1 ? "" : "s"}.${note} ${parsed.explanation || ""}`,
  });
}

async function handleAssistantTimeout() {
  const pending = await takePending();
  if (!pending) return;

  await notifySource(pending.sourceTabId, {
    type: "status",
    text: "The assistant did not reply in time. Try again.",
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

  if (message.type === "assistantTimeout") {
    handleAssistantTimeout()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.type === "checkForUpdate") {
    checkForUpdate()
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

});
