const BUTTON_ID = "hw-helper-trigger-canvas";
const STATUS_ID = "hw-helper-status-canvas";
const REPLY_TIMEOUT_MS = 195000;
const MAX_QUESTIONS = 100;
const FAILURE_LIMIT = 2;
const CYCLE_GAP_MS = 1400;
const HANDSHAKE_MS = 45000;

let inFlight = false;
let watchdog = null;
let running = false;
let answered = 0;
let blockIndex = 0;
let skipped = [];
let confirmed = 0;
let cycleResolve = null;
let lastActivity = 0;

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

  const busy = running || inFlight;

  button.textContent = busy ? "Stop" : "HW Helper";
  button.style.background = busy ? "#b3261e" : "#1f5799";
  button.disabled = false;
  button.style.opacity = "1";
  button.style.cursor = "pointer";
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

function armWatchdog() {
  clearWatchdog();
  watchdog = setTimeout(() => {
    watchdog = null;

    if (Date.now() - lastActivity < REPLY_TIMEOUT_MS - 500) {
      armWatchdog();
      return;
    }

    if (!inFlight && !running) return;

    running = false;
    inFlight = false;
    cycleResolve = null;
    chrome.runtime.sendMessage({ type: "cancel" }).catch(() => {});
    paintButton();
    setStatus("No reply in time. Press HW Helper to try again.");
  }, REPLY_TIMEOUT_MS);
}

