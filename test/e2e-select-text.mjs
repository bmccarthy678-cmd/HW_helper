import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhst-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// A select_text question: the choices are clickable spans inside
// .select-text-component, with no input element behind them at all.
const SB=`<!DOCTYPE html><html><body style="height:900px">
<div class="probe-container">
 <div class="awd-probe-type-select_text awd-probe-mode-testing">
  <div class="prompt">Select every term that names a rate.</div>
  <div class="select-text-component">
    <span class="choice -interactive" id="s0">annual percentage rate</span>
    <span class="choice -interactive" id="s1">present value</span>
    <span class="choice -interactive" id="s2">effective annual rate</span>
  </div>
 </div>
</div>
<script>window.__picked=[];
document.querySelectorAll(".choice.-interactive").forEach(c=>
  c.addEventListener("click",()=>{c.classList.add("-selected");window.__picked.push(c.id);}));
</script></body></html>`;

const GPT=`<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": ["annual percentage rate","effective annual rate"], "explanation":"both are rates"}';
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

const until=async(f,ms=60000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,400));}return false;};

const sent = await until(()=>gpt.evaluate(()=>document.getElementById("prompt-textarea").innerText.includes("Choices:")));
check("select-text choices read and sent", sent);
if (sent) {
  const prompt = await gpt.evaluate(()=>document.getElementById("prompt-textarea").innerText);
  check("all three spans listed as choices",
    /annual percentage rate/.test(prompt) && /present value/.test(prompt) && /effective annual rate/.test(prompt));
  check("treated as multi-answer", /select all|more than one|array/i.test(prompt), (prompt.match(/.{0,60}array.{0,40}/)||[""])[0]);
}

check("both correct spans clicked",
  await until(()=>p.evaluate(()=>window.__picked.includes("s0")&&window.__picked.includes("s2"))),
  JSON.stringify(await p.evaluate(()=>window.__picked)));
check("the wrong span was left alone",
  !(await p.evaluate(()=>window.__picked.includes("s1"))),
  JSON.stringify(await p.evaluate(()=>window.__picked)));

await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
