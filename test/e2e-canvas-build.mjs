import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
import { execFileSync } from "child_process";

// Checks the Canvas-only package that scripts/build-canvas.mjs produces, as it
// would be installed: it loads cleanly, works on Canvas, has a working popup,
// and stays off every other site. The Canvas quiz suites themselves are run
// against the same package by pointing EXT_DIR at it.
const ROOT = new URL("..", import.meta.url).pathname;
execFileSync("node", [path.join(ROOT, "scripts/build-canvas.mjs")], { stdio: "ignore" });
const EXT = path.join(ROOT, "dist/canvas");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhcb-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

const PAGE = (title) => `<!DOCTYPE html><html><body style="height:900px"><h1>${title}</h1>
<div class="question_holder"><div class="display_question"><div class="question_text">What is 2+2?</div>
<label><input type="radio" name="q" id="a0">4</label><label><input type="radio" name="q" id="a1">5</label></div></div>
</body></html>`;

const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
 viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
for (const host of ["school.instructure.com","learning.mheducation.com","ezto.mheducation.com"]) {
  await ctx.route(`https://${host}/**`, r=>r.fulfill({status:200,contentType:"text/html",body:PAGE(host)}));
}

let sw=null; for(let i=0;i<40&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
check("the package installs and its worker starts", Boolean(sw));
if(!sw){ console.log("\n1 CHECK(S) FAILED"); process.exit(1); }

const swErrors=[]; sw.on("console",(m)=>{ if(m.type()==="error") swErrors.push(m.text()); });
const manifest = await sw.evaluate(()=>chrome.runtime.getManifest());
check("it is the Canvas build", manifest.name === "HW Helper for Canvas", manifest.name);
check("it asks for no McGraw Hill access",
  !JSON.stringify(manifest.host_permissions).includes("mheducation"), JSON.stringify(manifest.host_permissions));

const canvas = await ctx.newPage(); await canvas.goto("https://school.instructure.com/courses/1/quizzes/2/take");
check("button appears on a Canvas quiz",
  await canvas.locator("#hw-helper-trigger-canvas").waitFor({state:"visible",timeout:10000}).then(()=>true).catch(()=>false));

for (const url of ["https://learning.mheducation.com/static/awd/index.html","https://ezto.mheducation.com/hm.tpx"]) {
  const pg = await ctx.newPage(); await pg.goto(url); await pg.waitForTimeout(2500);
  const buttons = await pg.evaluate(()=>document.querySelectorAll("[id^='hw-helper-trigger']").length);
  check(`stays off ${new URL(url).host}`, buttons===0, `${buttons} button(s)`);
  await pg.close();
}

const id = sw.url().split("/")[2];
const popup = await ctx.newPage();
const popupErrors=[]; popup.on("pageerror",(e)=>popupErrors.push(e.message));
await popup.goto(`chrome-extension://${id}/popup/settings.html`); await popup.waitForTimeout(1200);
check("popup opens without errors", popupErrors.length===0, popupErrors.join(" | "));
check("popup shows the two settings",
  await popup.evaluate(()=>!!document.getElementById("assistant") && !!document.getElementById("verify")));
await popup.selectOption("#assistant","gemini"); await popup.waitForTimeout(400);
check("popup saves a change",
  (await sw.evaluate(()=>chrome.storage.sync.get("assistant"))).assistant==="gemini");

check("no worker errors", swErrors.length===0, swErrors.join(" | "));
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
