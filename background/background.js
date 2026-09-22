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
    /^(exit assignment|concepts? completed|need help|read about the concept|rate your confidence|high|medium|low|reading|privacy center|terms of use|multiple choice question|fill in the blank question|select all that apply|ask ai|next|submit|back)\b/i;

  const deepQuery = (selector) => {
    const out = [];

    const walk = (root) => {
      let found = [];
      try {
        found = Array.from(root.querySelectorAll(selector));
      } catch (error) {
        found = [];
      }
      out.push(...found);

      let all = [];
      try {
        all = Array.from(root.querySelectorAll("*"));
      } catch (error) {
        all = [];
      }
      all.forEach((el) => {
        if (el.shadowRoot) walk(el.shadowRoot);
      });
    };

    walk(document);
    return out;
  };

  const FIELD_SELECTOR =
    "input[type='text'], input[type='number'], input[type='tel'], input:not([type]), textarea, select, [contenteditable='true'], [role='textbox']";

  const usableField = (node) => {
    if (!visible(node)) return false;
    if (node.disabled || node.readOnly) return false;
    if (node.closest && node.closest("header, nav, footer")) return false;

    const hint = norm(
      `${node.getAttribute("placeholder") || ""} ${node.getAttribute("aria-label") || ""} ${node.name || ""}`
    );
    return !/search|filter|feedback/i.test(hint);
  };

  const typeInto = (field, value) => {
    field.focus();
    field.click();

    if (field.tagName === "SELECT") {
      const match = Array.from(field.options).find(
        (option) => norm(option.textContent).toLowerCase() === norm(value).toLowerCase()
      );
      if (!match) return false;
      field.value = match.value;
    } else if (field.isContentEditable || field.getAttribute("role") === "textbox") {
      field.textContent = value;
    } else {
      const proto =
        field.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor && descriptor.set) {
        descriptor.set.call(field, value);
      } else {
        field.value = value;
      }
    }

    const last = value.slice(-1) || "a";
    const keyInit = { key: last, bubbles: true, cancelable: true };
    try {
      field.dispatchEvent(new KeyboardEvent("keydown", keyInit));
      field.dispatchEvent(new KeyboardEvent("keypress", keyInit));
    } catch (error) {
      // keyboard events are a nicety, not a requirement
    }

    field.dispatchEvent(new Event("input", { bubbles: true }));

    try {
      field.dispatchEvent(new KeyboardEvent("keyup", keyInit));
    } catch (error) {
      // ignore
    }

    field.dispatchEvent(new Event("change", { bubbles: true }));
    field.blur();

    if (field.tagName === "SELECT") return true;
    if (field.isContentEditable || field.getAttribute("role") === "textbox") {
      return norm(field.textContent) === norm(value);
    }
    return field.value === value;
  };

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

  const collectFields = () => {
    const nodes = deepQuery(FIELD_SELECTOR).filter(usableField);

    return nodes.map((node) => {
      if (node.tagName === "SELECT") {
        return {
          node,
          kind: "select",
          options: Array.from(node.options)
            .map((option) => norm(option.textContent))
            .filter(Boolean),
        };
      }
      return { node, kind: "text" };
    });
  };

  const parentOf = (node) => {
    if (!node) return null;
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode && node.getRootNode();
    return root && root.host ? root.host : null;
  };

  const textWithBlanks = (node) => {
    let out = "";

    const walk = (n) => {
      if (!n) return;

      if (n.nodeType === 3) {
        out += n.nodeValue;
        return;
      }

      if (n.nodeType !== 1) return;

      const tag = n.tagName;
      if (tag === "BUTTON" || tag === "NAV" || tag === "HEADER" || tag === "FOOTER") return;
      if (tag === "SCRIPT" || tag === "STYLE") return;

      let isField = false;
      try {
        isField = n.matches(FIELD_SELECTOR);
      } catch (error) {
        isField = false;
      }
      if (isField) {
        out += " _______ ";
        return;
      }

      if (n.shadowRoot) {
        Array.from(n.shadowRoot.childNodes).forEach(walk);
        return;
      }

      Array.from(n.childNodes).forEach(walk);
    };

    walk(node);
    return norm(out);
  };

  const stemAroundField = (field) => {
    let node = parentOf(field);

    for (let depth = 0; depth < 8 && node; depth += 1, node = parentOf(node)) {
      const text = textWithBlanks(node);
      if (text.length >= 15 && !NOISE.test(text)) return text;
    }

    return "";
  };

  const collectDraggables = () =>
    deepQuery('[draggable="true"]').filter(
      (node) => visible(node) && norm(node.textContent).length > 2
    );

  const collectZones = () =>
    deepQuery("div, li, td, section").filter((node) => {
      if (!visible(node)) return false;
      if (norm(node.textContent)) return false;
      if (node.querySelector("*")) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 60 && rect.height > 20;
    });

  const termForZone = (zone) => {
    let node = parentOf(zone);

    for (let depth = 0; depth < 4 && node; depth += 1, node = parentOf(node)) {
      const text = norm(node.textContent);
      if (text && text.length <= 120 && !NOISE.test(text)) return text;
    }

    return "";
  };

  const collectChoices = () => {
    const inputs = deepQuery("input[type='radio'], input[type='checkbox']").filter(visible);

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

    const draggables = choices.length ? [] : collectDraggables();

    if (!choices.length && draggables.length >= 2) {
      const options = draggables.map((node) => norm(node.textContent));
      const terms = collectZones().map(termForZone).filter(Boolean);
      const stem = findStem(draggables[0]);

      return {
        questionText: stem,
        choices: [],
        fields: [],
        blanks: 0,
        terms,
        options,
        questionType: "matching-dnd",
      };
    }

    const fields = choices.length ? [] : collectFields();
    const anchor = choices.length
      ? choices[0].input
      : fields.length
        ? document.querySelector(
            "input[type='text'], input[type='number'], input:not([type]), textarea, select, [contenteditable='true']"
          )
        : null;
    let stem = findStem(anchor);

    if (!stem && fields.length) stem = stemAroundField(fields[0].node);
    if (fields.length && !choices.length) {
      const around = stemAroundField(fields[0].node);
      if (around.length > stem.length) stem = around;
    }

    if (!stem && !choices.length && !fields.length) return null;

    const isMulti = choices.some((c) => c.input.type === "checkbox");
    const hasSelect = fields.some((f) => f.kind === "select");

    return {
      questionText: stem,
      choices: choices.map((choice, index) => ({
        label: String.fromCharCode(65 + index),
        text: choice.text,
      })),
      fields: fields.map((field) => ({
        kind: field.kind,
        options: field.options || null,
      })),
      blanks: fields.length,
      questionType: choices.length
        ? isMulti
          ? "multiple-select"
          : "multiple-choice"
        : hasSelect
          ? "matching"
          : "fill-in-the-blank",
    };
  }

  const draggables = choices.length ? [] : collectDraggables();

  if (!choices.length && draggables.length >= 2) {
    const values = Array.isArray(answer) ? answer : [answer];

    const zones = collectZones();

    if (!zones.length) {
      return {
        count: 0,
        mode: "match",
        found: draggables.length,
        detail: "found the cards but no empty slots to drop them in",
      };
    }

    const dragTo = (source, target) => {
      const dt = typeof DataTransfer === "function" ? new DataTransfer() : null;
      const sRect = source.getBoundingClientRect();
      const tRect = target.getBoundingClientRect();
      const from = { clientX: sRect.left + sRect.width / 2, clientY: sRect.top + sRect.height / 2 };
      const to = { clientX: tRect.left + tRect.width / 2, clientY: tRect.top + tRect.height / 2 };
      const base = { bubbles: true, cancelable: true, view: window };

      try {
        source.dispatchEvent(new PointerEvent("pointerdown", { ...base, ...from, buttons: 1 }));
        source.dispatchEvent(new MouseEvent("mousedown", { ...base, ...from, buttons: 1 }));
        document.dispatchEvent(new PointerEvent("pointermove", { ...base, ...to, buttons: 1 }));
        document.dispatchEvent(new MouseEvent("mousemove", { ...base, ...to, buttons: 1 }));
        target.dispatchEvent(new PointerEvent("pointerup", { ...base, ...to }));
        target.dispatchEvent(new MouseEvent("mouseup", { ...base, ...to }));
      } catch (error) {
        // fall through to the HTML5 sequence
      }

      try {
        const opts = dt ? { ...base, dataTransfer: dt } : base;
        source.dispatchEvent(new DragEvent("dragstart", { ...opts, ...from }));
        target.dispatchEvent(new DragEvent("dragenter", { ...opts, ...to }));
        target.dispatchEvent(new DragEvent("dragover", { ...opts, ...to }));
        target.dispatchEvent(new DragEvent("drop", { ...opts, ...to }));
        source.dispatchEvent(new DragEvent("dragend", { ...opts, ...to }));
      } catch (error) {
        return false;
      }

      return true;
    };

    let moved = 0;
    values.forEach((value, index) => {
      const wantedText = norm(value).toLowerCase();
      const card = draggables.find(
        (node) => norm(node.textContent).toLowerCase() === wantedText
      ) || draggables.find(
        (node) => norm(node.textContent).toLowerCase().includes(wantedText)
      );

      const zone = zones[index];
      if (!card || !zone) return;
      if (dragTo(card, zone)) moved += 1;
    });

    return {
      count: moved,
      mode: "match",
      found: draggables.length,
      detail: moved ? "" : "drag did not register",
      mapping: values,
    };
  }

  if (!choices.length) {
    const fields = deepQuery(FIELD_SELECTOR).filter(usableField);

    if (!fields.length) {
      const anyField = deepQuery(FIELD_SELECTOR).length;
      return {
        count: 0,
        mode: "field",
        found: 0,
        detail: anyField
          ? `${anyField} field(s) on the page but none usable`
          : "no answer field found",
      };
    }

    const values = Array.isArray(answer) ? answer : [answer];
    let filled = 0;
    const misses = [];

    fields.forEach((field, index) => {
      const value = values[index] != null ? String(values[index]) : null;
      if (value == null) return;

      if (typeInto(field, value)) {
        filled += 1;
      } else {
        misses.push(`${field.tagName.toLowerCase()}${field.type ? ":" + field.type : ""}`);
      }
    });

    return {
      count: filled,
      mode: "field",
      found: fields.length,
      detail: misses.length ? `value did not stick in ${misses.join(", ")}` : "",
    };
  }

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

  return { count: clicked, mode: "choice", found: choices.length, detail: "" };
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

  const readResult = async () => {
    const deadline = Date.now() + 6000;

    while (Date.now() < deadline) {
      const text = norm(document.body.textContent);

      if (text.includes("your answer")) {
        let verdict = null;
        const nodes = Array.from(document.querySelectorAll("*")).filter((el) => {
          const own = norm(el.textContent);
          return own.includes("your answer") && own.length < 400;
        });

        for (const node of nodes) {
          const own = norm(node.textContent);
          if (own.includes("incorrect")) { verdict = "incorrect"; break; }
          if (own.includes("correct")) verdict = "correct";
        }

        let correctAnswer = null;
        const heading = Array.from(document.querySelectorAll("*")).find(
          (el) => norm(el.textContent) === "correct answer"
        );
        if (heading) {
          let sib = heading.nextElementSibling;
          while (sib && !norm(sib.textContent)) sib = sib.nextElementSibling;
          if (sib) correctAnswer = norm(sib.textContent).slice(0, 400);
          if (!correctAnswer && heading.parentElement) {
            const parent = norm(heading.parentElement.textContent);
            correctAnswer = parent.replace(/^correct answer/i, "").trim().slice(0, 400) || null;
          }
        }

        if (verdict) return { verdict, correctAnswer };
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return { verdict: null, correctAnswer: null };
  };

  const result = await readResult();

  if (!advance) {
    return { clicked: true, advanced: false, ...result };
  }

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
      return { clicked: true, advanced: true, ...result };
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }

  return { clicked: true, advanced: false, reason: "next button never appeared", ...result };
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

  if (!found.question.questionText) {
    throw new Error("Could not read the question text on this page");
  }

  const settings = await getSettings();
  const config = ASSISTANTS[settings.assistant];

  await setPending({
    sourceTabId: tabId,
    frameId: found.frameId,
    site: message.site,
    questionType: found.question.questionType,
    questionText: found.question.questionText,
    choices: found.question.choices,
    terms: found.question.terms || [],
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
      outcome: "failed",
      text: `Could not read the reply: ${error.message}`,
    });
    return;
  }

  const answerText = JSON.stringify(parsed.answer);

  if (!pending.autoSelect) {
    await notifySource(pending.sourceTabId, {
      type: "status",
      outcome: "manual",
      text: `Answer: ${answerText}. ${parsed.explanation || ""}`,
    });
    return;
  }

  const config = SITES[pending.site] || SITES.smartbook;

  let clicked = 0;
  let applyReport = null;
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
    const report = results && results[0] ? results[0].result : null;
    clicked = report ? report.count : 0;
    applyReport = report;
  } catch (error) {
    await notifySource(pending.sourceTabId, {
      type: "status",
      outcome: "failed",
      text: `Could not reach the question frame: ${error.message}`,
    });
    return;
  }

  if (!clicked) {
    const mode = applyReport ? applyReport.mode : "choice";
    const detail = applyReport && applyReport.detail ? ` (${applyReport.detail})` : "";

    let text;
    if (mode === "match") {
      const pairs = (pending.terms || []).length
        ? pending.terms
            .map((term, index) => `${term} -> ${(Array.isArray(parsed.answer) ? parsed.answer : [])[index] || "?"}`)
            .join("; ")
        : answerText;
      text = `Could not drag the cards${detail}. Place them yourself: ${pairs}`;
    } else if (mode === "field") {
      text = `Could not enter the answer${detail}. Answer: ${answerText}`;
    } else {
      text = `No choice matched${detail}. Answer: ${answerText}`;
    }

    await notifySource(pending.sourceTabId, {
      type: "status",
      outcome: "failed",
      text,
    });
    return;
  }

  let note = "";
  let advanced = false;
  let verdict = null;
  let correctAnswer = null;
  const level = pending.confidence;

  if (level && level !== "off") {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: pending.sourceTabId, frameIds: [pending.frameId] },
        func: submitAgent,
        args: [level, Boolean(pending.advance)],
      });

      const outcome = results && results[0] ? results[0].result : null;
      advanced = Boolean(outcome && outcome.advanced);
      verdict = outcome && outcome.verdict ? outcome.verdict : null;
      correctAnswer = outcome && outcome.correctAnswer ? outcome.correctAnswer : null;
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

  await appendNote({
    at: new Date().toISOString(),
    question: pending.questionText || "",
    choices: pending.choices || [],
    answer: parsed.answer,
    explanation: parsed.explanation || "",
    assistant: pending.assistant,
    verdict,
    correctAnswer,
  });

  await notifySource(pending.sourceTabId, {
    type: "status",
    outcome: "selected",
    advanced,
    verdict,
    text: `${
      applyReport && applyReport.mode === "field"
        ? `Typed ${clicked} answer${clicked === 1 ? "" : "s"}.`
        : applyReport && applyReport.mode === "match"
          ? `Matched ${clicked} card${clicked === 1 ? "" : "s"}.`
          : `Selected ${clicked} choice${clicked === 1 ? "" : "s"}.`
    }${note}${
      verdict ? ` Marked ${verdict}.` : ""
    } ${parsed.explanation || ""}`,
  });
}

async function handleAssistantTimeout() {
  const pending = await takePending();
  if (!pending) return;

  await notifySource(pending.sourceTabId, {
    type: "status",
    outcome: "timeout",
    text: "The assistant did not reply in time.",
  });
}

const NOTE_LIMIT = 500;

async function appendNote(entry) {
  const { notes = [] } = await chrome.storage.local.get("notes");
  notes.push(entry);
  if (notes.length > NOTE_LIMIT) notes.splice(0, notes.length - NOTE_LIMIT);
  await chrome.storage.local.set({ notes });
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
