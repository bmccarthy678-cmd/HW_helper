// Only the two genuine choices are settings. Everything else has one sensible
// answer, so it is fixed here rather than asked about.
const AUTOMATIC = {
  autoSelect: true,
  advance: true,
  confidence: "high",
  checkWork: true,
  images: true,
  focusAssistantTab: false,
};

const DEFAULT_SETTINGS = {
  assistant: "chatgpt",
  verify: false,
  ...AUTOMATIC,
};

const fields = {
  assistant: document.getElementById("assistant"),
  verify: document.getElementById("verify"),
};

const savedNote = document.getElementById("saved");
const updateButton = document.getElementById("checkUpdate");
const updateStatus = document.getElementById("updateStatus");
let savedTimer = null;

function showSaved() {
  savedNote.hidden = false;
  if (savedTimer) clearTimeout(savedTimer);
  savedTimer = setTimeout(() => {
    savedNote.hidden = true;
  }, 1200);
}

async function load() {
  document.getElementById("version").textContent =
    `v${chrome.runtime.getManifest().version}`;

  const stored = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  const settings = Object.assign({}, DEFAULT_SETTINGS, stored);

  fields.assistant.value = settings.assistant;
  fields.verify.checked = Boolean(settings.verify);

  // An older install may have these stored as whatever its checkboxes were left
  // at. The boxes are gone, so write the automatic values back over them.
  const stale = Object.keys(AUTOMATIC).filter(
    (key) => stored[key] !== AUTOMATIC[key]
  );
  if (stale.length) chrome.storage.sync.set(AUTOMATIC).catch(() => {});
}

function persist() {
  chrome.storage.sync
    .set({
      assistant: fields.assistant.value,
      verify: fields.verify.checked,
      ...AUTOMATIC,
    })
    .then(showSaved)
    .catch((error) => console.error("Could not save settings:", error));
}

Object.values(fields).forEach((field) =>
  field.addEventListener("change", persist)
);

updateButton.addEventListener("click", async () => {
  updateButton.disabled = true;
  updateStatus.textContent = "Checking...";

  try {
    const result = await chrome.runtime.sendMessage({ type: "checkForUpdate" });

    if (!result || !result.ok) {
      updateStatus.textContent = `Check failed: ${result ? result.error : "no response"}`;
    } else if (result.updateAvailable) {
      updateStatus.textContent = `v${result.latest} is available (you have v${result.current}).`;
    } else {
      updateStatus.textContent = `You are on the latest version (v${result.current}).`;
    }
  } catch (error) {
    updateStatus.textContent = `Check failed: ${error.message}`;
  } finally {
    updateButton.disabled = false;
  }
});

load();

const notesSummary = document.getElementById("notesSummary");
const downloadButton = document.getElementById("downloadNotes");
const clearButton = document.getElementById("clearNotes");

async function readNotes() {
  const { notes = [] } = await chrome.storage.local.get("notes");
  return notes;
}

function describe(notes) {
  if (!notes.length) return "No questions recorded yet.";

  const graded = notes.filter((n) => n.verdict);
  const right = graded.filter((n) => n.verdict === "correct").length;

  if (!graded.length) {
    return `${notes.length} question${notes.length === 1 ? "" : "s"} recorded.`;
  }

  const pct = Math.round((right / graded.length) * 100);
  return `${notes.length} recorded, ${right} of ${graded.length} graded correct (${pct}%).`;
}

async function refreshNotes() {
  const notes = await readNotes();
  notesSummary.textContent = describe(notes);
  downloadButton.disabled = notes.length === 0;
  clearButton.disabled = notes.length === 0;
}

function toMarkdown(notes) {
  const graded = notes.filter((n) => n.verdict);
  const right = graded.filter((n) => n.verdict === "correct").length;

  const lines = ["# HW Helper notes", ""];
  lines.push(`Exported ${new Date().toLocaleString()}`);
  lines.push(`${notes.length} question${notes.length === 1 ? "" : "s"} recorded.`);
  if (graded.length) {
    lines.push(`Graded: ${right} of ${graded.length} correct.`);
  }
  lines.push("");

  notes.forEach((note, index) => {
    const answer = Array.isArray(note.answer) ? note.answer.join(", ") : String(note.answer);
    lines.push(`## ${index + 1}. ${note.question || "(question text not captured)"}`);
    lines.push("");

    (note.choices || []).forEach((choice) => {
      const picked = answer.split(", ").includes(choice.label) ? " **<- chosen**" : "";
      lines.push(`- ${choice.label}. ${choice.text}${picked}`);
    });

    lines.push("");
    lines.push(`**Answer:** ${answer}`);
    if (note.explanation) lines.push(`**Why:** ${note.explanation}`);
    if (note.verdict) lines.push(`**Marked:** ${note.verdict}`);
    if (note.correctAnswer) lines.push(`**Correct answer:** ${note.correctAnswer}`);
    lines.push("");
  });

  return lines.join("\n");
}

downloadButton.addEventListener("click", async () => {
  const notes = await readNotes();
  if (!notes.length) return;

  const blob = new Blob([toMarkdown(notes)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const stamp = new Date().toISOString().slice(0, 10);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `hw-helper-notes-${stamp}.md`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

clearButton.addEventListener("click", async () => {
  await chrome.storage.local.remove("notes");
  await refreshNotes();
});

refreshNotes();

const diagnoseButton = document.getElementById("diagnose");
const diagnoseOut = document.getElementById("diagnoseOut");

diagnoseButton.addEventListener("click", async () => {
  diagnoseButton.disabled = true;
  diagnoseOut.textContent = "Reading the page...";

  try {
    const report = await chrome.runtime.sendMessage({ type: "diagnose" });

    if (!report || !report.ok) {
      diagnoseOut.textContent = `Failed: ${report ? report.error : "no response"}`;
      return;
    }

    const text = JSON.stringify(report, null, 2);
    await navigator.clipboard.writeText(text);

    const withFields = report.frames.filter((f) => f.visibleFieldCount > 0 || f.choiceCount > 0);
    diagnoseOut.textContent =
      `Copied. ${report.frames.length} frame(s); ` +
      `${withFields.length} with answers; ` +
      `${withFields.reduce((n, f) => n + f.visibleFieldCount, 0)} boxes, ` +
      `${withFields.reduce((n, f) => n + f.choiceCount, 0)} choices.`;
  } catch (error) {
    diagnoseOut.textContent = `Failed: ${error.message}`;
  } finally {
    diagnoseButton.disabled = false;
  }
});
