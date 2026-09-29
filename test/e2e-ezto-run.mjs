import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhezr-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// This platform advances with Check my work and has no confidence rating, so the
// run loop has to start on checkWork alone. One question answered is the single
// shot path; the loop is only proven by all three going by themselves.
const HW=`<!DOCTYPE html><html><body style="margin:0">
<div id="hdr">1 of 3</div>
<button id="checkbtn">Check my work</button>
<div id="stage"></div>
<div id="nav"><button id="next">Next</button></div>
<script>
const QS=[["Q1 what is 2+2?",["4","5"],0],["Q2 capital of France?",["Lyon","Paris"],1],["Q3 colour of the sky?",["Blue","Green"],0]];
let i=0; window.__events=[]; window.__asked=[];
function render(){
  const q=QS[i];
  document.getElementById("hdr").textContent=(i+1)+" of 3";
  document.getElementById("stage").innerHTML='<div class="question_text">'+q[0]+'</div>'+
    q[1].map((t,n)=>'<div class="row"><input type="radio" name="a" id="o'+n+'"><label for="o'+n+'">'+t+'</label></div>').join('');
  window.__asked.push(i+1);
}
document.getElementById("checkbtn").addEventListener("click",()=>{
  window.__events.push("check-open");
  const d=document.createElement("div"); d.id="dlg";
  d.innerHTML='<p>This is the last time you can check your work.</p><button id="cancel">Cancel</button><button id="confirm">Check my work</button>';
  document.body.appendChild(d);
  document.getElementById("confirm").addEventListener("click",()=>{
    window.__events.push("check-confirm"); d.remove();
    const sel=[...document.querySelectorAll("input[name=a]")].findIndex(r=>r.checked);
    const right = sel===QS[i][2];
    const rows=document.querySelectorAll(".row");
    if(sel>=0) rows[sel].className = "row " + (right?"correct":"incorrect");
    window.__events.push(right?"verdict-correct":"verdict-incorrect");
    const back=document.createElement("button"); back.id="back"; back.textContent="Return to question";
    document.getElementById("stage").prepend(back);
    back.addEventListener("click",()=>{ window.__events.push("returned"); back.remove(); });
  });
});
document.getElementById("next").addEventListener("click",()=>{
  window.__events.push("next"); i++; if(i<QS.length) render(); else document.getElementById("stage").innerHTML="<h3>Done</h3>";
});
render();
</script></body></html>`;

const GPT=`<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 const p=document.getElementById("prompt-textarea").innerText;
 const a=/2\\+2/.test(p)?'"A"':/France/.test(p)?'"B"':'"A"';
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": '+a+', "explanation":"x"}';
 document.getElementById("thread").appendChild(d);
 document.getElementById("prompt-textarea").innerText="";},300);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
 viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://ezto.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:HW}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:GPT}));
let sw=null; for(let i=0;i<40&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}
// no confidence rating on this platform: the loop must start on checkWork alone
await sw.evaluate(()=>chrome.storage.sync.set({autoSelect:true,checkWork:true,advance:true,confidence:"off",verify:false,images:false}));

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const p=await ctx.newPage(); await p.goto("https://ezto.mheducation.com/hm.tpx");
await p.locator("#hw-helper-trigger-ezto").waitFor({state:"visible",timeout:10000});
await p.locator("#hw-helper-trigger-ezto").click({force:true});

const until=async(f,ms=180000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,500));}return false;};

check("the run loop started rather than a single shot",
  await until(()=>p.locator("#hw-helper-trigger-ezto").textContent().then(t=>t.trim()==="Stop"), 20000),
  await p.locator("#hw-helper-trigger-ezto").textContent().catch(()=>""));

check("reached question 2 unattended",
  await until(()=>p.evaluate(()=>window.__asked.includes(2))),
  JSON.stringify(await p.evaluate(()=>window.__asked)));

check("worked through all three questions",
  await until(()=>p.evaluate(()=>window.__events.filter(e=>e==="check-confirm").length>=3)),
  JSON.stringify(await p.evaluate(()=>window.__events.filter(e=>e==="check-confirm").length)));

check("checked its work on every question",
  await p.evaluate(()=>window.__events.filter(e=>e.startsWith("verdict-")).length>=3),
  JSON.stringify(await p.evaluate(()=>window.__events)));

await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
