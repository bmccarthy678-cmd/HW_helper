import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hwh8-"));
let failures = 0;
const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// three written formats: one blank, two blanks, two dropdowns
const SMARTBOOK = `<!DOCTYPE html><html><body style="margin:0">
<header><input type="search" placeholder="Search"></header>
<div id="hdr">0 of 3 Concepts completed</div><div id="app"></div>
<script>
const QS=[
 {q:"The present value of a perpetuity equals the payment divided by the _______.",kind:"one"},
 {q:"Compounding moves money _______ in time; discounting moves it _______.",kind:"two"},
 {q:"Match each symbol to its meaning.",kind:"sel"}];
let i=0,done=0; window.__filled=[];
function render(){const s=QS[i],a=document.getElementById("app");
 let body='<h2>Fill in the Blank</h2><div>'+s.q+'</div>';
 if(s.kind==="one") body+='<input type="text" id="f0">';
 if(s.kind==="two") body+='<input type="text" id="f0"><input type="text" id="f1">';
 if(s.kind==="sel") body+='<select id="f0"><option></option><option>present value</option><option>future value</option></select>'+
                         '<select id="f1"><option></option><option>interest rate</option><option>time period</option></select>';
 body+='<footer><button id="hi">High</button></footer>';
 a.innerHTML=body;
 document.getElementById("hi").addEventListener("click",()=>{
   const vals=[...a.querySelectorAll("input[type=text],select")].map(e=>e.value);
   window.__filled.push(vals);
   done++; document.getElementById("hdr").textContent=done+" of 3 Concepts completed";
   a.innerHTML='<div><span>Your Answer</span> <span>correct</span></div><button id="nextq">Next Question</button>';
   document.getElementById("nextq").addEventListener("click",()=>{i++; if(i<QS.length)render(); else a.innerHTML='<h3>Done</h3>';});});}
render();
</script></body></html>`;

const CHATGPT = `<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 const p=document.getElementById("prompt-textarea").innerText;
 let ans;
 if(/perpetuity/.test(p)) ans='"discount rate"';
 else if(/Compounding/.test(p)) ans='["forward","backward"]';
 else ans='["present value","time period"]';
 setTimeout(()=>{const d=document.createElement("div");
  d.setAttribute("data-message-author-role","assistant");
  d.textContent='{"answer": '+ans+', "explanation": "because"}';
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
check("ran all 3 written questions", await until(()=>sb.evaluate(()=>document.getElementById("hdr").textContent==="3 of 3 Concepts completed")),
  await sb.evaluate(()=>document.getElementById("hdr").textContent));

const filled = await sb.evaluate(()=>window.__filled);
check("single blank filled", JSON.stringify(filled[0])===JSON.stringify(["discount rate"]), JSON.stringify(filled[0]));
check("two blanks filled in order", JSON.stringify(filled[1])===JSON.stringify(["forward","backward"]), JSON.stringify(filled[1]));
check("dropdowns set by option text", JSON.stringify(filled[2])===JSON.stringify(["present value","time period"]), JSON.stringify(filled[2]));

const notes = await sw.evaluate(async()=>(await chrome.storage.local.get("notes")).notes||[]);
check("written questions recorded in notes", notes.length===3, String(notes.length));
check("header search box ignored", !JSON.stringify(filled).includes("Search"));
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
