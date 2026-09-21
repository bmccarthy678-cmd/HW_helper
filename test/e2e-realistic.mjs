import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hwh3-"));
let failures = 0;
const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// Mirrors the real screenshot: no data-automation-id, generic divs, real page furniture
const SMARTBOOK = `<!DOCTYPE html><html><body style="margin:0;font-family:sans-serif">
<header><img alt="McGraw Hill"><button>Exit Assignment</button></header>
<div>0 of 39 Concepts completed</div>
<h2>Multiple Choice Question</h2>
<div class="sc-kfPuZi xyz123">In almost all multiple cash flow calculations, it is implicitly assumed that the cash flows occur at the _______ of each period.</div>
<div class="sc-bdVaJa">
  <div class="sc-opt"><input type="radio" id="r0" name="ans"><label for="r0">middle</label></div>
  <div class="sc-opt"><input type="radio" id="r1" name="ans"><label for="r1">beginning</label></div>
  <div class="sc-opt"><input type="radio" id="r2" name="ans"><label for="r2">end</label></div>
</div>
<div><span>Need help? Review these concept resources.</span></div>
<div><span>Read About the Concept</span></div>
<footer><span>Rate your confidence to submit your answer.</span>
<button>High</button><button>Medium</button><button>Low</button><button>Reading</button></footer>
</body></html>`;

const CHATGPT = `<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 window.__p=document.getElementById("prompt-textarea").innerText;
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": "C", "explanation": "Ordinary annuity convention."}';
 document.getElementById("thread").appendChild(d);},600);});
</script></body></html>`;

const ctx = await chromium.launchPersistentContext(userDataDir, {
  channel:"chromium", headless:true, viewport:{width:1400,height:1000},
  args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://learning.mheducation.com/**", r=>r.fulfill({status:200,contentType:"text/html",body:SMARTBOOK}));
await ctx.route("https://chatgpt.com/**", r=>r.fulfill({status:200,contentType:"text/html",body:CHATGPT}));
if(!ctx.serviceWorkers()[0]) await ctx.waitForEvent("serviceworker",{timeout:15000}).catch(()=>null);

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const sb=await ctx.newPage(); await sb.goto("https://learning.mheducation.com/static/awd/index.html?_t=1#/");

const btn=sb.locator("#hw-helper-trigger");
check("button injected", await btn.waitFor({state:"visible",timeout:10000}).then(()=>true).catch(()=>false));
await btn.click({force:true});

const got=await gpt.waitForFunction(()=>document.getElementById("prompt-textarea").innerText.includes("Choices:"),null,{timeout:20000}).then(()=>true).catch(()=>false);
check("question scraped with NO known selectors", got);

if(got){
  const p=await gpt.evaluate(()=>document.getElementById("prompt-textarea").innerText);
  const q=p.split("\n").find(l=>l.startsWith("Question:"))||"";
  check("stem is the real question, not page furniture",
    q.includes("implicitly assumed") && !/Exit Assignment|Concepts completed|confidence/.test(q), q.slice(0,90));
  check("all three choices captured", /A\. middle/.test(p)&&/B\. beginning/.test(p)&&/C\. end/.test(p),
    p.split("Choices:")[1]?.split("\n").filter(Boolean).slice(0,3).join(" | "));
  check("no furniture leaked into choices", !/High|Medium|Reading|Need help/.test(p.split("Choices:")[1]||""));

  const until=async(f,ms=25000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,400));}return false;};
  check("answer 'C' selected the right radio", await until(()=>sb.locator("#r2").isChecked()));
  check("other radios untouched", !(await sb.locator("#r0").isChecked()) && !(await sb.locator("#r1").isChecked()));
  console.log("CHIP:", await sb.locator("#hw-helper-status").textContent().catch(()=>""));
}
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
