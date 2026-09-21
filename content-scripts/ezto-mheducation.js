const QUESTION_SELECTORS = [
  "[class*='questionText']",
  "[class*='question-text']",
  ".question-body",
  "[id^='question']",
  "[class*='stem']",
];

const CHOICE_CONTAINER_SELECTORS = [
  "[class*='answerChoice']",
  "[class*='answer-choice']",
  "tr[class*='choice']",
  ".choice-container",
  "label[class*='choice']",
];

const BUTTON_ID = "hw-helper-trigger-ezto";
const STATUS_ID = "hw-helper-status-ezto";

function normalize(value) {
  return String(value == null ? "" : value)
    .replace(/\s+/g, " ")
    .trim();
}

function allMatches(selectors) {
  for (const selector of selectors) {
    const nodes = Array.from(document.querySelectorAll(selector)).filter(
      (node) => normalize(node.textContent)
    );
    if (nodes.length) return nodes;
  }
  return [];
}

function firstMatch(selectors) {
  const nodes = allMatches(selectors);
  return nodes.length ? nodes[0] : null;
}

function detectQuestionType(choiceNodes) {
  if (!choiceNodes.length) return "fill-in-the-blank";

  if (choiceNodes.some((node) => node.querySelector("input[type='checkbox']"))) {
    return "multiple-select";
  }

  if (choiceNodes.some((node) => node.querySelector("select"))) {
    return "matching";
  }

  return "multiple-choice";
}

function scrapeQuestion() {
  const stem = firstMatch(QUESTION_SELECTORS);
  const choiceNodes = allMatches(CHOICE_CONTAINER_SELECTORS);

  if (!stem && !choiceNodes.length) {
    throw new Error("No question found on this page");
  }

  return {
    questionText: normalize(stem ? stem.textContent : document.title),
    choices: choiceNodes.map((node, index) => ({
      label: String.fromCharCode(65 + index),
      text: normalize(node.textContent),
    })),
    questionType: detectQuestionType(choiceNodes),
    source: "ezto",
  };
}

function robustClick(node) {
  const input = node.querySelector("input[type='radio'], input[type='checkbox']");
  let label = node.querySelector("label");
  if (!label && input && input.id) {
    label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
  }

  const target = label || input || node;
  const wasChecked = input ? input.checked : null;
  const options = { bubbles: true, cancelable: true, view: window };

  ["pointerdown", "mousedown", "pointerup", "mouseup", "click"].forEach((type) => {
    const Ctor = type.startsWith("pointer") ? PointerEvent : MouseEvent;
    try {
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
}

function selectChoices(answer) {
  const choiceNodes = allMatches(CHOICE_CONTAINER_SELECTORS);
  if (!choiceNodes.length) return 0;

  const wanted = (Array.isArray(answer) ? answer : [answer])
    .map((value) => normalize(value).toLowerCase())
    .filter(Boolean);

  let clicked = 0;

  choiceNodes.forEach((node, index) => {
    const label = String.fromCharCode(65 + index).toLowerCase();
    const text = normalize(node.textContent).toLowerCase();

    const matches = wanted.some(
      (value) =>
        value === label ||
        value === text ||
        (value.length > 3 && text.includes(value)) ||
        (text.length > 3 && value.includes(text))
    );

    if (matches) {
      robustClick(node);
      clicked += 1;
    }
  });

  return clicked;
}

function hasQuestion() {
  if (!document.body) return false;
  if (firstMatch(QUESTION_SELECTORS)) return true;
  return allMatches(CHOICE_CONTAINER_SELECTORS).length > 0;
}

function ensureUi() {
  if (!hasQuestion()) return;
  if (document.getElementById(BUTTON_ID)) return;

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.textContent = "Ask AI";
  Object.assign(button.style, {
    position: "fixed",
    right: "20px",
    bottom: "20px",
    zIndex: "2147483647",
    padding: "10px 16px",
    borderRadius: "8px",
    border: "none",
    background: "#1f5799",
    color: "#fff",
    font: "600 14px system-ui, sans-serif",
    cursor: "pointer",
    boxShadow: "0 2px 10px rgba(0,0,0,.25)",
  });

  const status = document.createElement("div");
  status.id = STATUS_ID;
  Object.assign(status.style, {
    position: "fixed",
    right: "20px",
    bottom: "60px",
    zIndex: "2147483647",
    maxWidth: "280px",
    padding: "8px 12px",
    borderRadius: "6px",
    background: "rgba(0,0,0,.82)",
    color: "#fff",
    font: "400 12px system-ui, sans-serif",
    display: "none",
  });

  button.addEventListener("click", askCurrentQuestion);

  document.body.appendChild(button);
  document.body.appendChild(status);
}

function setStatus(text, timeout = 6000) {
  const status = document.getElementById(STATUS_ID);
  if (!status) return;

  status.textContent = text;
  status.style.display = "block";

  if (timeout) {
    setTimeout(() => {
      status.style.display = "none";
    }, timeout);
  }
}

async function askCurrentQuestion() {
  try {
    const question = scrapeQuestion();
    setStatus("Sending question to the assistant...", 0);

    const result = await chrome.runtime.sendMessage({
      type: "askQuestion",
      question,
    });

    if (!result || !result.ok) {
      setStatus(`Failed: ${result ? result.error : "no response"}`);
      return;
    }

    setStatus(`Waiting on ${result.assistant}...`, 0);
  } catch (error) {
    setStatus(`Failed: ${error.message}`);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "applyAnswer") {
    if (!message.autoSelect) {
      setStatus(`Answer: ${JSON.stringify(message.answer)}`);
      return;
    }

    const clicked = selectChoices(message.answer);
    setStatus(
      clicked
        ? `Selected ${clicked} choice${clicked === 1 ? "" : "s"}. ${message.explanation}`
        : `Could not match a choice. Answer: ${JSON.stringify(message.answer)}`
    );
    return;
  }

  if (message.type === "answerFailed") {
    setStatus(`Assistant error: ${message.error}`);
  }
});

function boot() {
  if (!document.body) return;
  ensureUi();
  new MutationObserver(ensureUi).observe(document.body, {
    childList: true,
    subtree: true,
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
