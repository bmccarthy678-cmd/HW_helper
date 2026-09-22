import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhm-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// Mirrors the screenshot: APR/EAR rows with empty slots, definition cards below
const SMARTBOOK = `<!DOCTYPE html><html><body style="margin:0">
<div id="hdr">24 of 39 Concepts completed</div>
<h2>Matching Question</h2>
<div class="stem">Match the type of rate with its definition.</div>
<div><span>Instructions</span></div>
<div class="row"><div class="term">APR</div><div class="zone" id="z0" style="width:200px;height:60px;border:1px solid #ccc"></div></div>
<div class="row"><div class="term">EAR</div><div class="zone" id="z1" style="width:200px;height:60px;border:1px solid #ccc"></div></div>
<div id="bank">
  <div draggable="true" id="c0" style="width:300px;height:60px">The interest rate per period multiplied by the number of periods in the year.</div>
  <div draggable="true" id="c1" style="width:300px;height:60px">The interest rate stated as though it were compounded once per year.</div>
</div>
<footer><button id="hi" disabled>High</button></footer><div id="out"></div>
<script>
let dragged=null;
document.querySelectorAll('[draggable="true"]').forEach(c=>{
  c.addEventListener("dragstart",e=>{dragged=c;});
  c.addEventListener("mousedown",e=>{dragged=c;});
});
document.querySelectorAll(".zone").forEach(z=>{
  z.addEventListener("dragover",e=>e.preventDefault());
  const place=()=>{ if(!dragged||z.textContent.trim()) return;
    z.textContent=dragged.textContent; dragged.remove(); dragged=null;
    if([...document.querySelectorAll(".zone")].every(x=>x.textContent.trim()))
      document.getElementById("hi").disabled=false; };
  z.addEventListener("drop",e=>{e.preventDefault(); place();});
  z.addEventListener("mouseup",place);
});
document.getElementById("hi").addEventListener("click",()=>{
  document.getElementById("out").textContent=
    [...document.querySelectorAll(".zone")].map(z=>z.textContent.trim().slice(0,20)).join(" | ");});
</script></body></html>`;

const CHATGPT = `<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 window.__p=document.getElementById("prompt-textarea").innerText;
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent=JSON.stringify({answer:["The interest rate per period multiplied by the number of periods in the year.",
   "The interest rate stated as though it were compounded once per year."],explanation:"APR is nominal; EAR is annualised."});
 document.getElementById("thread").appendChild(d);},400);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(userDataDir,{channel:"chromium",headless:true,
 viewport:{width:1400,height:1100},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://learning.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:SMARTBOOK}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:CHATGPT}));
let sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent("serviceworker",{timeout:15000}).catch(()=>null);
await sw.evaluate(()=>chrome.storage.sync.set({confidence:"high",advance:false,autoSelect:true}));
const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const sb=await ctx.newPage(); await sb.goto("https://learning.mheducation.com/static/awd/index.html#/");
await sb.locator("#hw-helper-trigger").waitFor({state:"visible",timeout:10000});
await sb.locator("#hw-helper-trigger").click({force:true});

const until=async(f,ms=60000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,400));}return false;};
check("prompt sent", await until(()=>gpt.evaluate(()=>!!window.__p)));
const p=await gpt.evaluate(()=>window.__p||"");
check("stem captured", /Match the type of rate/.test(p), (p.split("\n").find(l=>l.startsWith("Question:"))||"").slice(0,60));
check("both terms listed", /1\. APR/.test(p) && /2\. EAR/.test(p));
check("both definitions listed as options", (p.match(/- The interest rate/g)||[]).length===2);
check("Instructions not treated as a term", !/\d\. Instructions/.test(p));
check("cards dropped into the slots",
  await until(()=>sb.evaluate(()=>[...document.querySelectorAll(".zone")].every(z=>z.textContent.trim()))),
  await sb.evaluate(()=>[...document.querySelectorAll(".zone")].map(z=>z.textContent.trim().slice(0,18)).join(" | ")));
check("APR got the per-period definition",
  await sb.evaluate(()=>document.getElementById("z0").textContent.includes("per period")),
  await sb.evaluate(()=>document.getElementById("z0").textContent.slice(0,40)));
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
