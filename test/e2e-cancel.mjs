import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhcx-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

const HW=`<!DOCTYPE html><html><body style="margin:0">
<p>Which statement is true when a is less than b and b is less than c? Pick the correct relation.</p>
<div><input type="radio" name="q" id="o0"><label for="o0">a is less than c</label></div>
<div><input type="radio" name="q" id="o1"><label for="o1">a is greater than c</label></div>
</body></html>`;

// deliberately slow, so there is time to cancel mid-answer
const GPT=`<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
window.__sends=0;
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 window.__sends++;
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": "A", "explanation":"late reply"}';
 document.getElementById("thread").appendChild(d);},9000);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
 viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://ezto.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:HW}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:GPT}));
let sw=null; for(let i=0;i<60&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}
await sw.evaluate(()=>chrome.storage.sync.set({autoSelect:true,verify:false,checkWork:false,advance:false,confidence:"off"}));

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const p=await ctx.newPage(); await p.goto("https://ezto.mheducation.com/hm.tpx");
const btn=p.locator("#hw-helper-trigger-ezto");
await btn.waitFor({state:"visible",timeout:10000});

await btn.click({force:true});
const until=async(f,ms=30000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,300));}return false;};

check("button shows Stop while working",
  await until(()=>btn.textContent().then(t=>t==="Stop")), await btn.textContent());
check("button stays clickable while working", await btn.isEnabled());

// cancel mid-answer
await btn.click({force:true});
check("button returns to HW Helper after cancelling",
  await until(()=>btn.textContent().then(t=>t==="HW Helper"), 8000), await btn.textContent());
check("status says it stopped",
  await until(()=>p.locator("#hw-helper-status-ezto").textContent().then(t=>/stopped/i.test(t||"")), 10000),
  await p.locator("#hw-helper-status-ezto").textContent().catch(()=>""));
check("pending request cleared in the worker",
  await sw.evaluate(async()=>!(await chrome.storage.session.get("pendingRequest")).pendingRequest));

// the late reply must not be applied
await new Promise(r=>setTimeout(r,11000));
check("late reply did not select anything",
  !(await p.locator("#o0").isChecked()) && !(await p.locator("#o1").isChecked()),
  `o0=${await p.locator("#o0").isChecked()} o1=${await p.locator("#o1").isChecked()}`);

// and it can be started again
await btn.click({force:true});
check("can be restarted after cancelling",
  await until(()=>gpt.evaluate(()=>window.__sends>=2), 25000), `sends=${await gpt.evaluate(()=>window.__sends)}`);
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
