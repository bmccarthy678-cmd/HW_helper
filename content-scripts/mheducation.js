const BUTTON_ID = "hw-helper-trigger";
const STATUS_ID = "hw-helper-status";

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

async function ask() {
  setStatus("Reading the question...", 0);

  try {
    const result = await chrome.runtime.sendMessage({
      type: "askQuestion",
      site: "smartbook",
    });

    if (!result || !result.ok) {
      setStatus(`Failed: ${result ? result.error : "no response"}`);
      return;
    }

    setStatus(`Sent to ${result.assistant}. Waiting for a reply...`, 0);
  } catch (error) {
    setStatus(`Failed: ${error.message}`);
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "status") setStatus(message.text, message.timeout);
});

function shouldShowUi() {
  if (window.top === window.self) return true;
  return window.innerWidth >= 400 && window.innerHeight >= 300;
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

boot();
