import { chromium } from "playwright";
import os from "os";
import path from "path";
import fs from "fs";

const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hwh-"));
const log = (...a) => console.log(...a);
let failures = 0;
const check = (name, ok, extra = "") => {
  log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  -> " + extra : ""}`);
  if (!ok) failures += 1;
};

const SMARTBOOK = `<!DOCTYPE html><html><body style="height:900px">
<h1>Smartbook</h1>
<div data-automation-id="question-stem">Which statement is true when a &lt; b and b &lt; c?</div>
<div id="choices">
  <div data-automation-id="choice"><label for="c0">a &lt; c</label><input id="c0" type="radio" name="q"></div>
  <div data-automation-id="choice"><label for="c1">a &gt; c</label><input id="c1" type="radio" name="q"></div>
  <div data-automation-id="choice"><label for="c2">a = c</label><input id="c2" type="radio" name="q"></div>
</div></body></html>`;

const CHATGPT = `<!DOCTYPE html><html><body style="height:900px">
<div id="thread"></div>
<div id="prompt-textarea" contenteditable="true" style="border:1px solid #ccc;min-height:40px"></div>
<button data-testid="send-button">Send</button>
<script>
document.querySelector("[data-testid='send-button']").addEventListener("click", () => {
  const sent = document.getElementById("prompt-textarea").innerText;
  window.__lastPrompt = sent;
  setTimeout(() => {
    const d = document.createElement("div");
    d.setAttribute("data-message-author-role","assistant");
    d.textContent = '{"answer": "A", "explanation": "Inequality is transitive."}';
    document.getElementById("thread").appendChild(d);
  }, 700);
});
</script></body></html>`;

const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});

await ctx.route("https://learning.mheducation.com/**", (r) =>
  r.fulfill({ status: 200, contentType: "text/html", body: SMARTBOOK }));
await ctx.route("https://chatgpt.com/**", (r) =>
  r.fulfill({ status: 200, contentType: "text/html", body: CHATGPT }));

let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent("serviceworker", { timeout: 15000 }).catch(() => null);
check("service worker registered", Boolean(sw), sw ? sw.url().split("/").pop() : "none");

const swErrors = [];
if (sw) sw.on("console", (m) => { if (m.type() === "error") swErrors.push(m.text()); });

// assistant tab must exist for tabs.query to find it
const gpt = await ctx.newPage();
const gptErrors = [];
gpt.on("pageerror", (e) => gptErrors.push(String(e)));
await gpt.goto("https://chatgpt.com/");

const sb = await ctx.newPage();
const sbErrors = [];
sb.on("pageerror", (e) => sbErrors.push(String(e)));
await sb.goto("https://learning.mheducation.com/static/awd/index.html");

const button = sb.locator("#hw-helper-trigger");
const appeared = await button.waitFor({ state: "visible", timeout: 10000 }).then(() => true).catch(() => false);
check("Ask AI button injected", appeared);
check("no page errors in courseware script", sbErrors.length === 0, sbErrors.join("; "));

if (appeared) {
  await button.click();

  // the prompt should reach the mock ChatGPT composer
  const gotPrompt = await gpt.waitForFunction(
    () => document.getElementById("prompt-textarea").innerText.includes("Choices:"),
    null, { timeout: 15000 }).then(() => true).catch(() => false);
  check("prompt delivered to assistant composer", gotPrompt);

  if (gotPrompt) {
    const prompt = await gpt.evaluate(() => document.getElementById("prompt-textarea").innerText);
    check("prompt preserves '<' from the question", prompt.includes("a < b"),
      prompt.split("\n").find((l) => l.startsWith("Question:")) || "");
    check("prompt lists labelled choices", /A\. a < c/.test(prompt));

    const selected = await sb.waitForFunction(
      () => document.getElementById("c0") && document.getElementById("c0").checked,
      null, { timeout: 20000 }).then(() => true).catch(() => false);
    check("correct choice auto-selected", selected);

    const others = await sb.evaluate(() => [1,2].map(i => document.getElementById("c"+i).checked));
    check("no other choice selected", others.every((c) => !c), JSON.stringify(others));

    const chip = await sb.evaluate(() => {
      const n = document.getElementById("hw-helper-status");
      return n ? n.textContent : "";
    });
    check("status chip reports the selection", /Selected 1 choice/.test(chip), chip);
  }
}

check("no assistant-adapter page errors", gptErrors.length === 0, gptErrors.join("; "));
check("no service worker errors", swErrors.length === 0, swErrors.join("; "));

await ctx.close();
log(`\n${failures === 0 ? "ALL CHECKS PASSED" : failures + " CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
