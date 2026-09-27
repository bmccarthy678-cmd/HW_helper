import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhdi-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// Adversarial: inputs sit in bare wrappers with no text, the table carries only a
// screen-reader description, and the sidebar is close enough to trip the nav guard.
const HW=`<!DOCTYPE html><html><head><style>
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
</style></head><body style="margin:0">
<div id="shell">
  <div id="side"><button>eBook</button><button>Hint</button><button>Print</button><button>References</button></div>
  <button id="checkbtn">Check my work</button>
  <div id="body">
    <p id="stem">You have just purchased a new warehouse. To finance the purchase, you've arranged for a
    25-year mortgage loan for 75 percent of the $2,700,000 purchase price. The monthly payment
    on this loan will be $16,800.</p>
    <p><b>a.</b> What is the APR on this loan?</p>
    <p><b>b.</b> What is the EAR on this loan?</p>
    <table>
      <caption class="sr">A table has three columns. Column 1 lists account names. Values can be entered in column 2. Column 3 has percent symbol.</caption>
      <tbody>
        <tr><td><b>a.</b> Annual percentage rate</td><td><div class="wrap"><input type="text" id="apr"></div></td><td>%</td></tr>
        <tr><td><b>b.</b> Effective annual rate</td><td><div class="wrap"><input type="text" id="ear"></div></td><td>%</td></tr>
      </tbody>
    </table>
  </div>
  <div id="nav"><button>Prev</button><span>2 of 26</span><button>Next</button></div>
</div></body></html>`;

const GPT=`<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
window.__prompt="";
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 window.__prompt=document.getElementById("prompt-textarea").innerText;
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": ["6.13","6.30"], "explanation":"x"}';
 document.getElementById("thread").appendChild(d);
 document.getElementById("prompt-textarea").innerText="";},300);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
 viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://ezto.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:HW}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:GPT}));
let sw=null; for(let i=0;i<60&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}
await sw.evaluate(()=>chrome.storage.sync.set({autoSelect:true,verify:false,checkWork:false,advance:false,confidence:"off"}));

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const p=await ctx.newPage(); await p.goto("https://ezto.mheducation.com/ext/map/index.html");
await p.locator("#hw-helper-trigger-ezto").waitFor({state:"visible",timeout:10000});
await p.locator("#hw-helper-trigger-ezto").click({force:true});

const until=async(f,ms=90000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,400));}return false;};
check("prompt sent at all", await until(()=>gpt.evaluate(()=>!!window.__prompt)),
  await p.locator("#hw-helper-status-ezto").textContent().catch(()=>""));

const prompt = await gpt.evaluate(()=>window.__prompt);
const q = (prompt.split("\n").find(l=>l.startsWith("Question:"))||"");
check("found the real question", /2,700,000/.test(q) && /16,800/.test(q), q.slice(0,80));
check("screen-reader table description excluded", !/three columns|lists account names/.test(prompt));
check("sidebar and nav excluded", !/eBook|References|of 26/.test(q));
check("knows there are two boxes", /2 boxes/.test(prompt));
check("first box filled", await until(()=>p.locator("#apr").inputValue().then(v=>v==="6.13")), await p.locator("#apr").inputValue());
check("second box filled", await until(()=>p.locator("#ear").inputValue().then(v=>v==="6.30")), await p.locator("#ear").inputValue());
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
