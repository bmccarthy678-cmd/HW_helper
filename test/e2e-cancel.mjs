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

const sendsNow = () => gpt.evaluate(()=>window.__sends);
const picked = async () =>
  `o0=${await p.locator("#o0").isChecked()} o1=${await p.locator("#o1").isChecked()}`;
const nothingPicked = async () =>
  !(await p.locator("#o0").isChecked()) && !(await p.locator("#o1").isChecked());

// 1. Stop straight away, while the page is most likely still being read. The
// question must not be filled in, whether or not it had reached the assistant.
await btn.click({force:true});
check("button returns to HW Helper after cancelling",
  await until(()=>btn.textContent().then(t=>t==="HW Helper"), 8000), await btn.textContent());
check("status says it stopped",
  await until(()=>p.locator("#hw-helper-status-ezto").textContent().then(t=>/stopped/i.test(t||"")), 10000),
  await p.locator("#hw-helper-status-ezto").textContent().catch(()=>""));
await new Promise(r=>setTimeout(r,11000));
check("an early cancel fills nothing in", await nothingPicked(), await picked());
check("pending request cleared in the worker",
  await sw.evaluate(async()=>!(await chrome.storage.session.get("pendingRequest")).pendingRequest));

// 2. Start again, wait until the question has really gone to the assistant,
// then stop. Its reply arrives afterwards and must be thrown away.
const before = await sendsNow();
await btn.click({force:true});
check("can be restarted after cancelling",
  await until(async()=>(await sendsNow()) > before, 25000), `sends=${await sendsNow()}`);
await btn.click({force:true});
check("stopped again while waiting for the reply",
  await until(()=>btn.textContent().then(t=>t==="HW Helper"), 8000), await btn.textContent());
await new Promise(r=>setTimeout(r,11000));
check("the late reply did not select anything", await nothingPicked(), await picked());

// 3. And after all that it still works normally.
const last = await sendsNow();
await btn.click({force:true});
check("a run after two cancels still reaches the assistant",
  await until(async()=>(await sendsNow()) > last, 25000), `sends=${await sendsNow()}`);
check("and its answer is applied",
  await until(()=>p.locator("#o0").isChecked(), 20000), await picked());
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
