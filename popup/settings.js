const DEFAULT_SETTINGS = {
  assistant: "chatgpt",
  autoSelect: true,
  focusAssistantTab: false,
  confidence: "off",
  advance: false,
};

const fields = {
  assistant: document.getElementById("assistant"),
  autoSelect: document.getElementById("autoSelect"),
  focusAssistantTab: document.getElementById("focusAssistantTab"),
  confidence: document.getElementById("confidence"),
  advance: document.getElementById("advance"),
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
  fields.autoSelect.checked = Boolean(settings.autoSelect);
  fields.focusAssistantTab.checked = Boolean(settings.focusAssistantTab);
  fields.confidence.value = settings.confidence;
  fields.advance.checked = Boolean(settings.advance);
}

function persist() {
  chrome.storage.sync
    .set({
      assistant: fields.assistant.value,
      autoSelect: fields.autoSelect.checked,
      focusAssistantTab: fields.focusAssistantTab.checked,
      confidence: fields.confidence.value,
      advance: fields.advance.checked,
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
