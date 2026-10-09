const ASSISTANTS = {
  chatgpt: {
    label: "ChatGPT",
    url: "https://chatgpt.com/",
    match: "https://chatgpt.com/*",
    responseType: "chatgptResponse",
    files: ["content-scripts/shared/prompt-builder.js", "content-scripts/chatgpt.js"],
  },
  gemini: {
    label: "Gemini",
    url: "https://gemini.google.com/app",
    match: "https://gemini.google.com/*",
    responseType: "geminiResponse",
    files: ["content-scripts/shared/prompt-builder.js", "content-scripts/gemini.js"],
  },
  deepseek: {
    label: "DeepSeek",
    url: "https://chat.deepseek.com/",
    match: "https://chat.deepseek.com/*",
    responseType: "deepseekResponse",
    files: ["content-scripts/shared/prompt-builder.js", "content-scripts/deepseek.js"],
  },
};

const SITES = {
  canvas: {
    mode: "page",
    blocks: [
      ".question_holder",
      ".display_question",
      "[id^='question_']",
      ".quiz_question",
    ],
    question: [
      ".question_text",
      "[class*='questionText']",
      ".text_holder",
    ],
  },
  smartbook: {
    mode: "single",
    blocks: [],
    // SmartBook ships a stable, semantic DOM. These are its real class names;
    // the looser patterns below them are kept only as a safety net.
    question: [
      ".probe-container .prompt",
      "[class*='awd-probe-type-'] .prompt",
      ".prompt",
      "[data-automation-id='question-stem']",
      "[class*='questionStem']",
      ".probe-question",
      ".question-stem",
    ],
    choice: [
      ".choiceText",
      ".choice.-interactive",
      "[data-automation-id='choice']",
      ".choice",
      "[class*='choiceRow']",
      "label[for^='choice']",
    ],
  },
  ezto: {
    mode: "single",
    flow: "connect",
    blocks: [],
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

async function pageAgent(op, questionSelectors, answer, allowMultiple, blockSelectors, blockIndex) {
  const norm = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

  const NOISE =
    /^(exit assignment|concepts? completed|need help|read about the concept|rate your confidence|high|medium|low|reading|privacy center|terms of use|multiple choice question|fill in the blank question|ask ai|next|submit|back)\b/i;

  const deepQuery = (selector, scope) => {
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

    walk(scope || document);
    return out;
  };

  const findBlocks = () => {
    for (const selector of blockSelectors || []) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (error) {
        continue;
      }
      nodes = nodes.filter((node) => node.offsetParent !== null || node.getClientRects().length);
      if (nodes.length) return nodes;
    }
    return [];
  };

  const blocks = findBlocks();
  const usePages = blocks.length > 0 && typeof blockIndex === "number";
  const scope = usePages ? blocks[blockIndex] : null;

  if (usePages && !scope) {
    return op === "scrape" ? { exhausted: true, total: blocks.length } : { count: 0, mode: "none" };
  }

  const hasDiagram = () => {
    const root = scope || document;
    return Array.from(root.querySelectorAll("img, canvas, svg")).some((node) => {
      if (!visible(node)) return false;
      const rect = node.getBoundingClientRect();
      const w = node.naturalWidth || rect.width;
      const h = node.naturalHeight || rect.height;
      return w >= 80 && h >= 80;
    });
  };

  const FIELD_SELECTOR =
    "input[type='text'], input[type='number'], input[type='tel'], input:not([type]), textarea, select, [contenteditable='true'], [role='textbox']";

  const usableField = (node) => {
    if (!visible(node)) return false;
    if (node.disabled || node.readOnly) return false;
    if (node.getAttribute("aria-hidden") === "true") return false;
    if (node.getAttribute("tabindex") === "-1") return false;
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

  const srOnly = (el) => {
    if (!el || el.nodeType !== 1) return false;

    const cls = String(el.className || "");
    if (/sr-only|visually-hidden|visuallyhidden|screen-?reader|a11y-only/i.test(cls)) return true;

    let style;
    try {
      style = window.getComputedStyle(el);
    } catch (error) {
      return false;
    }
    if (!style) return false;

    if (style.clipPath === "inset(50%)") return true;
    if (style.clip && style.clip.replace(/\s/g, "") === "rect(0px,0px,0px,0px)") return true;

    if (style.position === "absolute") {
      const w = parseFloat(style.width);
      const h = parseFloat(style.height);
      if ((w && w <= 1) || (h && h <= 1)) return true;
    }

    return false;
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

  const labelForField = (node) => {
    if (node.id) {
      try {
        const explicit = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
        const text = explicit ? norm(explicit.textContent) : "";
        if (text) return text;
      } catch (error) {
        // fall through
      }
    }

    const aria = norm(node.getAttribute("aria-label") || node.getAttribute("placeholder"));
    if (aria) return aria;

    const cell = node.closest && node.closest("td, th, li, tr, div");
    let row = cell;

    for (let depth = 0; depth < 3 && row; depth += 1, row = row.parentElement) {
      const clone = row.cloneNode(true);
      clone
        .querySelectorAll("input, textarea, select, [contenteditable='true']")
        .forEach((el) => el.remove());

      const text = norm(clone.textContent);
      if (text && text.length <= 120) return text;
    }

    return "";
  };

  const collectFields = () => {
    const nodes = deepQuery(FIELD_SELECTOR, scope).filter(usableField);

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
      return { node, kind: "text", label: labelForField(node) };
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
      if (n.id && String(n.id).startsWith("hw-helper")) return;
      if (srOnly(n)) return;
      if (n.getAttribute("aria-hidden") === "true") return;

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

  const DESCRIPTION = /^(a )?table (has|with) \d+ columns?|column \d+ (lists|has|contains)/i;

  const NAV = /check my work|save & exit|\bsubmit\b|\bprev\b|\bnext\b|references|ebook|\bhint\b|\bprint\b|\b\d+\s+of\s+\d+\b/i;

  const stemAroundField = (field) => {
    let node = parentOf(field);
    let best = "";

    for (let depth = 0; depth < 9 && node; depth += 1, node = parentOf(node)) {
      if (scope && !scope.contains(node)) break;

      const text = textWithBlanks(node);
      if (!text || NOISE.test(text)) continue;
      if (text.length > 2000) break;
      if (NAV.test(text)) break;

      const meaningful = text.replace(/_{3,}/g, " ").replace(/\s+/g, " ").trim();
      if (DESCRIPTION.test(meaningful)) continue;

      if (text.length > best.length) best = text;
      if (best.length >= 400) break;
    }

    return best;
  };

  const collectDraggables = () =>
    deepQuery('[draggable="true"]', scope).filter(
      (node) => visible(node) && norm(node.textContent).length > 2
    );

  const broadStem = (anchor) => {
    const root = scope || document;
    let candidates = [];
    try {
      candidates = Array.from(root.querySelectorAll("p, div, li, td, section, article, span"));
    } catch (error) {
      return "";
    }

    let best = "";

    for (const el of candidates) {
      if (!el || srOnly(el)) continue;
      if (el.id && String(el.id).startsWith("hw-helper")) continue;
      if (el.getAttribute && el.getAttribute("aria-hidden") === "true") continue;
      if (!visible(el)) continue;

      let hasControls = false;
      try {
        hasControls = Boolean(el.querySelector("input, textarea, select, button, nav, iframe"));
      } catch (error) {
        hasControls = true;
      }
      if (hasControls) continue;

      if (anchor) {
        const rel = el.compareDocumentPosition(anchor);
        if (!(rel & Node.DOCUMENT_POSITION_FOLLOWING)) continue;
      }

      const text = norm(el.textContent);
      if (text.length < 40 || text.length > 1600) continue;
      if (NOISE.test(text) || NAV.test(text) || DESCRIPTION.test(text)) continue;

      if (text.length > best.length) best = text;
    }

    return best;
  };

  const CELL_SELECTOR =
    "td.responseCell, td[class*='responseCell'], td[class*='response'][id*='_cell_'], [role='gridcell'][tabindex]";

  const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const collectCells = () =>
    deepQuery(CELL_SELECTOR, scope).filter((node) => {
      if (!visible(node)) return false;
      const cls = String(node.className || "");
      if (/readonly|rowheader/i.test(cls)) return false;
      return true;
    });

  const labelForCell = (cell) => {
    const row = cell.closest && cell.closest("tr");
    if (!row) return "";

    const siblings = Array.from(row.querySelectorAll("td, th")).filter(
      (td) => td !== cell && norm(td.textContent)
    );
    return siblings.length ? norm(siblings[0].textContent) : "";
  };

  const formulaBar = () =>
    deepQuery(
      "textarea[class*='jSheetControls_formula'], textarea[id*='jSheetControls_formula'], input[class*='formula']"
    )[0] || null;

  const fillCell = async (cell, value) => {
    try {
      cell.scrollIntoView({ block: "center" });
    } catch (error) {
      // ignore
    }

    const options = { bubbles: true, cancelable: true, view: window };
    ["pointerdown", "mousedown", "mouseup", "click"].forEach((type) => {
      try {
        const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
        cell.dispatchEvent(new Ctor(type, options));
      } catch (error) {
        cell.dispatchEvent(new MouseEvent("click", options));
      }
    });

    await pause(180);

    const commit = (node) => {
      const proto =
        node.tagName === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor && descriptor.set) descriptor.set.call(node, value);
      else node.value = value;

      const key = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
      node.dispatchEvent(new Event("input", { bubbles: true }));
      try {
        node.dispatchEvent(new KeyboardEvent("keydown", key));
        node.dispatchEvent(new KeyboardEvent("keyup", key));
      } catch (error) {
        // ignore
      }
      node.dispatchEvent(new Event("change", { bubbles: true }));
      try {
        node.blur();
      } catch (error) {
        // ignore
      }
    };

    const bar = formulaBar();
    if (bar) commit(bar);

    await pause(220);
    if (norm(cell.textContent).includes(norm(value))) return true;

    // some builds open an editor over the cell instead
    const active = document.activeElement;
    if (active && /TEXTAREA|INPUT/.test(active.tagName) && active !== bar) {
      commit(active);
      await pause(220);
      if (norm(cell.textContent).includes(norm(value))) return true;
    }

    return norm(cell.textContent).includes(norm(value));
  };

  const collectZones = () =>
    deepQuery("div, li, td, section", scope).filter((node) => {
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
    const inputs = deepQuery("input[type='radio'], input[type='checkbox']", scope).filter(visible);

    return inputs
      .map((input) => ({ input, text: labelTextFor(input) }))
      .filter((choice) => choice.text && !NOISE.test(choice.text));
  };

  // A prompt carries screen-reader spans and the chrome around its blanks inside
  // the same element as the wording. Reading textContent drags all of that into
  // the question; strip it, and mark each blank so the assistant knows how many
  // values to supply.
  const cleanStem = (node) => {
    let clone;
    try {
      clone = node.cloneNode(true);
    } catch (error) {
      return norm(node.textContent);
    }

    clone
      .querySelectorAll(
        "span.fitb-span, span.blank-label, span.correctness, span._visuallyHidden, .sr-only, [aria-hidden='true']"
      )
      .forEach((el) => el.remove());

    clone.querySelectorAll("input, textarea, select").forEach((el) => {
      el.replaceWith(document.createTextNode(" [BLANK] "));
    });

    return norm(clone.textContent);
  };

  const findStem = (anchor) => {
    const root = scope || document;

    for (const selector of questionSelectors || []) {
      try {
        const node = root.querySelector(selector);
        const text = node ? cleanStem(node) : "";
        if (text) return text;
      } catch (error) {
        continue;
      }
    }

    if (!anchor) return "";

    const candidates = Array.from(
      root.querySelectorAll("p, div, span, h1, h2, h3, h4, legend, li")
    );

    let best = "";
    for (const el of candidates) {
      if (el.id && String(el.id).startsWith("hw-helper")) continue;
      if (srOnly(el)) continue;
      if (el.querySelector && el.querySelector("[id^='hw-helper']")) continue;
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

  if (op === "reveal") {
    const target = scope || document.body;
    if (target && target.scrollIntoView) {
      target.scrollIntoView({ block: "center", inline: "nearest" });
    }
    const rect = target.getBoundingClientRect();
    return {
      x: Math.max(0, rect.left),
      y: Math.max(0, rect.top),
      width: Math.min(rect.width, window.innerWidth),
      height: Math.min(rect.height, window.innerHeight - Math.max(0, rect.top)),
      ratio: window.devicePixelRatio || 1,
    };
  }

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

    let fields = choices.length ? [] : collectFields();
    const cells = choices.length || fields.length ? [] : collectCells();

    if (cells.length) {
      fields = cells.map((cell) => ({ node: cell, kind: "cell", label: labelForCell(cell) }));
    }
    const anchor = choices.length
      ? choices[0].input
      : fields.length
        ? document.querySelector(
            "input[type='text'], input[type='number'], input:not([type]), textarea, select, [contenteditable='true']"
          )
        : null;
    let stem = findStem(anchor);

    if (!stem && fields.length) stem = stemAroundField(fields[0].node);
    if (!stem) stem = broadStem(anchor);
    if (fields.length && !choices.length) {
      const around = stemAroundField(fields[0].node);
      if (around.length > stem.length) stem = around;

      const broad = broadStem(fields[0].node);
      if (broad.length > stem.length) stem = broad;
    }

    if (!stem && !choices.length && !fields.length && !draggables.length) {
      const loose = broadStem(null);
      if (loose && loose.length > 60) {
        return {
          questionText: loose,
          choices: [],
          fields: [],
          blanks: 0,
          questionType: "fill-in-the-blank",
          textOnly: true,
        };
      }
      return null;
    }

    const isMulti = choices.some((c) => c.input.type === "checkbox");
    const hasSelect = fields.some((f) => f.kind === "select");

    let diagram = null;
    if (hasDiagram()) {
      const target = scope || document.body;
      const rect = target.getBoundingClientRect();
      diagram = {
        x: Math.max(0, rect.left),
        y: Math.max(0, rect.top),
        width: Math.min(rect.width, window.innerWidth),
        height: Math.min(rect.height, window.innerHeight),
        ratio: window.devicePixelRatio || 1,
        onScreen: rect.top >= 0 && rect.bottom <= window.innerHeight,
      };
    }

    return {
      questionText: stem,
      diagram,
      index: usePages ? blockIndex : 0,
      total: usePages ? blocks.length : 1,
      choices: choices.map((choice, index) => ({
        label: String.fromCharCode(65 + index),
        text: choice.text,
      })),
      fields: fields.map((field) => ({
        kind: field.kind,
        label: field.label || "",
        options: field.options || null,
      })),
      blanks: fields.length,
      source: null,
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
    const cells = collectCells();

    if (cells.length && !deepQuery(FIELD_SELECTOR, scope).filter(usableField).length) {
      const values = Array.isArray(answer) ? answer : [answer];
      let done = 0;
      const missed = [];

      for (let i = 0; i < cells.length; i += 1) {
        const value = values[i] != null ? String(values[i]) : null;
        if (value == null) continue;

        if (await fillCell(cells[i], value)) done += 1;
        else missed.push(cells[i].id || `cell ${i + 1}`);
      }

      return {
        count: done,
        mode: "field",
        found: cells.length,
        detail: missed.length ? `sheet cell did not take the value: ${missed.join(", ")}` : "",
      };
    }

    const fields = deepQuery(FIELD_SELECTOR, scope).filter(usableField);

    if (!fields.length) {
      const anyField = deepQuery(FIELD_SELECTOR, scope).length;
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

async function connectAgent(doCheck, advance) {
  const norm = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().toLowerCase();

  const clickable = () =>
    Array.from(
      document.querySelectorAll("button, [role='button'], a, input[type='button'], input[type='submit']")
    );

  const visible = (node) => {
    if (!node) return false;
    const rect = node.getBoundingClientRect();
    return (rect.width > 0 && rect.height > 0) || node.offsetParent !== null;
  };

  const enabled = (node) =>
    !(
      node.disabled ||
      node.getAttribute("aria-disabled") === "true" ||
      node.className.toString().toLowerCase().includes("disabled")
    );

  const byText = (...wanted) =>
    clickable().find((node) => {
      const text = norm(node.textContent || node.value || node.getAttribute("aria-label"));
      return wanted.includes(text) && visible(node) && enabled(node);
    }) || null;

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

  const waitFor = async (find, ms) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      const node = find();
      if (node) return node;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return null;
  };

  let verdict = null;

  if (doCheck) {
    const opener = byText("check my work");
    if (!opener) return { checked: false, verdict: null, advanced: false, reason: "no Check my work button" };

    press(opener);

    // the confirmation dialog repeats the same label
    const confirm = await waitFor(() => {
      const all = clickable().filter((node) => {
        const text = norm(node.textContent || node.value);
        return text === "check my work" && visible(node) && node !== opener;
      });
      return all.length ? all[all.length - 1] : null;
    }, 4000);

    if (confirm) press(confirm);

    // the review view announces itself and offers a way back
    const back = await waitFor(() => byText("return to question"), 9000);

    const checkedInput = document.querySelector(
      "input[type='radio']:checked, input[type='checkbox']:checked"
    );

    if (checkedInput) {
      let row = checkedInput.parentElement;
      for (let depth = 0; depth < 5 && row; depth += 1, row = row.parentElement) {
        const blob = norm(
          `${row.className} ${row.getAttribute("aria-label") || ""} ${row.getAttribute("title") || ""}`
        );
        if (/\bincorrect|wrong\b/.test(blob)) {
          verdict = "incorrect";
          break;
        }
        if (/\bcorrect|right\b/.test(blob)) {
          verdict = "correct";
          break;
        }
        const marked = row.querySelector("[class*='correct'], [aria-label*='orrect'], [title*='orrect']");
        if (marked) {
          verdict = norm(marked.className + " " + (marked.getAttribute("aria-label") || "")).includes("incorrect")
            ? "incorrect"
            : "correct";
          break;
        }
      }
    }

    if (back) press(back);
    await new Promise((resolve) => setTimeout(resolve, 700));
  }

  if (!advance) return { checked: doCheck, verdict, advanced: false };

  const next = await waitFor(() => byText("next", "next question", "next >"), 6000);
  if (!next) return { checked: doCheck, verdict, advanced: false, reason: "no Next button" };

  press(next);
  return { checked: doCheck, verdict, advanced: true };
}

async function nextAgent() {
  const norm = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().toLowerCase();

  // SmartBook marks its own Next control with a class; everywhere else, fall
  // back to matching the visible wording.
  const node =
    document.querySelector(".next-button") ||
    Array.from(
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

  // SmartBook's confidence buttons are addressable directly. Their labels are
  // what the loose text match was aiming at, so try the real hook first.
  const byAutomationId = () => {
    const level = wanted.replace(/\s+/g, "_");
    try {
      return document.querySelector(
        `[data-automation-id="confidence-buttons--${level}"], [data-automation-id="confidence-buttons--${level}_confidence"]`
      );
    } catch (error) {
      return null;
    }
  };

  const findButton = () =>
    byAutomationId() ||
    candidates().find((node) => {
      const text = norm(node.textContent || node.value || node.getAttribute("aria-label"));
      return text === wanted;
    }) ||
    null;

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

async function scrapeAcrossFrames(tabId, site, blockIndex = null) {
  const config = SITES[site] || SITES.smartbook;

  const args = [
    "scrape",
    config.question,
    null,
    false,
    config.blocks || [],
    blockIndex ?? null,
  ];

  // One frame the extension is not allowed to touch rejects the whole all-frames
  // call, which loses the question even when the main document is holding it.
  // Fall back to the top frame rather than failing the question outright.
  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      func: pageAgent,
      args,
    });
  } catch (error) {
    results = await chrome.scripting.executeScript({
      target: { tabId },
      func: pageAgent,
      args,
    });
  }

  const entries = results.filter((entry) => entry && entry.result);

  const exhausted = entries.find((entry) => entry.result.exhausted);
  if (exhausted && entries.every((entry) => entry.result.exhausted)) {
    return { exhausted: true, total: exhausted.result.total };
  }

  const diagram = entries.find((entry) => entry.result.needsImage);
  if (diagram) {
    return {
      frameId: diagram.frameId,
      needsImage: true,
      index: diagram.result.index,
      total: diagram.result.total,
      questionText: diagram.result.questionText,
    };
  }

  const answerable = (result) =>
    (result.choices || []).length +
    (result.fields || []).length +
    (result.options || []).length;

  const score = (result) =>
    answerable(result) * 1000 + Math.min((result.questionText || "").length, 999);

  const questions = entries
    .filter((entry) => !entry.result.resultScreen)
    .sort((a, b) => score(b.result) - score(a.result));

  const usable = questions.filter((entry) => answerable(entry.result) > 0);
  const best = usable.length ? usable[0] : questions[0];

  if (best) {
    const question = { ...best.result };

    const elsewhere = questions
      .filter((entry) => entry !== best)
      .map((entry) => entry.result.questionText || "")
      .sort((a, b) => b.length - a.length)[0];

    const local = question.questionText || "";

    // borrow when this frame has no wording, or only the labels beside its controls
    if (elsewhere && elsewhere.length > 40 && elsewhere.length > local.length + 60) {
      question.questionText = elsewhere;
      question.stemFromAnotherFrame = true;
    }

    return { frameId: best.frameId, question };
  }

  const resultScreen = entries.find((entry) => entry.result.resultScreen);
  if (resultScreen) return { frameId: resultScreen.frameId, resultScreen: true };

  return null;
}

const DEFAULT_SETTINGS = {
  assistant: "chatgpt",
  checkWork: false,
  images: false,
  verify: false,
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

// Chrome injects a content script when a matching tab navigates, not when the
// extension is installed. An assistant tab left open across an install or an
// update therefore never receives the adapter, and every question sent to it is
// dropped until that tab is reloaded. Put the adapter there ourselves.
async function injectAssistant(tabId) {
  let tab;
  try {
    tab = await chrome.tabs.get(tabId);
  } catch (error) {
    return false;
  }

  const key = Object.keys(ASSISTANTS).find((name) => {
    const origin = new URL(ASSISTANTS[name].url).origin;
    return tab.url && tab.url.startsWith(origin);
  });

  if (!key || !ASSISTANTS[key].files) return false;

  // a tab that already has the adapter is merely still starting up; injecting a
  // second copy would answer the same question twice
  try {
    const probe = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(window.__hwHelperAdapter),
    });
    if (probe && probe[0] && probe[0].result) return false;
  } catch (error) {
    return false;
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ASSISTANTS[key].files,
    });
    return true;
  } catch (error) {
    return false;
  }
}

async function sendWhenReady(tabId, message, attempts = 24) {
  let lastError = null;
  let injected = false;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      lastError = error;

      // a couple of failures in is long enough to tell "still loading" from
      // "no adapter in this tab at all"
      if (!injected && attempt >= 2) {
        injected = await injectAssistant(tabId);
      }

      await delay(750);
    }
  }

  throw new Error(
    `Assistant tab never became ready: ${lastError ? lastError.message : "unknown error"}`
  );
}

function diagnoseInPage() {
  const norm = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

  const deep = (selector) => {
    const out = [];
    const walk = (root) => {
      try {
        out.push(...Array.from(root.querySelectorAll(selector)));
      } catch (error) {
        return;
      }
      try {
        Array.from(root.querySelectorAll("*")).forEach((el) => {
          if (el.shadowRoot) walk(el.shadowRoot);
        });
      } catch (error) {
        // ignore
      }
    };
    walk(document);
    return out;
  };

  const seen = (node) => {
    const rect = node.getBoundingClientRect();
    return (rect.width > 0 && rect.height > 0) || node.offsetParent !== null;
  };

  const FIELDS =
    "input[type='text'], input[type='number'], input[type='tel'], input:not([type]), textarea, select, [contenteditable='true'], [role='textbox']";

  const describe = (node) => {
    const attrs = {};
    Array.from(node.attributes || []).forEach((a) => {
      if (a.value && a.value.length < 80) attrs[a.name] = a.value;
    });
    return {
      tag: node.tagName.toLowerCase(),
      type: node.type || null,
      visible: seen(node),
      disabled: Boolean(node.disabled),
      readOnly: Boolean(node.readOnly),
      attrs,
      ancestors: (() => {
        const path = [];
        let n = node.parentElement;
        for (let i = 0; i < 4 && n; i += 1, n = n.parentElement) {
          path.push(
            `${n.tagName.toLowerCase()}${n.id ? "#" + n.id : ""}${
              n.className && typeof n.className === "string"
                ? "." + n.className.trim().split(/\s+/).slice(0, 3).join(".")
                : ""
            }`
          );
        }
        return path;
      })(),
      nearbyText: (() => {
        let n = node.parentElement;
        for (let i = 0; i < 3 && n; i += 1, n = n.parentElement) {
          const clone = n.cloneNode(true);
          clone.querySelectorAll("input, textarea, select").forEach((el) => el.remove());
          const t = norm(clone.textContent);
          if (t) return t.slice(0, 120);
        }
        return "";
      })(),
    };
  };

  const fields = deep(FIELDS);
  const choices = deep("input[type='radio'], input[type='checkbox']");

  // grid widgets render answer cells as ordinary elements, not inputs
  const gridCells = deep(
    "td, [class*='cell'], [id*='cell'], [class*='jSheet'], [id*='jSheet'], [role='gridcell']"
  )
    .filter((node) => {
      if (!seen(node)) return false;
      const rect = node.getBoundingClientRect();
      return rect.width >= 30 && rect.height >= 12;
    })
    .slice(0, 24)
    .map((node) => ({
      tag: node.tagName.toLowerCase(),
      id: node.id || null,
      cls: (typeof node.className === "string" ? node.className : "").slice(0, 80) || null,
      text: norm(node.textContent).slice(0, 40),
      editable: node.isContentEditable || node.getAttribute("contenteditable") === "true",
      tabindex: node.getAttribute("tabindex"),
      role: node.getAttribute("role"),
      clickable: Boolean(node.onclick) || node.getAttribute("tabindex") !== null,
    }));

  return {
    frameUrl: location.href.slice(0, 160),
    isTop: window.top === window.self,
    bodyTextSample: norm(document.body ? document.body.innerText : "").slice(0, 400),
    choiceCount: choices.length,
    fieldCount: fields.length,
    visibleFieldCount: fields.filter(seen).length,
    fields: fields.slice(0, 8).map(describe),
    images: deep("img, canvas, svg").filter(seen).length,
    gridCells,
    gridHints: {
      jSheet: deep("[class*='jSheet'], [id*='jSheet']").length,
      tables: deep("table").length,
      contentEditable: deep("[contenteditable='true']").length,
    },
  };
}

async function grabImages(blockSelectors, blockIndex) {
  const findBlock = () => {
    if (typeof blockIndex !== "number") return null;
    for (const selector of blockSelectors || []) {
      let nodes = [];
      try {
        nodes = Array.from(document.querySelectorAll(selector));
      } catch (error) {
        continue;
      }
      nodes = nodes.filter((n) => n.offsetParent !== null || n.getClientRects().length);
      if (nodes.length) return nodes[blockIndex] || null;
    }
    return null;
  };

  const root = findBlock() || document.body;
  const big = (node) => {
    const rect = node.getBoundingClientRect();
    const w = node.naturalWidth || rect.width;
    const h = node.naturalHeight || rect.height;
    return w >= 80 && h >= 80;
  };

  const toDataUrl = (blob) =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });

  const rasterise = (dataUrl, width, height) =>
    new Promise((resolve) => {
      const image = new Image();
      image.onload = () => {
        try {
          const canvas = document.createElement("canvas");
          canvas.width = width || image.naturalWidth;
          canvas.height = height || image.naturalHeight;
          canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
        } catch (error) {
          resolve(null);
        }
      };
      image.onerror = () => resolve(null);
      image.src = dataUrl;
    });

  const out = [];

  for (const node of Array.from(root.querySelectorAll("img")).filter(big).slice(0, 3)) {
    const src = node.currentSrc || node.src;
    if (!src) continue;

    try {
      const response = await fetch(src, { credentials: "include" });
      const blob = await response.blob();
      const dataUrl = await toDataUrl(blob);

      if (dataUrl && dataUrl.startsWith("data:image/svg")) {
        const png = await rasterise(dataUrl, node.naturalWidth || 600, node.naturalHeight || 400);
        out.push(png || dataUrl);
      } else if (dataUrl) {
        out.push(dataUrl);
      }
    } catch (error) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = node.naturalWidth;
        canvas.height = node.naturalHeight;
        canvas.getContext("2d").drawImage(node, 0, 0);
        out.push(canvas.toDataURL("image/png"));
      } catch (inner) {
        // tainted or unreachable; skip this one
      }
    }
  }

  for (const node of Array.from(root.querySelectorAll("canvas")).filter(big).slice(0, 2)) {
    try {
      const url = node.toDataURL("image/png");
      if (url && url.length > 512) out.push(url);
    } catch (error) {
      // a canvas tainted by cross-origin drawing cannot be read
    }
  }

  for (const node of Array.from(root.querySelectorAll("svg")).filter(big).slice(0, 2)) {
    try {
      const markup = new XMLSerializer().serializeToString(node);
      const rect = node.getBoundingClientRect();
      const encoded =
        "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(markup)));
      const png = await rasterise(encoded, rect.width, rect.height);
      if (png) out.push(png);
    } catch (error) {
      // ignore
    }
  }

  return out;
}

