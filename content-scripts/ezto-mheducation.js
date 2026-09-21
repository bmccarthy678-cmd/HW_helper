const BUTTON_ID = "hw-helper-trigger-ezto";
const STATUS_ID = "hw-helper-status-ezto";
const REPLY_TIMEOUT_MS = 195000;

let inFlight = false;
let watchdog = null;

function ensureUi() {
  if (!document.body || document.getElementById(BUTTON_ID)) return;

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
    maxWidth: "300px",
    padding: "8px 12px",
    borderRadius: "6px",
    background: "rgba(0,0,0,.85)",
    color: "#fff",
    font: "400 12px system-ui, sans-serif",
    display: "none",
  });

  button.addEventListener("click", ask);

  document.body.appendChild(button);
  document.body.appendChild(status);
}

function setStatus(text, timeout = 8000) {
  const status = document.getElementById(STATUS_ID);
  if (!status) return;

  status.textContent = text;
  status.style.display = "block";

  if (status.hideTimer) clearTimeout(status.hideTimer);
  if (timeout) {
    status.hideTimer = setTimeout(() => {
      status.style.display = "none";
    }, timeout);
  }
}

function setBusy(busy) {
  inFlight = busy;

  const button = document.getElementById(BUTTON_ID);
  if (!button) return;

  button.disabled = busy;
  button.style.opacity = busy ? "0.6" : "1";
  button.style.cursor = busy ? "default" : "pointer";
}

function clearWatchdog() {
  if (!watchdog) return;
  clearTimeout(watchdog);
  watchdog = null;
}

async function ask() {
  if (inFlight) return;

  setBusy(true);
  setStatus("Reading the question...", 0);

  try {
    const result = await chrome.runtime.sendMessage({
      type: "askQuestion",
      site: "ezto",
    });

    if (!result || !result.ok) {
      setBusy(false);
      setStatus(`Failed: ${result ? result.error : "no response"}`);
      return;
    }

    setStatus(`Sent to ${result.assistant}. Waiting for a reply...`, 0);

    clearWatchdog();
    watchdog = setTimeout(() => {
      watchdog = null;
      if (!inFlight) return;
      setBusy(false);
      setStatus("No reply in time. Check the assistant tab, then try again.");
    }, REPLY_TIMEOUT_MS);
  } catch (error) {
    setBusy(false);
    setStatus(`Failed: ${error.message}`);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "status") return;
  clearWatchdog();
  setBusy(false);
  setStatus(message.text, message.timeout);
});

function shouldShowUi() {
  if (window.top === window.self) return true;
  if (window.innerWidth < 400 || window.innerHeight < 300) return false;

  try {
    return !window.top.document.getElementById(BUTTON_ID);
  } catch (error) {
    return true;
  }
}

function bootDelay() {
  return window.top === window.self ? 0 : 600;
}

function boot() {
  if (!shouldShowUi()) return;

  const observer = new MutationObserver(ensureUi);
  const start = () => {
    ensureUi();
    observer.observe(document.body, { childList: true, subtree: true });
  };

  if (document.body) {
    start();
  } else {
    document.addEventListener("DOMContentLoaded", start);
  }
}

setTimeout(boot, bootDelay());
