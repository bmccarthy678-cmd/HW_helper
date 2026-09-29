import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhstale-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// Reinstalling the extension orphans the content script already running in an
// open courseware tab: its calls into chrome.* throw "Extension context
// invalidated". Before the guard this rejected onClick silently, so the button
// looked alive and nothing was ever sent. It has to say so instead.
const SB=`<!DOCTYPE html><html><body style="height:900px">
<div data-automation-id="question-stem">Which statement is true when a &lt; b and b &lt; c?</div>
<div id="choices">
  <div data-automation-id="choice"><label for="c0">a &lt; c</label><input id="c0" type="radio" name="q"></div>
  <div data-automation-id="choice"><label for="c1">a &gt; c</label><input id="c1" type="radio" name="q"></div>
</div></body></html>`;

const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
 viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://learning.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:SB}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:"<html><body></body></html>"}));

let sw=null; for(let i=0;i<40&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}

const p=await ctx.newPage(); await p.goto("https://learning.mheducation.com/static/awd/index.html");
await p.locator("#hw-helper-trigger").waitFor({state:"visible",timeout:10000});
check("button present before the reload", true);

// reinstall the extension out from under the open tab
await sw.evaluate(()=>chrome.runtime.reload()).catch(()=>{});
await new Promise(r=>setTimeout(r,4000));

// the orphaned content script is still on the page; clicking it must not fail silently
await p.locator("#hw-helper-trigger").click({force:true});

const until=async(f,ms=30000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,400));}return false;};

const told = await until(()=>p.evaluate(()=>{
  const n=document.getElementById("hw-helper-status");
  return !!n && n.style.display!=="none" && /reload this page/i.test(n.textContent);
}));
const chip = await p.evaluate(()=>{const n=document.getElementById("hw-helper-status");return n?n.textContent:"";});
check("tells the user to reload the page instead of failing silently", told, chip);

const label = await p.locator("#hw-helper-trigger").textContent().catch(()=>"");
check("button is not left stuck on Stop", label.trim()!=="Stop", label);

await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
