const BUTTON_ID = "hw-helper-trigger-ezto";
const STATUS_ID = "hw-helper-status-ezto";
const REPLY_TIMEOUT_MS = 195000;
const MAX_QUESTIONS = 100;
const FAILURE_LIMIT = 2;
const CYCLE_GAP_MS = 1400;

let inFlight = false;
let watchdog = null;
let running = false;
let answered = 0;
let cycleResolve = null;

function ensureUi() {
  if (!document.body || document.getElementById(BUTTON_ID)) return;

  const button = document.createElement("button");
  button.id = BUTTON_ID;
  button.type = "button";
  button.textContent = "HW Helper";
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

  button.addEventListener("click", onClick);

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

function paintButton() {
  const button = document.getElementById(BUTTON_ID);
  if (!button) return;

  button.textContent = running ? "Stop" : "HW Helper";
  button.style.background = running ? "#b3261e" : "#1f5799";
  button.disabled = inFlight && !running;
  button.style.opacity = button.disabled ? "0.6" : "1";
  button.style.cursor = button.disabled ? "default" : "pointer";
}

function setBusy(busy) {
  inFlight = busy;
  paintButton();
}

function clearWatchdog() {
  if (!watchdog) return;
  clearTimeout(watchdog);
  watchdog = null;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function awaitCycle() {
  return new Promise((resolve) => {
    cycleResolve = resolve;
  });
}

function stopRun(text) {
  running = false;
  inFlight = false;
  cycleResolve = null;
  clearWatchdog();
  paintButton();
  if (text) setStatus(text, 15000);
}

async function onClick() {
  if (running) {
    stopRun(`Stopped after ${answered} question${answered === 1 ? "" : "s"}.`);
    return;
  }

  const settings = await chrome.storage.sync.get({
    confidence: "off",
    advance: false,
    autoSelect: true,
  });

  const canRun =
    settings.autoSelect && settings.confidence !== "off" && settings.advance;

  if (!canRun) {
    await askOnce();
    return;
  }

  answered = 0;
  running = true;
  paintButton();
  runLoop();
}

async function askOnce() {
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

    if (result.done) {
      setBusy(false);
      setStatus(result.status);
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

async function runLoop() {
  let failures = 0;

  while (running && answered < MAX_QUESTIONS) {
    setStatus(`Working on question ${answered + 1}...`, 0);

    const cycle = awaitCycle();
    let result;

    try {
      result = await chrome.runtime.sendMessage({
        type: "askQuestion",
        site: "ezto",
      });
    } catch (error) {
      stopRun(`Stopped: ${error.message}`);
      return;
    }

    if (!running) return;

    if (!result || !result.ok) {
      const reason = result ? result.error : "no response";

      if (/no question found/i.test(reason)) {
        stopRun(`Finished. ${answered} question${answered === 1 ? "" : "s"} answered.`);
        return;
      }

      failures += 1;
      if (failures >= FAILURE_LIMIT) {
        stopRun(`Stopped after ${answered} answered. ${reason}`);
        return;
      }

      await delay(CYCLE_GAP_MS);
      continue;
    }

    if (result.done) {
      await delay(CYCLE_GAP_MS);
      continue;
    }

    const status = await Promise.race([cycle, delay(REPLY_TIMEOUT_MS).then(() => null)]);
    if (!running) return;

    if (!status || status.outcome !== "selected") {
      failures += 1;
      const reason = status ? status.text : "no reply in time";

      if (failures >= FAILURE_LIMIT) {
        stopRun(`Stopped after ${answered} answered. ${reason}`);
        return;
      }

      await delay(CYCLE_GAP_MS);
      continue;
    }

    failures = 0;
    answered += 1;

    if (!status.advanced) {
      stopRun(`Stopped after ${answered}: could not press Next Question.`);
      return;
    }

    await delay(CYCLE_GAP_MS);
  }

  if (running) stopRun(`Stopped at the ${MAX_QUESTIONS} question safety limit.`);
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "status") return;

  if (message.outcome === "checking") {
    setStatus(message.text, 0);
    return;
  }

  clearWatchdog();

  if (!running) setBusy(false);
  setStatus(message.text, running ? 0 : message.timeout);

  if (cycleResolve) {
    const resolve = cycleResolve;
    cycleResolve = null;
    resolve(message);
  }
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
