import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhrbd-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// SmartBook's matching board is react-beautiful-dnd. It ignores synthesised
// mouse drags completely: the only way in is the keyboard interface, where the
// handle is focused, space lifts, arrows travel over rows-then-pool, and space
// drops. This stub implements exactly that and nothing else, so a pointer-based
// implementation scores zero against it.
const SB=`<!DOCTYPE html><html><body style="height:900px">
<div class="probe-container">
 <div class="awd-probe-type-matching awd-probe-mode-testing">
  <div class="prompt">Match each rate with its definition.</div>
  <div class="matching-component">
    <div class="responses-container">
      <div class="match-row"><div class="match-prompt"><div class="content">APR</div></div>
        <div class="match-single-response-wrapper"></div></div>
      <div class="match-row"><div class="match-prompt"><div class="content">EAR</div></div>
        <div class="match-single-response-wrapper"></div></div>
    </div>
    <div class="choices-container"></div>
  </div>
 </div>
</div>
<script>
const DEFS=["the rate per period times the number of periods","the rate as if compounded once per year"];
const rows=[null,null];
let pool=[0,1];
let lifted=null, cursor=0;

function card(i){
  const d=document.createElement("div");
  d.className="choice-item-wrapper"; d.id="choices:"+i;
  d.innerHTML='<div data-react-beautiful-dnd-drag-handle tabindex="0"><div class="content">'+DEFS[i]+'</div></div>';
  d.querySelector("[data-react-beautiful-dnd-drag-handle]").addEventListener("keydown",e=>onKey(e,i));
  return d;
}
function absOf(i){ const r=rows.indexOf(i); return r>=0 ? r : rows.length + pool.indexOf(i); }
function place(i,abs){
  const r=rows.indexOf(i); if(r>=0) rows[r]=null;
  const pi=pool.indexOf(i); if(pi>=0) pool.splice(pi,1);
  if(abs>=0 && abs<rows.length){ if(rows[abs]!==null) pool.push(rows[abs]); rows[abs]=i; }
  else pool.push(i);
}
function onKey(e,i){
  if(e.code==="Space"){
    e.preventDefault();
    if(lifted===null){ lifted=i; cursor=absOf(i); }
    else { place(lifted,cursor); lifted=null; render(); }
    return;
  }
  if(lifted===null) return;            // arrows do nothing unless lifted
  if(e.code==="ArrowUp"){ e.preventDefault(); cursor=Math.max(0,cursor-1); }
  if(e.code==="ArrowDown"){ e.preventDefault(); cursor=Math.min(rows.length+pool.length-1,cursor+1); }
}
function render(){
  document.querySelectorAll(".match-single-response-wrapper").forEach((w,r)=>{
    w.innerHTML=""; if(rows[r]!==null) w.appendChild(card(rows[r]));
  });
  const c=document.querySelector(".choices-container"); c.innerHTML="";
  pool.forEach(i=>c.appendChild(card(i)));
  window.__state=rows.map(r=>r===null?"":DEFS[r]);
}
// mouse drags are deliberately not wired up
render();
</script></body></html>`;

const GPT=`<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent=JSON.stringify({answer:["APR -> the rate per period times the number of periods",
   "EAR -> the rate as if compounded once per year"],explanation:"x"});
 document.getElementById("thread").appendChild(d);},300);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
 viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://learning.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:SB}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:GPT}));
let sw=null; for(let i=0;i<40&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}
await sw.evaluate(()=>chrome.storage.sync.set({autoSelect:true,advance:false,confidence:"off",verify:false,images:false}));

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const p=await ctx.newPage(); await p.goto("https://learning.mheducation.com/static/awd/index.html");
await p.locator("#hw-helper-trigger").waitFor({state:"visible",timeout:10000});
await p.locator("#hw-helper-trigger").click({force:true});

const until=async(f,ms=90000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,500));}return false;};

const sent = await until(()=>gpt.evaluate(()=>!!document.getElementById("prompt-textarea").innerText.trim()));
check("matching board read and sent", sent);
if (sent) {
  const prompt = await gpt.evaluate(()=>document.getElementById("prompt-textarea").innerText);
  check("row prompts read from .match-prompt .content", /APR/.test(prompt) && /EAR/.test(prompt));
  check("cards read from the pool", /rate per period/.test(prompt) && /compounded once per year/.test(prompt));
}

check("APR row filled via the keyboard interface",
  await until(()=>p.evaluate(()=>(window.__state||[])[0]==="the rate per period times the number of periods")),
  JSON.stringify(await p.evaluate(()=>window.__state)));
check("EAR row filled via the keyboard interface",
  await until(()=>p.evaluate(()=>(window.__state||[])[1]==="the rate as if compounded once per year")),
  JSON.stringify(await p.evaluate(()=>window.__state)));

await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
