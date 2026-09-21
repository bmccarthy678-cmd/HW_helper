import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hwh2-"));
let failures = 0;
const check = (n, ok, extra="") => { console.log(`${ok?"PASS":"FAIL"}  ${n}${extra?"  -> "+extra:""}`); if(!ok) failures++; };

// top page does NOT match the content script pattern; the player frame does
const HOST = `<!DOCTYPE html><html><body style="margin:0">
<h1>Connect</h1>
<iframe src="https://learning.mheducation.com/static/awd/index.html"
        style="width:1000px;height:700px;border:0"></iframe></body></html>`;
const PLAYER = `<!DOCTYPE html><html><body style="height:650px">
<div data-automation-id="question-stem">Nested question: pick the second option</div>
<div data-automation-id="choice"><label for="c0">wrong</label><input id="c0" type="radio" name="q"></div>
<div data-automation-id="choice"><label for="c1">right</label><input id="c1" type="radio" name="q"></div>
</body></html>`;
const CHATGPT = `<!DOCTYPE html><html><body style="height:900px"><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{setTimeout(()=>{
 const d=document.createElement("div"); d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": "B", "explanation": "Second option."}';
 document.getElementById("thread").appendChild(d);},600);});
</script></body></html>`;

const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium", headless: true, viewport: {width: 1400, height: 1100},
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await ctx.route("https://connect.mheducation.com/**", r => r.fulfill({status:200,contentType:"text/html",body:HOST}));
await ctx.route("https://learning.mheducation.com/**", r => r.fulfill({status:200,contentType:"text/html",body:PLAYER}));
await ctx.route("https://chatgpt.com/**", r => r.fulfill({status:200,contentType:"text/html",body:CHATGPT}));
if (!ctx.serviceWorkers()[0]) await ctx.waitForEvent("serviceworker",{timeout:15000}).catch(()=>null);

const gpt = await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const page = await ctx.newPage();
await page.goto("https://connect.mheducation.com/course");

const frame = page.frameLocator("iframe");
const btn = frame.locator("#hw-helper-trigger");
const appeared = await btn.waitFor({state:"visible",timeout:12000}).then(()=>true).catch(()=>false);
check("button appears inside the nested player frame", appeared);

const topButtons = await page.evaluate(() => document.querySelectorAll("#hw-helper-trigger").length);
check("top document has no duplicate button", topButtons === 0, String(topButtons));

if (appeared) {
  await btn.click({ force: true });
  const until = async (fn, ms = 25000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      if (await fn().catch(() => false)) return true;
      await new Promise((r) => setTimeout(r, 400));
    }
    return false;
  };

  const picked = await until(() => frame.locator("#c1").isChecked());
  const wrongOne = await frame.locator("#c0").isChecked().catch(() => true);
  check("answer applied back into the nested frame", picked);
  check("the other choice left alone", wrongOne === false);

  const chip = await frame.locator("#hw-helper-status").textContent().catch(()=>"(no chip)");
  console.log("CHIP:", chip);
  const composer = await gpt.evaluate(()=>document.getElementById("prompt-textarea").innerText).catch(()=>"(none)");
  console.log("COMPOSER GOT:", JSON.stringify(composer.slice(0,120)));
  const replies = await gpt.evaluate(()=>document.querySelectorAll("[data-message-author-role='assistant']").length);
  console.log("ASSISTANT REPLIES:", replies);
}
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
