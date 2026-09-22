import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhs-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// the blank lives inside a shadow root
const SMARTBOOK = `<!DOCTYPE html><html><body style="margin:0">
<div id="hdr">1 of 39</div><h2>Fill in the Blank Question</h2>
<div id="host"></div>
<footer><button id="hi" disabled>High</button></footer><div id="out"></div>
<script>
const host=document.getElementById("host");
const root=host.attachShadow({mode:"open"});
root.innerHTML='<div>Cash flows are assumed to occur at the <input type="text" id="b"> of each period.</div>';
root.getElementById("b").addEventListener("input",()=>{document.getElementById("hi").disabled=false;});
document.getElementById("hi").addEventListener("click",()=>{
  document.getElementById("out").textContent="submitted:"+root.getElementById("b").value;});
</script></body></html>`;

const CHATGPT = `<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 window.__p=document.getElementById("prompt-textarea").innerText;
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": "end", "explanation": "x"}';
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
check("question inside shadow root reached the assistant",
  await until(()=>gpt.evaluate(()=>!!window.__p && /Cash flows are assumed/.test(window.__p))),
  (await gpt.evaluate(()=>window.__p||"")).split("\n").find(l=>l.startsWith("Question:"))||"(none)");
check("answer typed into the shadow-root blank",
  await until(()=>sb.evaluate(()=>document.getElementById("host").shadowRoot.getElementById("b").value==="end")),
  await sb.evaluate(()=>document.getElementById("host").shadowRoot.getElementById("b").value));
check("confidence submitted", await until(()=>sb.locator("#out").textContent().then(t=>t==="submitted:end")),
  await sb.locator("#out").textContent());
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
