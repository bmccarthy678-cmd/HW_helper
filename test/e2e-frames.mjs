import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhfr-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// Outer frame has chrome and prose but no answer boxes. The real question is nested.
const OUTER=`<!DOCTYPE html><html><body style="margin:0">
<div>Chapter 6 Homework. Complete all questions before submitting. 2 of 26.</div>
<iframe src="https://ezto.mheducation.com/inner" style="width:1000px;height:600px;border:0"></iframe>
</body></html>`;

const INNER=`<!DOCTYPE html><html><body style="margin:0">
<div id="q"><p>You have just purchased a new warehouse. To finance the purchase, you've arranged for a
25-year mortgage loan for 75 percent of the $2,700,000 purchase price. The monthly payment
on this loan will be $16,800.</p>
<p><b>a.</b> What is the APR on this loan?</p><p><b>b.</b> What is the EAR on this loan?</p>
<table><tbody>
<tr><td><b>a.</b> Annual percentage rate</td><td><input type="text" id="apr"></td><td>%</td></tr>
<tr><td><b>b.</b> Effective annual rate</td><td><input type="text" id="ear"></td><td>%</td></tr>
</tbody></table></div></body></html>`;

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
await ctx.route("https://ezto.mheducation.com/**", (route) => {
  const url = route.request().url();
  route.fulfill({status:200,contentType:"text/html",body: url.endsWith("/inner") ? INNER : OUTER});
});
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:GPT}));
let sw=null; for(let i=0;i<60&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}
await sw.evaluate(()=>chrome.storage.sync.set({autoSelect:true,verify:false,checkWork:false,advance:false,confidence:"off"}));

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const p=await ctx.newPage(); await p.goto("https://ezto.mheducation.com/hm.tpx");
await p.locator("#hw-helper-trigger-ezto").first().waitFor({state:"visible",timeout:10000});
await p.locator("#hw-helper-trigger-ezto").first().click({force:true});

const until=async(f,ms=90000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,400));}return false;};
check("prompt sent", await until(()=>gpt.evaluate(()=>!!window.__prompt)));
const prompt = await gpt.evaluate(()=>window.__prompt);

check("picked the frame holding the answer boxes", /2 boxes/.test(prompt),
  prompt.split("\n").find(l=>/boxes|blank/.test(l))||"(none)");
check("stem came from the inner frame", /2,700,000/.test(prompt),
  (prompt.split("\n").find(l=>l.startsWith("Question:"))||"").slice(0,70));
check("outer-frame chrome not used as the question", !/Complete all questions before submitting/.test(prompt));

const frame = p.frameLocator("iframe");
check("first box filled", await until(()=>frame.locator("#apr").inputValue().then(v=>v==="6.13")),
  await frame.locator("#apr").inputValue().catch(()=>"?"));
check("second box filled", await until(()=>frame.locator("#ear").inputValue().then(v=>v==="6.30")),
  await frame.locator("#ear").inputValue().catch(()=>"?"));
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