async function handleAskQuestion(message, sender) {
  if (!sender.tab || sender.tab.id == null) {
    throw new Error("Question did not come from a tab");
  }

  const tabId = sender.tab.id;
  const config = SITES[message.site] || SITES.smartbook;
  const paged = config.mode === "page";
  const blockIndex = paged ? message.blockIndex || 0 : null;

  const found = await scrapeAcrossFrames(tabId, message.site, blockIndex);

  if (found && found.exhausted) {
    return { ok: true, done: true, status: `Reached the end of the page (${found.total} questions).` };
  }

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
  const assistant = ASSISTANTS[settings.assistant];

  let image = null;
  if (found.question.diagram) {
    if (!settings.images) {
      return {
        ok: true,
        skipped: true,
        index: found.question.index,
        status: `Question ${found.question.index + 1} has a diagram - skipped. Turn on Send diagrams to answer it.`,
      };
    }

    try {
      const grabbed = await chrome.scripting.executeScript({
        target: { tabId, frameIds: [found.frameId] },
        func: grabImages,
        args: [config.blocks || [], blockIndex ?? null],
      });

      const images = (grabbed && grabbed[0] && grabbed[0].result) || [];
      if (!images.length) throw new Error("the diagram could not be read from the page");
      image = images[0];
    } catch (error) {
      return {
        ok: true,
        skipped: true,
        index: found.question.index,
        status: `Question ${found.question.index + 1} has a diagram that could not be captured (${error.message}) - skipped.`,
      };
    }
  }

  const tab = await ensureAssistantTab(
    settings.assistant,
    settings.focusAssistantTab
  );

  await setPending({
    sourceTabId: tabId,
    frameId: found.frameId,
    site: message.site,
    blockIndex,
    questionType: found.question.questionType,
    questionText: found.question.questionText,
    choices: found.question.choices,
    terms: found.question.terms || [],
    assistant: settings.assistant,
    assistantTabId: tab.id,
    verify: settings.verify || Boolean(image),
    verifyReason: image && !settings.verify ? "diagram" : null,
    round: 1,
    priorAnswers: [],
    question: found.question,
    image,
    autoSelect: settings.autoSelect,
    confidence: settings.confidence,
    advance: settings.advance,
    checkWork: settings.checkWork,
    flow: (SITES[message.site] || SITES.smartbook).flow || null,
    startedAt: Date.now(),
  });

  let ack;
  try {
    ack = await sendWhenReady(tab.id, {
      type: "receiveQuestion",
      question: { ...found.question, source: message.site },
      image,
    });
  } catch (error) {
    await takePending();
    throw error;
  }

  if (ack && ack.received === false) {
    await takePending();
    throw new Error(ack.error || "Assistant refused the question");
  }

  return { ok: true, assistant: assistant.label };
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

function sameAnswer(a, b) {
  const flatten = (value) =>
    (Array.isArray(value) ? value : [value])
      .map((item) => String(item == null ? "" : item).replace(/\s+/g, " ").trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join("|");

  return flatten(a) === flatten(b);
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

  const expected = (pending.question && pending.question.blanks) || 0;
  const supplied = Array.isArray(parsed.answer) ? parsed.answer.length : 1;

  if (expected > 1 && supplied < expected && !pending.reshaped) {
    await setPending({ ...pending, reshaped: true, round: pending.round });

    await notifySource(pending.sourceTabId, {
      type: "status",
      outcome: "checking",
      text: `Got ${supplied} value${supplied === 1 ? "" : "s"} for ${expected} boxes - asking again.`,
    });

    try {
      await sendWhenReady(pending.assistantTabId, {
        type: "receiveQuestion",
        question: {
          ...pending.question,
          source: pending.site,
          retryHint: `Your last reply gave ${supplied} value${
            supplied === 1 ? "" : "s"
          }, but this question has ${expected} boxes. Reply with a JSON array of exactly ${expected} values, one per box, in the order listed.`,
        },
        image: pending.image,
      });
      return;
    } catch (error) {
      // fall through and apply what we have
    }
  }

  if (pending.verify && pending.round < 3) {
    const priorAnswers = [...(pending.priorAnswers || []), parsed.answer];
    const agreed = priorAnswers.length >= 2 &&
      priorAnswers.slice(0, -1).some((earlier) => sameAnswer(earlier, parsed.answer));

    if (!agreed) {
      await setPending({ ...pending, round: pending.round + 1, priorAnswers });

      await notifySource(pending.sourceTabId, {
        type: "status",
        outcome: "checking",
        text: priorAnswers.length === 1
          ? pending.verifyReason === "diagram"
            ? "Diagram question - checking that answer a second time..."
            : "Checking that answer a second time..."
          : "Two different answers so far - asking once more.",
      });

      try {
        await sendWhenReady(pending.assistantTabId, {
          type: "receiveQuestion",
          question: { ...pending.question, source: pending.site },
          image: pending.image,
        });
        return;
      } catch (error) {
        await notifySource(pending.sourceTabId, {
          type: "status",
          outcome: "failed",
          text: `Could not re-ask the question: ${error.message}`,
        });
        return;
      }
    }
  }

  if (pending.verify && pending.round >= 3) {
    const all = [...(pending.priorAnswers || []), parsed.answer];
    const agreed = all.some((a, i) => all.some((b, j) => i !== j && sameAnswer(a, b)));

    if (!agreed) {
      await notifySource(pending.sourceTabId, {
        type: "status",
        outcome: "failed",
        text: `Three different answers - left unanswered: ${all.map((a) => JSON.stringify(a)).join(" / ")}`,
      });
      return;
    }
  }

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
        config.blocks || [],
        pending.blockIndex ?? null,
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

  const siteConfig = SITES[pending.site] || SITES.smartbook;
  const paged = siteConfig.mode === "page";
  const connect = siteConfig.flow === "connect";
  let note = "";
  let advanced = paged;
  let verdict = null;
  let correctAnswer = null;
  const level = pending.confidence;

  if (connect) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: pending.sourceTabId, allFrames: true },
        func: connectAgent,
        args: [Boolean(pending.checkWork), Boolean(pending.advance)],
      });

      const all = results.map((entry) => entry && entry.result).filter(Boolean);
      const outcome =
        all.find((r) => r.checked || r.advanced) ||
        all.find((r) => !r.reason) ||
        all[0] ||
        null;
      verdict = outcome && outcome.verdict ? outcome.verdict : null;
      advanced = Boolean(outcome && outcome.advanced);

      const bits = [];
      if (outcome && outcome.checked) {
        bits.push(verdict ? `checked: ${verdict}` : "checked");
      }
      if (advanced) bits.push("moved on");
      if (outcome && outcome.reason) bits.push(outcome.reason);
      note = bits.length ? ` ${bits.join(", ")}.` : "";
    } catch (error) {
      note = ` Could not check or advance: ${error.message}.`;
    }
  } else if (!paged && level && level !== "off") {
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
    verified: Boolean(pending.verify),
    verdict,
    text: `${pending.verify ? (pending.verifyReason === "diagram" ? "Diagram, confirmed twice. " : "Confirmed twice. ") : ""}${
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

  if (message.type === "cancel") {
    takePending()
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === "diagnose") {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!tab) return { ok: false, error: "no active tab" };

      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id, allFrames: true },
        func: diagnoseInPage,
      });

      const settings = await getSettings();
      const assistantConfig = ASSISTANTS[settings.assistant];
      const assistantTabs = await chrome.tabs.query({ url: assistantConfig.match });
      const { pendingRequest } = await chrome.storage.session.get("pendingRequest");

      return {
        ok: true,
        url: tab.url,
        version: chrome.runtime.getManifest().version,
        settings,
        assistant: {
          chosen: settings.assistant,
          label: assistantConfig.label,
          tabsOpen: assistantTabs.length,
          tabUrls: assistantTabs.slice(0, 2).map((t) => (t.url || "").slice(0, 60)),
        },
        pending: pendingRequest
          ? {
              site: pendingRequest.site,
              round: pendingRequest.round,
              ageSeconds: Math.round((Date.now() - pendingRequest.startedAt) / 1000),
            }
          : null,
        frames: results.map((entry) => entry.result).filter(Boolean),
      };
    })()
      .then((result) => sendResponse(result))
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
