import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hwh4-"));
let failures = 0;
const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// confidence buttons start disabled and only enable once a choice is picked
const SMARTBOOK = `<!DOCTYPE html><html><body style="margin:0">
<button>Exit Assignment</button><div>0 of 39 Concepts completed</div>
<h2>Multiple Choice Question</h2>
<div class="sc-q">Most investments involve _______ cash flows.</div>
<div class="sc-a">
  <div><input type="radio" id="r0" name="a"><label for="r0">no</label></div>
  <div><input type="radio" id="r1" name="a"><label for="r1">multiple</label></div>
  <div><input type="radio" id="r2" name="a"><label for="r2">single</label></div>
  <div><input type="radio" id="r3" name="a"><label for="r3">lump sum</label></div>
</div>
<footer><span>Rate your confidence to submit your answer.</span>
<button id="hi" disabled>High</button><button id="me" disabled>Medium</button><button id="lo" disabled>Low</button></footer>
<div id="submitted"></div><div id="next-wrap"></div>
<script>
document.querySelectorAll("input[name=a]").forEach(r=>r.addEventListener("change",()=>{
  ["hi","me","lo"].forEach(id=>document.getElementById(id).disabled=false);}));
["hi","me","lo"].forEach(id=>document.getElementById(id).addEventListener("click",e=>{
  if(e.currentTarget.disabled) return;
  document.getElementById("submitted").textContent="submitted:"+e.currentTarget.textContent;
  const b=document.createElement("button"); b.id="nextq"; b.textContent="Next Question";
  b.addEventListener("click",()=>{document.getElementById("submitted").textContent+="|advanced";});
  document.getElementById("next-wrap").appendChild(b);}));
</script></body></html>`;

const CHATGPT = `<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{setTimeout(()=>{
 const d=document.createElement("div"); d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": "B", "explanation": "Most involve multiple flows."}';
 document.getElementById("thread").appendChild(d);},600);});
</script></body></html>`;

const ctx = await chromium.launchPersistentContext(userDataDir,{channel:"chromium",headless:true,
  viewport:{width:1400,height:1000},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://learning.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:SMARTBOOK}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:CHATGPT}));
let sw = ctx.serviceWorkers()[0] || await ctx.waitForEvent("serviceworker",{timeout:15000}).catch(()=>null);

// turn confidence on, the way the popup would
await sw.evaluate(() => chrome.storage.sync.set({ confidence: "high", advance: false }));

sw.on("console", m=>console.log("SW["+m.type()+"]:", m.text()));
const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const sb=await ctx.newPage(); await sb.goto("https://learning.mheducation.com/static/awd/index.html#/");

const btn=sb.locator("#hw-helper-trigger");
check("button injected", await btn.waitFor({state:"visible",timeout:10000}).then(()=>true).catch(()=>false));
check("confidence buttons start disabled", await sb.locator("#hi").isDisabled());
await btn.click({force:true});

const until=async(f,ms=30000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,400));}return false;};
check("correct choice selected", await until(()=>sb.locator("#r1").isChecked()));
check("High was clicked after selecting",
  await until(()=>sb.locator("#submitted").textContent().then(t=>t.startsWith("submitted:High"))),
  await sb.locator("#submitted").textContent());
check("chip reports the submission",
  await until(()=>sb.locator("#hw-helper-status").textContent().then(t=>/Submitted as high/.test(t||"")), 30000),
  await sb.locator("#hw-helper-status").textContent().catch(()=>""));
check("stayed put because advancing is off",
  !(await sb.locator("#submitted").textContent()).includes("|advanced"),
  await sb.locator("#submitted").textContent());
check("button back to single-shot state",
  await until(()=>sb.locator("#hw-helper-trigger").textContent().then(t=>t==="HW Helper"),10000),
  await sb.locator("#hw-helper-trigger").textContent());
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
