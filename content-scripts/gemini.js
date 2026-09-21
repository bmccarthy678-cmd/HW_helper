let hasResponded = false;
let messageCountAtQuestion = 0;
let observationStartTime = 0;
let observationTimeout = null;
let fallbackTimeout = null;
let observer = null;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "receiveQuestion") {
    resetObservation();

    const messages = document.querySelectorAll("model-response");
    messageCountAtQuestion = messages.length;
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

function waitForIdle(timeout = 120000) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const interval = setInterval(() => {
      const sendButton = document.querySelector(".send-button");
      if (!sendButton || !sendButton.classList.contains("stop")) {
        clearInterval(interval);
        resolve();
      } else if (Date.now() - startTime > timeout) {
        clearInterval(interval);
        reject(new Error("Timed out waiting for Gemini to finish responding"));
      }
    }, 500);
  });
}

async function insertQuestion(questionData) {
  const text = window.AutoMcGraw.buildPrompt(questionData);

  await waitForIdle();

  return new Promise((resolve, reject) => {
    const inputArea = document.querySelector(".ql-editor");
    if (!inputArea) {
      reject(new Error("Input area not found"));
      return;
    }

    setTimeout(() => {
      inputArea.focus();
      inputArea.innerHTML = window.AutoMcGraw.toParagraphs(text);
      inputArea.dispatchEvent(new Event("input", { bubbles: true }));

      setTimeout(() => {
        const sendButton = document.querySelector(".send-button");
        if (!sendButton) {
          reject(new Error("Send button not found"));
          return;
        }
        sendButton.click();
        startObserving();
        resolve();
      }, 300);
    }, 300);
  });
}

function extractJson(text) {
  const jsonPattern = /\{[\s\S]*?"answer"[\s\S]*?"explanation"[\s\S]*?\}/;
  const jsonMatch = text.match(jsonPattern);
  return jsonMatch ? jsonMatch[0] : null;
}

function attemptFallback() {
  fallbackTimeout = null;
  if (hasResponded) return;

  const messages = document.querySelectorAll("model-response");
  if (!messages.length || messages.length <= messageCountAtQuestion) {
    fallbackTimeout = setTimeout(attemptFallback, 2000);
    return;
  }

  const latestMessage = messages[messages.length - 1];
  const isGenerating =
    latestMessage.querySelector(".cursor") ||
    latestMessage.classList.contains("generating");

  if (isGenerating) {
    fallbackTimeout = setTimeout(attemptFallback, 2000);
    return;
  }

  const extracted = extractJson(latestMessage.textContent.trim());
  if (!extracted) {
    fallbackTimeout = setTimeout(attemptFallback, 2000);
    return;
  }

  hasResponded = true;
  chrome.runtime
    .sendMessage({ type: "geminiResponse", response: extracted })
    .catch((error) => console.error("Error sending response:", error));
  resetObservation();
}

function startObserving() {
  observationStartTime = Date.now();
  observationTimeout = setTimeout(() => {
    if (!hasResponded) resetObservation();
  }, 180000);

  fallbackTimeout = setTimeout(attemptFallback, 30000);

  observer = new MutationObserver(() => {
    if (hasResponded) return;

    const messages = document.querySelectorAll("model-response");
    if (!messages.length || messages.length <= messageCountAtQuestion) return;

    const latestMessage = messages[messages.length - 1];
    const codeBlocks = latestMessage.querySelectorAll("pre code");
    let responseText = "";

    for (const block of codeBlocks) {
      if (block.className.includes("hljs-") || block.closest(".code-block")) {
        responseText = block.textContent.trim();
        break;
      }
    }

    if (!responseText) {
      responseText = latestMessage.textContent.trim();
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) responseText = jsonMatch[0];
    }

    responseText = responseText
      .replace(/[​-‍﻿]/g, "")
      .replace(/\n\s*/g, " ")
      .trim();

    try {
      const parsed = JSON.parse(responseText);
      if (parsed.answer && !hasResponded) {
        hasResponded = true;
        chrome.runtime
          .sendMessage({ type: "geminiResponse", response: responseText })
          .then(() => resetObservation())
          .catch((error) => console.error("Error sending response:", error));
      }
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
