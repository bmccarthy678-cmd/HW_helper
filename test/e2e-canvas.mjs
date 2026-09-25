import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhc-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// Four questions on one page, Canvas-style: MC, multi-select, ordering dropdowns, diagram
const QUIZ = `<!DOCTYPE html><html><body style="margin:0">
<h1>Quiz</h1>
<div class="question_holder"><div class="display_question">
  <div class="question_text">What Eon of the Geologic Timescale do we currently live in?</div>
  <div><input type="radio" name="q1" id="q1a"><label for="q1a">Phanerozoic</label></div>
  <div><input type="radio" name="q1" id="q1b"><label for="q1b">Hadean</label></div>
  <div><input type="radio" name="q1" id="q1c"><label for="q1c">Archean</label></div>
</div></div>

<div class="question_holder"><div class="display_question">
  <div class="question_text">What did most scientists believe in the early 1900s? (select all that apply)</div>
  <div><input type="checkbox" id="q2a"><label for="q2a">Land bridges once existed between continents</label></div>
  <div><input type="checkbox" id="q2b"><label for="q2b">There was once a giant landmass called Pangea</label></div>
  <div><input type="checkbox" id="q2c"><label for="q2c">The continents did not move</label></div>
</div></div>

<div class="question_holder"><div class="display_question">
  <div class="question_text">Place the Eons in order from 1-OLDEST to 3-YOUNGEST.</div>
  <div>Hadean Eon <select id="s0"><option></option><option>1-OLDEST</option><option>2</option><option>3-YOUNGEST</option></select></div>
  <div>Archean Eon <select id="s1"><option></option><option>1-OLDEST</option><option>2</option><option>3-YOUNGEST</option></select></div>
  <div>Phanerozoic Eon <select id="s2"><option></option><option>1-OLDEST</option><option>2</option><option>3-YOUNGEST</option></select></div>
</div></div>

<div class="question_holder"><div class="display_question">
  <img width="300" height="200" alt="block diagram"
       src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='200'%3E%3Crect width='300' height='200' fill='%23ddd'/%3E%3C/svg%3E">
  <div class="question_text">Examine the above diagram. What type of unconformity is represented?</div>
  <div><input type="radio" name="q4" id="q4a"><label for="q4a">Nonconformity</label></div>
  <div><input type="radio" name="q4" id="q4b"><label for="q4b">Disconformity</label></div>
</div></div>

<button id="submitquiz">Submit Quiz</button><div id="submitted"></div>
<script>document.getElementById("submitquiz").addEventListener("click",()=>{
 document.getElementById("submitted").textContent="SUBMITTED";});</script>
</body></html>`;

const CHATGPT = `<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
window.__prompts=[];
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 const p=document.getElementById("prompt-textarea").innerText; window.__prompts.push(p);
 let a;
 if(/currently live in/.test(p)) a='"A"';
 else if(/early 1900s/.test(p)) a='["A","C"]';
 else a='["1-OLDEST","2","3-YOUNGEST"]';
 setTimeout(()=>{const d=document.createElement("div");
  d.setAttribute("data-message-author-role","assistant");
  d.textContent='{"answer": '+a+', "explanation": "ok"}';
  document.getElementById("thread").appendChild(d);
  document.getElementById("prompt-textarea").innerText="";},350);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(userDataDir,{channel:"chromium",headless:true,
 viewport:{width:1300,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://ohio.instructure.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:QUIZ}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:CHATGPT}));
let sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent("serviceworker",{timeout:15000}).catch(()=>null);
await sw.evaluate(()=>chrome.storage.sync.set({autoSelect:true}));

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const q=await ctx.newPage(); await q.goto("https://ohio.instructure.com/courses/1/quizzes/1/take");

const btn=q.locator("#hw-helper-trigger-canvas");
check("button injected on Canvas", await btn.waitFor({state:"visible",timeout:10000}).then(()=>true).catch(()=>false));
await btn.click({force:true});

const until=async(f,ms=150000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,500));}return false;};
check("run finished", await until(()=>q.locator("#hw-helper-status").textContent().then(t=>/Done\./.test(t||"")).catch(()=>
  q.locator("#hw-helper-status-canvas").textContent().then(t=>/Done\./.test(t||"")))),
  await q.locator("#hw-helper-status-canvas").textContent().catch(()=>""));

check("Q1 radio selected", await q.locator("#q1a").isChecked(), String(await q.locator("#q1a").isChecked()));
check("Q2 both checkboxes ticked",
  (await q.locator("#q2a").isChecked()) && (await q.locator("#q2c").isChecked()),
  `a=${await q.locator("#q2a").isChecked()} b=${await q.locator("#q2b").isChecked()} c=${await q.locator("#q2c").isChecked()}`);
check("Q2 distractor left alone", !(await q.locator("#q2b").isChecked()));
check("Q3 ordering dropdowns set",
  (await q.locator("#s0").inputValue())==="1-OLDEST" && (await q.locator("#s2").inputValue())==="3-YOUNGEST",
  [await q.locator("#s0").inputValue(),await q.locator("#s1").inputValue(),await q.locator("#s2").inputValue()].join("|"));
check("Q4 diagram question left unanswered",
  !(await q.locator("#q4a").isChecked()) && !(await q.locator("#q4b").isChecked()));
const chip = await q.locator("#hw-helper-status-canvas").textContent().catch(()=>"");
check("skip reported in the status", /Skipped 1 with diagrams: 4/.test(chip), chip);
check("quiz NOT submitted", (await q.locator("#submitted").textContent())!=="SUBMITTED");
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
