let hasResponded = false;
let messageCountAtQuestion = 0;
let observationTimeout = null;
let fallbackTimeout = null;
let observer = null;

const MESSAGE_SELECTOR = ".ds-markdown, [class*='ds-markdown']";

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "receiveQuestion") {
    resetObservation();

    messageCountAtQuestion = document.querySelectorAll(MESSAGE_SELECTOR).length;
    hasResponded = false;

    insertQuestion(message.question)
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
    document.querySelector("#chat-input") ||
    document.querySelector("textarea") ||
    document.querySelector("div[contenteditable='true']")
  );
}

function findSendButton() {
  return (
    document.querySelector("[role='button'][aria-disabled='false']") ||
    document.querySelector("div[class*='send'], button[class*='send']")
  );
}

function isStreaming() {
  return Boolean(
    document.querySelector("[class*='stop']") ||
      document.querySelector("[aria-label*='Stop']")
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
        reject(new Error("Timed out waiting for DeepSeek to finish responding"));
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

function pressEnter(composer) {
  const init = {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    bubbles: true,
  };
  composer.dispatchEvent(new KeyboardEvent("keydown", init));
  composer.dispatchEvent(new KeyboardEvent("keyup", init));
}

async function insertQuestion(questionData) {
  const text = window.AutoMcGraw.buildPrompt(questionData);

  await waitForIdle();

  return new Promise((resolve, reject) => {
    const composer = findComposer();
    if (!composer) {
      reject(new Error("Input area not found"));
      return;
    }

    setTimeout(() => {
      composer.focus();
      setComposerText(composer, text);

      setTimeout(() => {
        const sendButton = findSendButton();
        if (sendButton) {
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

function latestMessage() {
  const messages = document.querySelectorAll(MESSAGE_SELECTOR);
  if (!messages.length || messages.length <= messageCountAtQuestion) return null;
  return messages[messages.length - 1];
}

function cleanup(text) {
  return text
    .replace(/[​-‍﻿]/g, "")
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
    .sendMessage({ type: "deepseekResponse", response })
    .catch((error) => console.error("Error sending response:", error));
  resetObservation();
}

function attemptFallback() {
  fallbackTimeout = null;
  if (hasResponded) return;

  const latest = latestMessage();
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
    if (!hasResponded) resetObservation();
  }, 180000);

  fallbackTimeout = setTimeout(attemptFallback, 20000);

  observer = new MutationObserver(() => {
    if (hasResponded) return;

    const latest = latestMessage();
    if (!latest || isStreaming()) return;

    const codeBlock = latest.querySelector("pre code");
    let responseText = cleanup(
      codeBlock ? codeBlock.textContent : latest.textContent
    );

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
