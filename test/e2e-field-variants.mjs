import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhv-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// Five blanks, each built a different way. #3 and #4 are adversarial:
//  3 = "controlled" input that reverts unless a real keydown preceded the input event
//  4 = contenteditable with role=textbox
const SMARTBOOK = `<!DOCTYPE html><html><body style="margin:0">
<div id="hdr">0 of 5</div><h2>Fill in the Blank Question</h2><div id="app"></div>
<script>
const KINDS=["plain","notype","controlled","editable","shadow"];
let i=0,done=0; window.__got=[];
function value(){
 const a=document.getElementById("app");
 if(KINDS[i]==="editable") return a.querySelector("[role=textbox]").textContent.trim();
 if(KINDS[i]==="shadow") return a.querySelector("#sh").shadowRoot.querySelector("input").value;
 return a.querySelector("input").value;
}
function render(){
 const a=document.getElementById("app"); const k=KINDS[i];
 let f="";
 if(k==="plain") f='<input type="text">';
 if(k==="notype") f='<input>';
 if(k==="controlled") f='<input type="text" id="ctl">';
 if(k==="editable") f='<div role="textbox" contenteditable="true" style="border:1px solid #999;min-width:120px;display:inline-block">&nbsp;</div>';
 if(k==="shadow") f='<div id="sh"></div>';
 a.innerHTML='<div>Variant '+k+': cash flows occur at the '+f+' of each period.</div>'+
   '<footer><button id="hi" disabled>High</button></footer>';
 if(k==="shadow"){const r=a.querySelector("#sh").attachShadow({mode:"open"});
   r.innerHTML='<input type="text">';
   r.querySelector("input").addEventListener("input",()=>{document.getElementById("hi").disabled=false;});}
 if(k==="controlled"){
   const el=document.getElementById("ctl"); let sawKey=false;
   el.addEventListener("keydown",()=>{sawKey=true;});
   el.addEventListener("input",()=>{ if(!sawKey){el.value="";} else {document.getElementById("hi").disabled=false;} });
 }
 a.querySelectorAll("input,[role=textbox]").forEach(el=>{
   el.addEventListener("input",()=>{document.getElementById("hi").disabled=false;});});
 document.getElementById("hi").addEventListener("click",()=>{
   window.__got.push(value()); done++; document.getElementById("hdr").textContent=done+" of 5";
   a.innerHTML='<div><span>Your Answer</span> <span>correct</span></div><button id="nextq">Next Question</button>';
   document.getElementById("nextq").addEventListener("click",()=>{i++; if(i<KINDS.length)render(); else a.innerHTML='<h3>Done</h3>';});});
}
render();
</script></body></html>`;

const CHATGPT = `<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": "end", "explanation": "x"}';
 document.getElementById("thread").appendChild(d);
 document.getElementById("prompt-textarea").innerText="";},350);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(userDataDir,{channel:"chromium",headless:true,
 viewport:{width:1400,height:1000},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://learning.mheducation.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:SMARTBOOK}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:CHATGPT}));
let sw=ctx.serviceWorkers()[0]||await ctx.waitForEvent("serviceworker",{timeout:15000}).catch(()=>null);
await sw.evaluate(()=>chrome.storage.sync.set({confidence:"high",advance:true,autoSelect:true}));
const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const sb=await ctx.newPage(); await sb.goto("https://learning.mheducation.com/static/awd/index.html#/");
await sb.locator("#hw-helper-trigger").waitFor({state:"visible",timeout:10000});
await sb.locator("#hw-helper-trigger").click({force:true});

const until=async(f,ms=150000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,500));}return false;};
const done = await until(()=>sb.evaluate(()=>document.getElementById("hdr").textContent==="5 of 5"));
check("all five field variants completed", done, await sb.evaluate(()=>document.getElementById("hdr").textContent));

const got = await sb.evaluate(()=>window.__got);
const kinds=["plain input","input with no type","controlled (needs keydown)","contenteditable role=textbox","shadow-root input"];
kinds.forEach((k,n)=>check(`  ${k}`, got[n]==="end", JSON.stringify(got[n])));
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
