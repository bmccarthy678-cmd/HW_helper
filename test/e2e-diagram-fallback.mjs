import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// A genuine diagram, inside the question, that the extension cannot capture:
// the page shows it but a second fetch of it is refused. Two settings matter.
//  1. Sending diagrams on (the default): answer from the wording rather than
//     skip, since skipping on a one-question-at-a-time page went nowhere.
//  2. Sending diagrams off (left over from an older install): stop and say so,
//     instead of sitting on a red button waiting for an answer that never comes.
const DIAGRAM = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAKAAAACgCAIAAAAErfB6AAACJklEQVR4nO3OAQkAMQDEsCqZsKl7qa+iHIxCBIRzvzyM+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+i+gHokWZkT6aKpQAAAABJRU5ErkJggg==", "base64");

const SB=`<!DOCTYPE html><html><body style="height:900px">
<div class="probe-container" data-probe-id="p1">
  <div class="awd-probe-type-multiple_choice awd-probe-mode-testing">
    <div class="prompt">Using the chart, which statement is true when a &lt; b and b &lt; c?</div>
    <img src="https://images.example-cdn.com/chart.png" alt="chart">
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

const until=async(f,ms)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,400));}return false;};

async function run(settings) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhdf-"));
  const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
   viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
  let served = 0;
  await ctx.route("https://images.example-cdn.com/**", r=>{
    served += 1;
    return served === 1 ? r.fulfill({status:200,contentType:"image/png",body:DIAGRAM}) : r.abort("failed");
  });
  await ctx.route("https://learning.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:SB}));
  await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:GPT}));
  let sw=null; for(let i=0;i<40&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
  if (settings) await sw.evaluate((s)=>chrome.storage.sync.set(s), settings);

  const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
  const p=await ctx.newPage(); await p.goto("https://learning.mheducation.com/static/awd/index.html");
  await p.locator("#hw-helper-trigger").waitFor({state:"visible",timeout:10000});
  await p.evaluate(()=>{
    window.__chips=[];
    const watch=()=>{const n=document.getElementById("hw-helper-status");
      if(n){const t=n.textContent; if(t && window.__chips[window.__chips.length-1]!==t) window.__chips.push(t);}};
    new MutationObserver(watch).observe(document.body,{subtree:true,childList:true,characterData:true});
  });
  await p.locator("#hw-helper-trigger").click({force:true});
  return { ctx, p, gpt };
}

// 1. default settings
{
  const { ctx, p, gpt } = await run(null);
  const sent = await until(()=>gpt.evaluate(()=>(window.__sent||0)>0), 30000);
  const chips = await p.evaluate(()=>window.__chips||[]);
  check("default: a diagram that cannot be captured is still answered", sent, JSON.stringify(chips));
  check("default: the user is told it went without the picture",
    chips.some(t=>/answering from the question text/i.test(t)), JSON.stringify(chips));
  check("default: the answer is applied",
    sent && await until(()=>p.evaluate(()=>document.getElementById("c0").checked), 20000));
  await p.locator("#hw-helper-trigger").click({force:true}).catch(()=>{});
  await ctx.close();
}

// 2. sending diagrams switched off by an older install
{
  const { ctx, p, gpt } = await run({ images:false });
  const stopped = await until(()=>p.locator("#hw-helper-trigger").textContent().then(t=>t.trim()==="HW Helper"), 20000);
  const chips = await p.evaluate(()=>window.__chips||[]);
  check("diagrams off: the run stops instead of hanging on a red button", stopped, JSON.stringify(chips));
  check("diagrams off: it says why",
    chips.some(t=>/diagram/i.test(t) && /yourself/i.test(t)), JSON.stringify(chips));
  check("diagrams off: nothing was sent", !(await gpt.evaluate(()=>(window.__sent||0)>0)));
  await ctx.close();
}

console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
