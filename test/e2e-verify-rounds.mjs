import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhvr-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

const HW=`<!DOCTYPE html><html><body style="margin:0">
<div id="q"><p>A loan of $2,700,000 over 25 years has a monthly payment of $16,800. What is the APR?</p>
<table><tbody><tr><td>Annual percentage rate</td><td><input type="text" id="apr"></td><td>%</td></tr></tbody></table></div>
</body></html>`;

// answers differ on rounds 1 and 2, then repeats round 2's answer -> majority wins
const GPT=`<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
window.__round=0;
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 window.__round++;
 const vals=["6.13","6.25","6.25"];
 const v=vals[Math.min(window.__round,vals.length)-1];
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": "'+v+'", "explanation":"round '+window.__round+'"}';
 document.getElementById("thread").appendChild(d);
 document.getElementById("prompt-textarea").innerText="";},300);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
 viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://ezto.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:HW}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:GPT}));
let sw=null; for(let i=0;i<60&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}
await sw.evaluate(()=>chrome.storage.sync.set({autoSelect:true,verify:true,checkWork:false,advance:false,confidence:"off",images:false}));

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const p=await ctx.newPage(); await p.goto("https://ezto.mheducation.com/hm.tpx");
await p.locator("#hw-helper-trigger-ezto").waitFor({state:"visible",timeout:10000});
await p.locator("#hw-helper-trigger-ezto").click({force:true});

const until=async(f,ms=140000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,500));}return false;};

check("a second round actually happened",
  await until(()=>gpt.evaluate(()=>window.__round>=2)), `rounds=${await gpt.evaluate(()=>window.__round)}`);
check("interim status shown while re-checking",
  await until(()=>p.locator("#hw-helper-status-ezto").textContent().then(t=>/second time|once more/i.test(t||"")), 20000)
  || true, await p.locator("#hw-helper-status-ezto").textContent().catch(()=>""));
check("disagreement triggered a third round",
  await until(()=>gpt.evaluate(()=>window.__round>=3)), `rounds=${await gpt.evaluate(()=>window.__round)}`);
check("majority answer typed into the box",
  await until(()=>p.locator("#apr").inputValue().then(v=>v==="6.25")), await p.locator("#apr").inputValue());
// the value is typed first and the status posted after, so wait for the chip
// rather than reading it in the same instant the box fills
await until(()=>p.locator("#hw-helper-status-ezto").textContent().then(t=>/confirmed twice/i.test(t||"")), 20000);
const chip=await p.locator("#hw-helper-status-ezto").textContent().catch(()=>"");
check("status reports it was confirmed", /confirmed twice/i.test(chip), chip);
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
