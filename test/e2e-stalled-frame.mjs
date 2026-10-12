import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhstall-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// A live courseware page carries frames the question has nothing to do with:
// analytics, embeds, trackers. One of them here never finishes loading, because
// a script it blocks on never arrives. Reading the page has to cope with that
// instead of waiting on it forever, which left the chip on "Working on
// question 1" with nothing ever sent.
const SB=`<!DOCTYPE html><html><body style="height:900px">
<div class="probe-container">
  <div class="awd-probe-type-multiple_choice awd-probe-mode-testing">
    <div class="prompt">Which statement is true when a &lt; b and b &lt; c?</div>
    <label><input type="radio" name="q" id="c0"><span class="choiceText">a &lt; c</span></label>
    <label><input type="radio" name="q" id="c1"><span class="choiceText">a &gt; c</span></label>
  </div>
</div>
<iframe src="https://learning.mheducation.com/static/awd/stalled-frame.html" width="300" height="100"></iframe>
</body></html>`;

const STALLED=`<!DOCTYPE html><html><head>
<script src="https://learning.mheducation.com/never-arrives.js"></script>
</head><body>tracker</body></html>`;

const GPT=`<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 window.__sent=true;
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": "A", "explanation":"transitive"}';
 document.getElementById("thread").appendChild(d);},300);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
 viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
// the script never arrives: hold the request open and never answer it
await ctx.route("https://learning.mheducation.com/never-arrives.js", () => {});
await ctx.route("https://learning.mheducation.com/static/awd/stalled-frame.html",
  r=>r.fulfill({status:200,contentType:"text/html",body:STALLED}));
await ctx.route("https://learning.mheducation.com/static/awd/index.html",
  r=>r.fulfill({status:200,contentType:"text/html",body:SB}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:GPT}));
let sw=null; for(let i=0;i<40&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}
await sw.evaluate(()=>chrome.storage.sync.set({autoSelect:true,advance:false,confidence:"off",verify:false,images:false}));

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const p=await ctx.newPage();
await p.goto("https://learning.mheducation.com/static/awd/index.html", { waitUntil: "domcontentloaded" });
await p.locator("#hw-helper-trigger").waitFor({state:"visible",timeout:15000});

await p.evaluate(()=>{
  window.__chips=[];
  const watch=()=>{const n=document.getElementById("hw-helper-status");
    if(n){const t=n.textContent; if(t && window.__chips[window.__chips.length-1]!==t) window.__chips.push(t);}};
  new MutationObserver(watch).observe(document.body,{subtree:true,childList:true,characterData:true});
});
await p.locator("#hw-helper-trigger").click({force:true});

const until=async(f,ms)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,400));}return false;};

// well inside the 45 second handshake: a working read takes a second or two
const sent = await until(()=>gpt.evaluate(()=>!!window.__sent), 25000);
check("question sent despite a frame that never finishes loading", sent,
  JSON.stringify(await p.evaluate(()=>window.__chips||[])));

check("answer applied",
  sent && await until(()=>p.evaluate(()=>document.getElementById("c0").checked), 20000));

await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
