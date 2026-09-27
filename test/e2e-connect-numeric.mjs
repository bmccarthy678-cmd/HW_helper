import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhnum-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// Mirrors the screenshot: intro paragraph, two lettered parts, two boxes in a table
const HW=`<!DOCTYPE html><html><body style="margin:0">
<div id="sidebar"><button>eBook</button><button>Hint</button><button>Print</button><button>References</button></div>
<button id="checkbtn">Check my work</button>
<div id="q">
  <p>You have just purchased a new warehouse. To finance the purchase, you've arranged for a
  25-year mortgage loan for 75 percent of the $2,700,000 purchase price. The monthly payment
  on this loan will be $16,800.</p>
  <p><b>a.</b> What is the APR on this loan?</p>
  <p><b>b.</b> What is the EAR on this loan?</p>
  <table><tbody>
    <tr><td><b>a.</b> Annual percentage rate</td><td><input type="text" id="apr"></td><td>%</td></tr>
    <tr><td><b>b.</b> Effective annual rate</td><td><input type="text" id="ear"></td><td>%</td></tr>
  </tbody></table>
</div>
<div id="nav"><button>Prev</button><span>2 of 26</span><button id="next">Next</button></div>
</body></html>`;

const GPT=`<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
window.__prompt="";
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 window.__prompt=document.getElementById("prompt-textarea").innerText;
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": ["6.13","6.30"], "explanation":"solve for rate then annualise"}';
 document.getElementById("thread").appendChild(d);
 document.getElementById("prompt-textarea").innerText="";},300);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
 viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://ezto.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:HW}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:GPT}));
let sw=null; for(let i=0;i<40&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}
await sw.evaluate(()=>chrome.storage.sync.set({autoSelect:true,checkWork:false,advance:false,confidence:"off"}));

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const p=await ctx.newPage(); await p.goto("https://ezto.mheducation.com/hm.tpx");
await p.locator("#hw-helper-trigger-ezto").waitFor({state:"visible",timeout:10000});
await p.locator("#hw-helper-trigger-ezto").click({force:true});

const until=async(f,ms=90000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,400));}return false;};
check("prompt sent", await until(()=>gpt.evaluate(()=>!!window.__prompt)));
const prompt = await gpt.evaluate(()=>window.__prompt);
const q = prompt.split("\n").find(l=>l.startsWith("Question:"))||"";

check("stem includes the loan details, not just the table row",
  /2,700,000/.test(q) && /16,800/.test(q), q.slice(0,90));
check("stem includes both parts", /APR/.test(q) && /EAR/.test(q));
check("page furniture kept out", !/Check my work|eBook|Prev|of 26|Reading the question/.test(q), q.slice(-70));
check("both boxes listed with labels",
  /1\. .*[Aa]nnual percentage rate/.test(prompt) && /2\. .*[Ee]ffective annual rate/.test(prompt),
  (prompt.split("Boxes to fill, in order:")[1]||"").split("\n").slice(1,3).join(" | "));
check("asks for bare numbers", /no units, percent sign/.test(prompt));

check("first box filled", await until(()=>p.locator("#apr").inputValue().then(v=>v==="6.13")),
  await p.locator("#apr").inputValue());
check("second box filled", await until(()=>p.locator("#ear").inputValue().then(v=>v==="6.30")),
  await p.locator("#ear").inputValue());
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
