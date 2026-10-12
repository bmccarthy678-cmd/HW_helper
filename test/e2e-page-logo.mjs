import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhlogo-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// A real SmartBook page has large pictures that are not part of the question:
// the publisher's logo in the header, cover art, avatars. Served from another
// domain without CORS headers, they cannot be fetched or drawn to a canvas.
// One of them used to mark every question as a "diagram" question; the capture
// failed, the worker reported the question skipped, and the SmartBook run loop,
// which never handled "skipped", waited on an answer that was never coming.
const LOGO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAKAAAACgCAIAAAAErfB6AAACJklEQVR4nO3OAQkAMQDEsCqZsKl7qa+iHIxCBIRzvzyM+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+i+gHokWZkT6aKpQAAAABJRU5ErkJggg==", "base64");

const SB=`<!DOCTYPE html><html><body style="height:900px">
<header><img src="https://images.example-cdn.com/logo.png" alt="McGraw Hill"></header>
<div class="probe-container" data-probe-id="p1">
  <div class="awd-probe-type-multiple_choice awd-probe-mode-testing">
    <div class="prompt">Which statement is true when a &lt; b and b &lt; c?</div>
    <label><input type="radio" name="q" id="c0"><span class="choiceText">a &lt; c</span></label>
    <label><input type="radio" name="q" id="c1"><span class="choiceText">a &gt; c</span></label>
  </div>
</div></body></html>`;

const GPT=`<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 window.__sent=(window.__sent||0)+1;
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": "A", "explanation":"transitive"}';
 document.getElementById("thread").appendChild(d);},300);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
 viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
// no Access-Control-Allow-Origin: the page can show it but not read it
let logoServed = 0;
await ctx.route("https://images.example-cdn.com/**", r=>{
  logoServed += 1;
  return logoServed === 1
    ? r.fulfill({status:200,contentType:"image/png",body:LOGO})
    : r.abort("failed");
});
await ctx.route("https://learning.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:SB}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:GPT}));
let sw=null; for(let i=0;i<40&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}
// whatever a fresh install does: no settings stored at all

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const p=await ctx.newPage(); await p.goto("https://learning.mheducation.com/static/awd/index.html");
await p.locator("#hw-helper-trigger").waitFor({state:"visible",timeout:10000});
check("the logo is really on the page and large",
  await p.evaluate(()=>{const i=document.querySelector("header img");return i.complete && i.naturalWidth>=80;}));

await p.evaluate(()=>{
  window.__chips=[];
  const watch=()=>{const n=document.getElementById("hw-helper-status");
    if(n){const t=n.textContent; if(t && window.__chips[window.__chips.length-1]!==t) window.__chips.push(t);}};
  new MutationObserver(watch).observe(document.body,{subtree:true,childList:true,characterData:true});
});
await p.locator("#hw-helper-trigger").click({force:true});

const until=async(f,ms)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,400));}return false;};

const sent = await until(()=>gpt.evaluate(()=>(window.__sent||0)>0), 30000);
check("the question reaches the assistant despite the logo", sent,
  JSON.stringify(await p.evaluate(()=>window.__chips||[])));
check("the answer is applied",
  sent && await until(()=>p.evaluate(()=>document.getElementById("c0").checked), 20000));
const chips = await p.evaluate(()=>window.__chips||[]);
check("the logo was not treated as the question's diagram",
  !chips.some(t=>/diagram/i.test(t)), JSON.stringify(chips));

await p.locator("#hw-helper-trigger").click({force:true}).catch(()=>{});
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
