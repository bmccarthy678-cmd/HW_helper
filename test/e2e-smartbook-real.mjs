import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhsbr-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// SmartBook's real DOM, not an invented one: .probe-container wrapping a
// .prompt and .choiceText labels, with the awd-probe-type-* marker, the
// data-automation-id confidence buttons and .next-button it actually ships.
// The prompt deliberately carries a screen-reader span, which must not reach
// the assistant as part of the question.
const SB=`<!DOCTYPE html><html><body style="height:900px">
<div class="probe-container" data-probe-id="p1">
  <div class="awd-probe-type-multiple_choice awd-probe-mode-testing">
    <div class="prompt">
      <span class="_visuallyHidden">Multiple choice question. Three options follow.</span>
      Which statement is true when a &lt; b and b &lt; c?
    </div>
    <label><input type="radio" name="q" id="c0"><span class="choiceText">a &lt; c</span></label>
    <label><input type="radio" name="q" id="c1"><span class="choiceText">a &gt; c</span></label>
    <label><input type="radio" name="q" id="c2"><span class="choiceText">a = c</span></label>
  </div>
</div>
<div class="confidence">
  <button data-automation-id="confidence-buttons--high_confidence">High</button>
  <button data-automation-id="confidence-buttons--medium_confidence">Medium</button>
</div>
<script>window.__clicked=[];
document.querySelectorAll("[data-automation-id^='confidence-buttons']").forEach(b=>
  b.addEventListener("click",()=>{window.__clicked.push(b.getAttribute("data-automation-id"));
    const n=document.createElement("button");n.className="next-button";n.textContent="Next";
    n.addEventListener("click",()=>window.__clicked.push("next"));document.body.appendChild(n);}));
</script></body></html>`;

const GPT=`<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 window.__lastPrompt=document.getElementById("prompt-textarea").innerText;
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

const sent = await until(()=>gpt.evaluate(()=>document.getElementById("prompt-textarea").innerText.includes("Choices:")));
check("reads the real .probe-container question and sends it", sent,
  await gpt.evaluate(()=>document.getElementById("prompt-textarea").innerText.split("\n").find(l=>l.startsWith("Question:"))||"").catch(()=>""));

if (sent) {
  const prompt = await gpt.evaluate(()=>document.getElementById("prompt-textarea").innerText);
  check("question wording comes from .prompt", /a < b and b < c/.test(prompt));
  check("screen-reader span is not sent as the question",
    !/Multiple choice question\. Three options follow/i.test(prompt),
    (prompt.match(/Three options follow/)||["clean"])[0]);
  check("choices come from .choiceText", /A\. a < c/.test(prompt) && /B\. a > c/.test(prompt));

  check("answer applied to the real radio input",
    await until(()=>p.evaluate(()=>document.getElementById("c0").checked)),
    await p.evaluate(()=>{const n=document.getElementById("hw-helper-status");return n?n.textContent:"";}));
}

await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
