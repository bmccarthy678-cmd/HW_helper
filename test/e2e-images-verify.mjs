import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhiv-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

const QUIZ=`<!DOCTYPE html><html><body style="margin:0">
<div class="question_holder"><div class="display_question">
<img width="320" height="220" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='220'%3E%3Crect width='320' height='220' fill='%2366aa66'/%3E%3C/svg%3E">
<div class="question_text">Examine the diagram. What type of unconformity is represented?</div>
<div><input type="radio" name="q1" id="u1"><label for="u1">Nonconformity</label></div>
<div><input type="radio" name="q1" id="u2"><label for="u2">Disconformity</label></div>
</div></div></body></html>`;

// answers "Nonconformity" twice only if it received an image; flips otherwise
const GPT=`<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
window.__pastes=0; window.__sends=0;
document.getElementById("prompt-textarea").addEventListener("paste",e=>{
  const items=e.clipboardData && e.clipboardData.files;
  if(items && items.length) window.__pastes++;
});
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 window.__sends++;
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": "A", "explanation": "granite below sandstone"}';
 document.getElementById("thread").appendChild(d);
 document.getElementById("prompt-textarea").innerText="";},300);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
 viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://ohio.instructure.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:QUIZ}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:GPT}));
let sw=null; for(let i=0;i<40&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}
await sw.evaluate(()=>chrome.storage.sync.set({autoSelect:true,images:true,verify:true}));

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const q=await ctx.newPage(); await q.goto("https://ohio.instructure.com/courses/1/quizzes/1/take");
await q.locator("#hw-helper-trigger-canvas").waitFor({state:"visible",timeout:10000});
await q.locator("#hw-helper-trigger-canvas").click({force:true});

const until=async(f,ms=140000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,500));}return false;};
check("run finished", await until(()=>q.locator("#hw-helper-status-canvas").textContent().then(t=>/Done\./.test(t||""))),
  await q.locator("#hw-helper-status-canvas").textContent().catch(()=>""));
check("diagram question answered, not skipped", await q.locator("#u1").isChecked(),
  `u1=${await q.locator("#u1").isChecked()} u2=${await q.locator("#u2").isChecked()}`);
check("an image was pasted into the composer", (await gpt.evaluate(()=>window.__pastes))>0,
  `pastes=${await gpt.evaluate(()=>window.__pastes)}`);
check("asked twice for verification", (await gpt.evaluate(()=>window.__sends))>=2,
  `sends=${await gpt.evaluate(()=>window.__sends)}`);
const chip=await q.locator("#hw-helper-status-canvas").textContent().catch(()=>"");
check("status mentions the double check", /confirmed twice/i.test(chip), chip);
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
