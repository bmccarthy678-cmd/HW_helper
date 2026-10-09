import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhset-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
 viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
let sw=null; for(let i=0;i<40&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}
const id = sw.url().split("/")[2];

// an older install left the automatic settings switched off
await sw.evaluate(()=>chrome.storage.sync.set({
  autoSelect:false, advance:false, confidence:"off", checkWork:false, images:false,
}));

const page = await ctx.newPage();
await page.goto(`chrome-extension://${id}/popup/settings.html`);
await page.waitForTimeout(1200);

const controls = await page.evaluate(()=>
  [...document.querySelectorAll("input,select")].map(el=>el.id).filter(Boolean));
check("only the two real choices are on screen", controls.length===2 && controls.includes("assistant") && controls.includes("verify"),
  JSON.stringify(controls));

check("no option was left wired to a missing element",
  !(await page.evaluate(()=>window.__popupError||false)),
  String(await page.evaluate(()=>window.__popupError||"")));

// opening the popup should heal the stale values rather than leave them off
const healed = await sw.evaluate(()=>chrome.storage.sync.get(
  ["autoSelect","advance","confidence","checkWork","images"]));
check("the run settings are repaired automatically",
  healed.autoSelect===true && healed.advance===true && healed.confidence==="high" &&
  healed.checkWork===true && healed.images===true,
  JSON.stringify(healed));

// and a fresh profile should already be set to run unattended
const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "hwhset2-"));
const ctx2=await chromium.launchPersistentContext(dir2,{channel:"chromium",headless:true,
 args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
let sw2=null; for(let i=0;i<40&&!sw2;i++){sw2=ctx2.serviceWorkers()[0]||null; if(!sw2) await new Promise(r=>setTimeout(r,500));}
const fresh = await sw2.evaluate(()=>chrome.storage.sync.get({
  autoSelect:true, advance:true, confidence:"high", checkWork:true, images:true,
}));
check("a fresh install needs no setup to run",
  fresh.autoSelect===true && fresh.advance===true && fresh.confidence==="high" &&
  fresh.checkWork===true && fresh.images===true,
  JSON.stringify(fresh));
await ctx2.close();

await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
