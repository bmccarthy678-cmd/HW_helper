import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hwh9-"));
let failures = 0;
const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// Mirrors the real screenshot: blank sits INSIDE the sentence
const SMARTBOOK = `<!DOCTYPE html><html><body style="margin:0">
<div id="hdr">1 of 39 Concepts completed</div>
<h2>Fill in the Blank Question</h2>
<div class="sc-stem">In the standard present and future value tables, and in all the default settings on a
financial calculator, the assumption is that cash flows occur at the
<input type="text" id="blank"> (beginning/end) of each period.</div>
<div id="shadowhost"></div>
<script>
const host=document.getElementById("shadowhost");
host.attachShadow({mode:"open"});
</script>
<div><span>Need help? Review these concept resources.</span></div>
<footer><span>Rate your confidence to submit your answer.</span>
<button id="hi" disabled>High</button><button>Medium</button><button>Low</button></footer>
<div id="out"></div>
<script>
document.getElementById("blank").addEventListener("input",()=>{document.getElementById("hi").disabled=false;});
document.getElementById("hi").addEventListener("click",()=>{
  document.getElementById("out").textContent="submitted:"+document.getElementById("blank").value;});
</script></body></html>`;

// echoes back exactly what it received, so the test can inspect the real prompt
const CHATGPT = `<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 window.__prompt=document.getElementById("prompt-textarea").innerText;
 setTimeout(()=>{const d=document.createElement("div");
  d.setAttribute("data-message-author-role","assistant");
  d.textContent='{"answer": "end", "explanation": "Ordinary annuity convention."}';
  document.getElementById("thread").appendChild(d);},400);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(userDataDir,{channel:"chromium",headless:true,
 viewport:{width:1400,height:1000},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://learning.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:SMARTBOOK}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:CHATGPT}));
let sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent("serviceworker",{timeout:15000}).catch(()=>null);
await sw.evaluate(()=>chrome.storage.sync.set({confidence:"high",advance:false,autoSelect:true}));

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const sb=await ctx.newPage(); await sb.goto("https://learning.mheducation.com/static/awd/index.html#/");
await sb.locator("#hw-helper-trigger").waitFor({state:"visible",timeout:10000});
await sb.locator("#hw-helper-trigger").click({force:true});

const until=async(f,ms=60000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,400));}return false;};
check("prompt reached the assistant", await until(()=>gpt.evaluate(()=>!!window.__prompt)));

const prompt = await gpt.evaluate(()=>window.__prompt||"");
const q = prompt.split("\n").find(l=>l.startsWith("Question:")) || "";
check("question text is actually in the prompt", /standard present and future value tables/.test(q), q.slice(0,100));
check("blank shown as a placeholder in the sentence", /_______/.test(q), q.slice(-70));
check("the (beginning/end) hint survived", /beginning\/end/.test(q));
check("heading not mistaken for the question", !/^Question: Fill in the Blank/.test(q));

check("answer typed into the blank", await until(()=>sb.locator("#blank").inputValue().then(v=>v==="end")),
  await sb.locator("#blank").inputValue());
check("confidence submitted", await until(()=>sb.locator("#out").textContent().then(t=>t==="submitted:end")),
  await sb.locator("#out").textContent());
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
