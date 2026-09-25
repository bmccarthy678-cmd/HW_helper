import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhav-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// Q1 has a diagram, Q2 is plain text. verify is OFF globally.
const QUIZ=`<!DOCTYPE html><html><body style="margin:0">
<div class="question_holder"><div class="display_question">
<canvas id="chart" width="320" height="200"></canvas>
<div class="question_text">From the graph, which quarter was highest?</div>
<div><input type="radio" name="q1" id="g1"><label for="g1">Q3</label></div>
<div><input type="radio" name="q1" id="g2"><label for="g2">Q1</label></div>
</div></div>
<div class="question_holder"><div class="display_question">
<div class="question_text">What is the capital of France?</div>
<div><input type="radio" name="q2" id="t1"><label for="t1">Paris</label></div>
<div><input type="radio" name="q2" id="t2"><label for="t2">Lyon</label></div>
</div></div>
<script>
const c=document.getElementById("chart").getContext("2d");
c.fillStyle="#36c";[40,80,160,90].forEach((h,i)=>c.fillRect(20+i*70,200-h,50,h));
</script></body></html>`;

const GPT=`<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
window.__log=[];
document.getElementById("prompt-textarea").addEventListener("paste",e=>{
  if(e.clipboardData && e.clipboardData.files.length) window.__log.push("paste");});
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 const p=document.getElementById("prompt-textarea").innerText;
 window.__log.push(/graph/.test(p)?"send:graph":"send:text");
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": "A", "explanation": "x"}';
 document.getElementById("thread").appendChild(d);
 document.getElementById("prompt-textarea").innerText="";},300);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
 viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://ohio.instructure.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:QUIZ}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:GPT}));
let sw=null; for(let i=0;i<40&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}
// images on, verify OFF
await sw.evaluate(()=>chrome.storage.sync.set({autoSelect:true,images:true,verify:false}));

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const q=await ctx.newPage(); await q.goto("https://ohio.instructure.com/courses/1/quizzes/1/take");
await q.locator("#hw-helper-trigger-canvas").waitFor({state:"visible",timeout:10000});
await q.locator("#hw-helper-trigger-canvas").click({force:true});

const until=async(f,ms=140000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,500));}return false;};
check("run finished", await until(()=>q.locator("#hw-helper-status-canvas").textContent().then(t=>/Done\./.test(t||""))),
  await q.locator("#hw-helper-status-canvas").textContent().catch(()=>""));

const log = await gpt.evaluate(()=>window.__log);
const graphSends = log.filter(x=>x==="send:graph").length;
const textSends  = log.filter(x=>x==="send:text").length;
check("graph question asked twice despite verify off", graphSends===2, `graph sends=${graphSends}`);
check("plain text question asked once", textSends===1, `text sends=${textSends}`);
check("image pasted on both graph rounds", log.filter(x=>x==="paste").length===2, JSON.stringify(log));
check("both questions answered", (await q.locator("#g1").isChecked()) && (await q.locator("#t1").isChecked()),
  `g1=${await q.locator("#g1").isChecked()} t1=${await q.locator("#t1").isChecked()}`);
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
