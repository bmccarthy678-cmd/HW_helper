import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhcr-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// Connect's real DOM: a .question stem, .answers-wrap.multiple-choice holding
// .answers--mc with .answer__label--mc labels, and the lettered prefix Connect
// renders in front of each label.
const HW=`<!DOCTYPE html><html><body style="margin:0">
<div class="footer__progress__heading">1 of 3</div>
<div class="question">
  <span aria-hidden="true" style="position: absolute">decorative</span>
  Which statement is true when a &lt; b and b &lt; c?
</div>
<div class="answers-wrap multiple-choice">
  <div class="answers--mc">
    <label class="answer__label--mc"><input type="radio" name="a" id="o0">a a &lt; c</label>
    <label class="answer__label--mc"><input type="radio" name="a" id="o1">b a &gt; c</label>
    <label class="answer__label--mc"><input type="radio" name="a" id="o2">c a = c</label>
  </div>
</div>
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
await ctx.route("https://ezto.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:HW}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:GPT}));
let sw=null; for(let i=0;i<40&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}
await sw.evaluate(()=>chrome.storage.sync.set({autoSelect:true,advance:false,confidence:"off",checkWork:false,verify:false,images:false}));

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const p=await ctx.newPage(); await p.goto("https://ezto.mheducation.com/hm.tpx");
await p.locator("#hw-helper-trigger-ezto").waitFor({state:"visible",timeout:10000});
await p.locator("#hw-helper-trigger-ezto").click({force:true});

const until=async(f,ms=60000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,400));}return false;};

const sent = await until(()=>gpt.evaluate(()=>document.getElementById("prompt-textarea").innerText.includes("Choices:")));
check("reads the real .question stem and sends it", sent,
  await gpt.evaluate(()=>document.getElementById("prompt-textarea").innerText.split("\n").find(l=>l.startsWith("Question:"))||"").catch(()=>""));

if (sent) {
  const prompt = await gpt.evaluate(()=>document.getElementById("prompt-textarea").innerText);
  check("stem wording captured", /a < b and b < c/.test(prompt));
  check("absolutely-positioned decoration not sent", !/decorative/i.test(prompt));
  check("choices come from .answer__label--mc", /a < c/.test(prompt) && /a > c/.test(prompt));
  check("answer applied to the real input",
    await until(()=>p.evaluate(()=>document.getElementById("o0").checked)),
    await p.evaluate(()=>{const n=document.getElementById("hw-helper-status-ezto");return n?n.textContent:"";}));
}

await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