function idleTimeout() {
  return new Promise((resolve) => {
    const tick = () => {
      if (Date.now() - lastActivity >= REPLY_TIMEOUT_MS) {
        resolve(null);
        return;
      }
      setTimeout(tick, 1000);
    };
    setTimeout(tick, 1000);
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function awaitCycle() {
  return new Promise((resolve) => {
    cycleResolve = resolve;
  });
}

function cancelEverything(text) {
  running = false;
  inFlight = false;
  cycleResolve = null;
  clearWatchdog();

  chrome.runtime
    .sendMessage({ type: "cancel" })
    .catch(() => {});

  paintButton();
  if (text) setStatus(text, 8000);
}

function stopRun(text) {
  running = false;
  inFlight = false;
  cycleResolve = null;
  clearWatchdog();
  paintButton();
  if (text) setStatus(text, 15000);
}

// After the extension is reinstalled or updated, the content script already
// running in an open tab is orphaned: chrome.runtime.id goes undefined and
// chrome.storage disappears entirely, so the failure arrives as a TypeError
// rather than the documented "Extension context invalidated" message. Ask the
// runtime directly instead of matching on the text.
function contextAlive() {
  try {
    return Boolean(chrome && chrome.runtime && chrome.runtime.id && chrome.storage);
  } catch (error) {
    return false;
  }
}

function staleContext(error) {
  if (!contextAlive()) return true;
  const message = String((error && error.message) || error || "");
  return /Extension context invalidated|message port closed|receiving end does not exist/i.test(
    message
  );
}

function reportStale() {
  inFlight = false;
  running = false;
  cycleResolve = null;
  clearWatchdog();
  paintButton();
  setStatus("The extension was updated. Reload this page, then try again.", 0);
}

async function onClick() {
  if (!contextAlive()) {
    reportStale();
    return;
  }

  try {
    await handleClick();
  } catch (error) {
    if (staleContext(error)) {
      reportStale();
      return;
    }
    setBusy(false);
    running = false;
    paintButton();
    setStatus(`Failed: ${error.message}`);
  }
}

async function handleClick() {
  if (inFlight && !running) {
    cancelEverything("Stopped. Press again to retry.");
    return;
  }

  if (running) {
    cancelEverything(
      `Stopped after ${answered} question${answered === 1 ? "" : "s"}. Press again to restart.`
    );
    return;
  }

  const settings = await chrome.storage.sync.get({ autoSelect: true });

  if (!settings.autoSelect) {
    await askOnce();
    return;
  }

  answered = 0;
  blockIndex = 0;
  skipped = [];
  confirmed = 0;
  running = true;
  paintButton();
  runLoop();
}

async function askOnce() {
  if (inFlight) return;

  setBusy(true);
  lastActivity = Date.now();
  armWatchdog();
  setStatus("Reading the question...", 0);

  try {
    const result = await Promise.race([
      chrome.runtime.sendMessage({
        type: "askQuestion",
        site: "canvas",
        blockIndex,
      }),
      delay(HANDSHAKE_MS).then(() => null),
    ]);

    if (!result) {
      cancelEverything("The extension did not respond. Press HW Helper to try again.");
      return;
    }

    if (!result.ok) {
      setBusy(false);
      setStatus(`Failed: ${result ? result.error : "no response"}`);
      return;
    }

    if (result.done) {
      setBusy(false);
      setStatus(result.status);
      return;
    }

    setStatus(`Sent to ${result.assistant || "the assistant"}. Waiting for a reply...`, 0);

    lastActivity = Date.now();
    armWatchdog();
  } catch (error) {
    setBusy(false);
    setStatus(`Failed: ${error.message}`);
  }
}

async function runLoop() {
  let failures = 0;

  while (running && blockIndex < MAX_QUESTIONS) {
    setStatus(`Question ${blockIndex + 1}...`, 0);
    scrollToQuestion(blockIndex);

    lastActivity = Date.now();
    armWatchdog();
    const cycle = awaitCycle();
    let result;

    // askOnce has always raced the worker against a deadline; the run loop did
    // not, so a worker that never answered left the button red on "Working on
    // question 1" until the three-minute watchdog. The run loop is now the
    // default path, so give it the same deadline.
    try {
      result = await Promise.race([
        chrome.runtime.sendMessage({
          type: "askQuestion",
          site: "canvas",
          blockIndex,
        }),
        delay(HANDSHAKE_MS).then(() => ({ hung: true })),
      ]);
    } catch (error) {
      if (staleContext(error)) {
        reportStale();
        return;
      }
      stopRun(`Stopped: ${error.message}`);
      return;
    }

    if (result && result.hung) {
      cancelEverything("The extension did not respond. Press HW Helper to try again.");
      return;
    }

    if (!running) return;

    if (result && result.done) {
      finish();
      return;
    }

    if (result && result.skipped) {
      skipped.push(result.index + 1);
      setStatus(result.status, 4000);
      blockIndex += 1;
      cycleResolve = null;
      await delay(600);
      continue;
    }

    if (!result || !result.ok) {
      const reason = result ? result.error : "no response";

      if (/no question found/i.test(reason)) {
        finish();
        return;
      }

      failures += 1;
      cycleResolve = null;

      if (failures >= FAILURE_LIMIT) {
        stopRun(`Stopped at question ${blockIndex + 1}. ${reason}`);
        return;
      }

      blockIndex += 1;
      await delay(CYCLE_GAP_MS);
      continue;
    }

    const status = await Promise.race([cycle, idleTimeout()]);
    if (!running) return;

    if (!status || status.outcome !== "selected") {
      failures += 1;
      const reason = status ? status.text : "no reply in time";

      if (failures >= FAILURE_LIMIT) {
        stopRun(`Stopped at question ${blockIndex + 1}. ${reason}`);
        return;
      }

      blockIndex += 1;
      await delay(CYCLE_GAP_MS);
      continue;
    }

    failures = 0;
    answered += 1;
    if (status.verified) confirmed += 1;
    blockIndex += 1;
    await delay(CYCLE_GAP_MS);
  }

  if (running) finish();
}

function finish() {
  const checked =
    confirmed && confirmed === answered
      ? " Each confirmed twice."
      : confirmed
        ? ` ${confirmed} confirmed twice.`
        : "";
  const note = skipped.length
    ? ` Skipped ${skipped.length} with diagrams: ${skipped.join(", ")}.`
    : "";
  stopRun(
    `Done. Answered ${answered} question${answered === 1 ? "" : "s"}.${checked}${note} Review, then submit yourself.`
  );
}

function scrollToQuestion(index) {
  const blocks = document.querySelectorAll(
    ".question_holder, .display_question, [id^='question_']"
  );
  const target = blocks[index];
  if (target && target.scrollIntoView) {
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (message.type !== "status") return;

  if (!running && !inFlight) return;

  if (message.outcome === "checking") {
    lastActivity = Date.now();
    armWatchdog();
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
