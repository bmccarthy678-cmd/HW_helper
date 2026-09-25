let hasResponded = false;
let messageCountAtQuestion = 0;
let observationTimeout = null;
let fallbackTimeout = null;
let observer = null;

const MESSAGE_SELECTOR = "[data-message-author-role='assistant']";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "receiveQuestion") {
    resetObservation();

    messageCountAtQuestion = document.querySelectorAll(MESSAGE_SELECTOR).length;
    hasResponded = false;

    insertQuestion(message.question, message.image)
      .then(() => sendResponse({ received: true, status: "processing" }))
      .catch((error) =>
        sendResponse({ received: false, error: error.message })
      );

    return true;
  }
});

function resetObservation() {
  hasResponded = false;
  if (observationTimeout) {
    clearTimeout(observationTimeout);
    observationTimeout = null;
  }
  if (fallbackTimeout) {
    clearTimeout(fallbackTimeout);
    fallbackTimeout = null;
  }
  if (observer) {
    observer.disconnect();
    observer = null;
  }
}

function findComposer() {
  return (
    document.querySelector("#prompt-textarea") ||
    document.querySelector("div[contenteditable='true']") ||
    document.querySelector("textarea")
  );
}

function findSendButton() {
  return (
    document.querySelector("[data-testid='send-button']") ||
    document.querySelector("button[aria-label*='Send']")
  );
}

function isStreaming() {
  return Boolean(
    document.querySelector("[data-testid='stop-button']") ||
      document.querySelector("button[aria-label*='Stop']")
  );
}

function waitForIdle(timeout = 120000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      if (!isStreaming()) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - startTime > timeout) {
        clearInterval(interval);
        reject(new Error("Timed out waiting for ChatGPT to finish responding"));
      }
    }, 500);
  });
}

function setComposerText(composer, text) {
  if (composer.tagName === "TEXTAREA") {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value"
    ).set;
    setter.call(composer, text);
    composer.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  composer.innerHTML = window.AutoMcGraw.toParagraphs(text);
  composer.dispatchEvent(new Event("input", { bubbles: true }));
}

function isDisabled(node) {
  return Boolean(
    node.disabled ||
      node.getAttribute("aria-disabled") === "true" ||
      node.getAttribute("data-disabled") === "true"
  );
}

function pressEnter(node) {
  const init = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true,
  };
  node.dispatchEvent(new KeyboardEvent("keydown", init));
  node.dispatchEvent(new KeyboardEvent("keyup", init));
}

async function attachImage(composer, dataUrl) {
  if (!dataUrl) return false;

  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], "question.png", { type: "image/png" });
    const transfer = new DataTransfer();
    transfer.items.add(file);

    composer.focus();
    composer.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: transfer,
      })
    );

    await new Promise((resolve) => setTimeout(resolve, 2500));
    return true;
  } catch (error) {
    console.error("Could not attach the diagram:", error);
    return false;
  }
}

async function insertQuestion(questionData, image) {
  const text = window.AutoMcGraw.buildPrompt(questionData);

  await waitForIdle();

  return new Promise((resolve, reject) => {
    const composer = findComposer();
    if (!composer) {
      reject(new Error("Input area not found"));
      return;
    }

    setTimeout(async () => {
      await attachImage(composer, image);
      composer.focus();
      setComposerText(composer, text);

      setTimeout(() => {
        const sendButton = findSendButton();
        if (sendButton && !isDisabled(sendButton)) {
          sendButton.click();
        } else {
          pressEnter(composer);
        }
        startObserving();
        resolve();
      }, 400);
    }, 300);
  });
}

function latestAssistantMessage() {
  const messages = document.querySelectorAll(MESSAGE_SELECTOR);
  if (!messages.length || messages.length <= messageCountAtQuestion) return null;
  return messages[messages.length - 1];
}

function extractResponseText(node) {
  const codeBlocks = node.querySelectorAll("pre code");
  for (const block of codeBlocks) {
    const text = block.textContent.trim();
    if (text.includes("{")) return text;
  }
  return node.textContent.trim();
}

function cleanup(text) {
  return text
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\n\s*/g, " ")
    .trim();
}

function extractJson(text) {
  const match = text.match(/\{[\s\S]*?"answer"[\s\S]*?"explanation"[\s\S]*?\}/);
  return match ? match[0] : null;
}

function send(response) {
  hasResponded = true;
  chrome.runtime
    .sendMessage({ type: "chatgptResponse", response })
    .catch((error) => console.error("Error sending response:", error));
  resetObservation();
}

function attemptFallback() {
  fallbackTimeout = null;
  if (hasResponded) return;

  const latest = latestAssistantMessage();
  if (!latest || isStreaming()) {
    fallbackTimeout = setTimeout(attemptFallback, 2000);
    return;
  }

  const extracted = extractJson(latest.textContent.trim());
  if (!extracted) {
    fallbackTimeout = setTimeout(attemptFallback, 2000);
    return;
  }

  send(extracted);
}

function startObserving() {
  observationTimeout = setTimeout(() => {
    if (hasResponded) return;
    resetObservation();
    chrome.runtime
      .sendMessage({ type: "assistantTimeout" })
      .catch((error) => console.error("Error reporting timeout:", error));
  }, 180000);

  fallbackTimeout = setTimeout(attemptFallback, 20000);

  observer = new MutationObserver(() => {
    if (hasResponded) return;

    const latest = latestAssistantMessage();
    if (!latest || isStreaming()) return;

    let responseText = cleanup(extractResponseText(latest));
    const braced = responseText.match(/\{[\s\S]*\}/);
    if (braced) responseText = braced[0];

    try {
      const parsed = JSON.parse(responseText);
      if (parsed.answer && !hasResponded) send(responseText);
    } catch (e) {
      return;
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}
