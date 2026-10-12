import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhfoc-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// The assistant tab is open but sitting behind the courseware. The worker has
// to show it while the question is being asked (Chrome throttles hidden tabs,
// and a hidden assistant can stall without processing the prompt) and hand the
// screen back to the courseware once the answer arrives.
//
// A tab the extension creates itself escapes Playwright's request interception
// and loads an error page here, so the open-when-missing path cannot be driven
// in this harness; this covers the switching, which is what was missing.
const SB=`<!DOCTYPE html><html><body style="height:900px">
<div class="probe-container">
  <div class="awd-probe-type-multiple_choice awd-probe-mode-testing">
    <div class="prompt">Which statement is true when a &lt; b and b &lt; c?</div>
    <label><input type="radio" name="q" id="c0"><span class="choiceText">a &lt; c</span></label>
    <label><input type="radio" name="q" id="c1"><span class="choiceText">a &gt; c</span></label>
  </div>
</div></body></html>`;

// a slow reply leaves time to see which tab is in front while it is thinking
const GPT=`<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 window.__sent=true;
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": "A", "explanation":"transitive"}';
 document.getElementById("thread").appendChild(d);},4000);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
 viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://learning.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:SB}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:GPT}));
let sw=null; for(let i=0;i<40&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}
await sw.evaluate(()=>chrome.storage.sync.set({autoSelect:true,advance:false,confidence:"off",verify:false,images:false}));

const activeUrl = () => sw.evaluate(async()=>{
  const [t] = await chrome.tabs.query({active:true, lastFocusedWindow:true});
  return t ? t.url : "";
});

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const p=await ctx.newPage(); await p.goto("https://learning.mheducation.com/static/awd/index.html");
await p.locator("#hw-helper-trigger").waitFor({state:"visible",timeout:10000});
await p.bringToFront();
await p.locator("#hw-helper-trigger").click({force:true});

const until=async(f,ms=60000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,300));}return false;};

const before = await activeUrl();
check("the courseware starts in front", before.startsWith("https://learning.mheducation.com"), before);

const sent = await until(()=>gpt.evaluate(()=>!!window.__sent));
check("the question reached it", Boolean(sent));

const whileThinking = await activeUrl();
check("the assistant is in front while it works", whileThinking.startsWith("https://chatgpt.com"), whileThinking);

check("the answer was applied",
  await until(()=>p.evaluate(()=>document.getElementById("c0").checked)));

const back = await until(async()=>(await activeUrl()).startsWith("https://learning.mheducation.com"), 10000);
check("the courseware is back in front afterwards", back, await activeUrl());

await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
