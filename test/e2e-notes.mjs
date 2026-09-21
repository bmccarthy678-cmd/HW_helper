import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hwh7-"));
let failures = 0;
const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// 3 questions; the assistant gets #2 wrong on purpose so grading shows a mix
const SMARTBOOK = `<!DOCTYPE html><html><body style="margin:0">
<div id="hdr">0 of 3 Concepts completed</div><div id="app"></div>
<script>
const QS=[["Q1 alpha or beta?",["alpha","beta"],1],["Q2 one or two?",["one","two"],1],
          ["Q3 up or down?",["up","down"],1]];
let i=0,done=0;
function render(){const q=QS[i],a=document.getElementById("app");
 a.innerHTML='<h2>Multiple Choice Question</h2><div>'+q[0]+'</div>'+
  q[1].map((t,n)=>'<div><input type="radio" id="o'+n+'" name="a"><label for="o'+n+'">'+t+'</label></div>').join('')+
  '<footer><span>Rate your confidence to submit your answer.</span><button id="hi" disabled>High</button></footer>';
 a.querySelectorAll("input[name=a]").forEach(r=>r.addEventListener("change",()=>{document.getElementById("hi").disabled=false;}));
 document.getElementById("hi").addEventListener("click",()=>{
   const sel=[...a.querySelectorAll("input[name=a]")].findIndex(r=>r.checked);
   const ok = sel===QS[i][2];
   done++; document.getElementById("hdr").textContent=done+" of 3 Concepts completed";
   a.innerHTML='<div><span>Your Answer</span> <span>'+(ok?"correct":"incorrect")+'</span></div>'+
     '<h3>Correct Answer</h3><div>'+QS[i][1][QS[i][2]]+'</div><button id="nextq">Next Question</button>';
   document.getElementById("nextq").addEventListener("click",()=>{i++; if(i<QS.length)render(); else a.innerHTML='<h3>Done</h3>';});});}
render();
</script></body></html>`;

const CHATGPT = `<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 const p=document.getElementById("prompt-textarea").innerText;
 const ans = /one or two/.test(p) ? "A" : "B";   // deliberately wrong on Q2
 setTimeout(()=>{const d=document.createElement("div");
  d.setAttribute("data-message-author-role","assistant");
  d.textContent='{"answer": "'+ans+'", "explanation": "reasoning here"}';
  document.getElementById("thread").appendChild(d);
  document.getElementById("prompt-textarea").innerText="";},400);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(userDataDir,{channel:"chromium",headless:true,
 viewport:{width:1400,height:1000},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://learning.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:SMARTBOOK}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:CHATGPT}));
let sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent("serviceworker",{timeout:15000}).catch(()=>null);
await sw.evaluate(()=>chrome.storage.sync.set({confidence:"high",advance:true,autoSelect:true}));

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const sb=await ctx.newPage(); await sb.goto("https://learning.mheducation.com/static/awd/index.html#/");
await sb.locator("#hw-helper-trigger").waitFor({state:"visible",timeout:10000});
await sb.locator("#hw-helper-trigger").click({force:true});

const until=async(f,ms=120000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,500));}return false;};
check("ran all 3", await until(()=>sb.evaluate(()=>document.getElementById("hdr").textContent==="3 of 3 Concepts completed")));

const notes = await sw.evaluate(async()=> (await chrome.storage.local.get("notes")).notes || []);
check("three notes recorded", notes.length===3, String(notes.length));
check("question text captured", notes.every(n=>n.question && n.question.length>5), notes[0]?.question);
check("choices captured", notes.every(n=>(n.choices||[]).length===2));
check("explanation captured", notes.every(n=>n.explanation==="reasoning here"));
check("verdicts captured", notes.map(n=>n.verdict).join(",")==="correct,incorrect,correct", notes.map(n=>n.verdict).join(","));
check("correct answer captured for the miss",
  notes[1] && /two/.test(notes[1].correctAnswer||""), notes[1]?.correctAnswer);
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
