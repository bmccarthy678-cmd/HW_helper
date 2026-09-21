import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hwh6-"));
let failures = 0;
const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// A 4-question assignment that behaves like Smartbook: pick -> confidence -> result -> next
const SMARTBOOK = `<!DOCTYPE html><html><body style="margin:0">
<button>Exit Assignment</button><div id="hdr">0 of 4 Concepts completed</div>
<div id="app"></div>
<script>
const QS=[["Q1 alpha or beta?",["alpha","beta"],1],["Q2 one or two?",["one","two"],0],
          ["Q3 up or down?",["up","down"],1],["Q4 left or right?",["left","right"],0]];
let i=0, done=0;
window.__answers=[];
function render(){
 const q=QS[i]; const a=document.getElementById("app");
 a.innerHTML='<h2>Multiple Choice Question</h2><div class="sc-q">'+q[0]+'</div>'+
  q[1].map((t,n)=>'<div><input type="radio" id="o'+n+'" name="a"><label for="o'+n+'">'+t+'</label></div>').join('')+
  '<footer><span>Rate your confidence to submit your answer.</span>'+
  '<button id="hi" disabled>High</button><button id="me" disabled>Medium</button><button id="lo" disabled>Low</button></footer>';
 a.querySelectorAll("input[name=a]").forEach(r=>r.addEventListener("change",()=>{
   ["hi","me","lo"].forEach(id=>document.getElementById(id).disabled=false);}));
 ["hi","me","lo"].forEach(id=>document.getElementById(id).addEventListener("click",()=>{
   const sel=[...a.querySelectorAll("input[name=a]")].findIndex(r=>r.checked);
   window.__answers.push(QS[i][1][sel]);
   done++; document.getElementById("hdr").textContent=done+" of 4 Concepts completed";
   a.innerHTML='<h3>Your Answer correct</h3><button id="nextq">Next Question</button>';
   document.getElementById("nextq").addEventListener("click",()=>{
     i++; if(i<QS.length){render();} else {a.innerHTML='<h3>Assignment complete</h3>';}});}));
}
render();
</script></body></html>`;

// assistant always answers "B" for q1/q3 and "A" for q2/q4 via simple round-robin on prompt text
const CHATGPT = `<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 const p=document.getElementById("prompt-textarea").innerText;
 const ans = /alpha|up/.test(p) ? "B" : "A";
 setTimeout(()=>{const d=document.createElement("div");
  d.setAttribute("data-message-author-role","assistant");
  d.textContent='{"answer": "'+ans+'", "explanation": "ok"}';
  document.getElementById("thread").appendChild(d);
  document.getElementById("prompt-textarea").innerText="";},2500);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(userDataDir,{channel:"chromium",headless:true,
 viewport:{width:1400,height:1000},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://learning.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:SMARTBOOK}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:CHATGPT}));
let sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent("serviceworker",{timeout:15000}).catch(()=>null);
await sw.evaluate(()=>chrome.storage.sync.set({confidence:"high",advance:true,autoSelect:true}));

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const sb=await ctx.newPage(); await sb.goto("https://learning.mheducation.com/static/awd/index.html#/");

const btn=sb.locator("#hw-helper-trigger");
check("button injected", await btn.waitFor({state:"visible",timeout:10000}).then(()=>true).catch(()=>false));
await btn.click({force:true});
check("button switches to Stop while running",
  await sb.locator("#hw-helper-trigger").textContent().then(t=>t==="Stop").catch(()=>false),
  await btn.textContent());

const until=async(f,ms=120000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,400));}return false;};

// let it get partway, then hit Stop
await until(()=>sb.evaluate(()=>document.getElementById("hdr").textContent.startsWith("1")), 60000);
await btn.click({force:true});
check("button returns to HW Helper on Stop",
  await until(()=>btn.textContent().then(t=>t==="HW Helper"),10000), await btn.textContent());

const atStop = await sb.evaluate(()=>window.__answers.length);
await new Promise(r=>setTimeout(r,12000));
const later = await sb.evaluate(()=>window.__answers.length);
check("no further questions answered after Stop", later === atStop, `${atStop} -> ${later}`);
check("chip reports the stop", /Stopped after/.test(await sb.locator("#hw-helper-status").textContent().catch(()=>"")),
  await sb.locator("#hw-helper-status").textContent().catch(()=>""));

await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
