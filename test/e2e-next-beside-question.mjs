import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhnx-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// SmartBook keeps a .next-button on screen beside a question that has not been
// answered yet. Treating any visible "Next" as the answered screen made the
// worker report "moved to the next question" and never open the assistant at
// all, which is indistinguishable from the extension doing nothing.
const SB=`<!DOCTYPE html><html><body style="height:900px">
<div class="probe-container" data-probe-id="p1">
  <div class="awd-probe-type-multiple_choice awd-probe-mode-testing">
    <div class="prompt">Which statement is true when a &lt; b and b &lt; c?</div>
    <label><input type="radio" name="q" id="c0"><span class="choiceText">a &lt; c</span></label>
    <label><input type="radio" name="q" id="c1"><span class="choiceText">a &gt; c</span></label>
  </div>
</div>
<button class="next-button">Next</button>
</body></html>`;

const GPT=`<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": "A", "explanation":"transitive"}';
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

check("question still sent despite the Next button beside it",
  await until(()=>gpt.evaluate(()=>document.getElementById("prompt-textarea").innerText.includes("Choices:"))),
  await p.evaluate(()=>{const n=document.getElementById("hw-helper-status");return n?n.textContent:"";}).catch(()=>""));

check("not reported as the answered screen",
  !/moved to the next question|end of the page/i.test(
    await p.evaluate(()=>{const n=document.getElementById("hw-helper-status");return n?n.textContent:"";}).catch(()=>"")),
  await p.evaluate(()=>{const n=document.getElementById("hw-helper-status");return n?n.textContent:"";}).catch(()=>""));

check("answer applied",
  await until(()=>p.evaluate(()=>document.getElementById("c0").checked)));

await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
