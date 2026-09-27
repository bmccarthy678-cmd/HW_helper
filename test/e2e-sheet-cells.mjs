import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhsc-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

const OUTER=`<!DOCTYPE html><html><body style="margin:0">
<div>Chapter 6 Homework. Item 2. 0.1 points.</div>
<p>You have just purchased a new warehouse. To finance the purchase, you've arranged for a
25-year mortgage loan for 75 percent of the $2,700,000 purchase price. The monthly payment
on this loan will be $16,800.</p>
<p>a. What is the APR on this loan?</p><p>b. What is the EAR on this loan?</p>
<iframe src="https://ezto.mheducation.com/ext/common/accountingtool/1.0/atinit.html" style="width:700px;height:300px;border:0"></iframe>
</body></html>`;

// jSheet-alike: cells are <td>, only the formula bar commits, and only into the selected cell
const SHEET=`<!DOCTYPE html><html><head><style>.sr{position:absolute;width:1px;height:1px;clip:rect(0 0 0 0)}</style></head>
<body class="test-mode accountingtool_baseaccountingtool">
<div class="sr">A table has three columns. Column 1 lists account names. Values can be entered in column 2. Column 3 has percent symbol.</div>
<div id="jQuerySheet" class="jSheetParent"><div id="jSheetUI_0" class="jSheetUI accountingtool_table">
<table id="jSheet_0_0" class="jSheet"><tbody>
<tr><td id="0_table0_cell_c0_r0" class="rowHeader td-readOnly">a. Annual percentage rate</td>
    <td id="0_table0_cell_c1_r0" class="percentageTolerance response responseCell isN" tabindex="11"></td><td>%</td></tr>
<tr><td id="0_table0_cell_c0_r1" class="rowHeader td-readOnly">b. Effective annual rate</td>
    <td id="0_table0_cell_c1_r1" class="response percentageTolerance responseCell isN" tabindex="12"></td><td>%</td></tr>
</tbody></table></div></div>
<textarea id="jSheetControls_formula_0" class="jSheetControls_formula" aria-hidden="true" tabindex="-1" title="Sheet input"></textarea>
<textarea id="cell_text_format_editor" style="display:none"></textarea>
<script>
let selected=null;
document.querySelectorAll("td.responseCell").forEach(td=>{
  td.addEventListener("click",()=>{ selected=td;
    document.getElementById("jSheetControls_formula_0").value = td.textContent; });
});
const bar=document.getElementById("jSheetControls_formula_0");
bar.addEventListener("keydown",e=>{
  if(e.key==="Enter" && selected){ selected.textContent = bar.value; selected=null; bar.value=""; }
});
</script></body></html>`;

const GPT=`<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
window.__prompt="";
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 window.__prompt=document.getElementById("prompt-textarea").innerText;
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": ["6.13","6.30"], "explanation":"solve the annuity then annualise"}';
 document.getElementById("thread").appendChild(d);
 document.getElementById("prompt-textarea").innerText="";},300);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
 viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
await ctx.route("https://ezto.mheducation.com/**",(route)=>{
  const u=route.request().url();
  route.fulfill({status:200,contentType:"text/html",body: u.includes("accountingtool") ? SHEET : OUTER});
});
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:GPT}));
let sw=null; for(let i=0;i<60&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}
await sw.evaluate(()=>chrome.storage.sync.set({autoSelect:true,verify:false,checkWork:false,advance:false,confidence:"off"}));

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const p=await ctx.newPage(); await p.goto("https://ezto.mheducation.com/ext/map/index.html");
await p.locator("#hw-helper-trigger-ezto").first().waitFor({state:"visible",timeout:10000});
await p.locator("#hw-helper-trigger-ezto").first().click({force:true});

const until=async(f,ms=90000)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,400));}return false;};
check("prompt sent", await until(()=>gpt.evaluate(()=>!!window.__prompt)),
  await p.locator("#hw-helper-status-ezto").first().textContent().catch(()=>""));

const prompt=await gpt.evaluate(()=>window.__prompt);
const q=prompt.split("\n").find(l=>l.startsWith("Question:"))||"";
check("question came from the outer frame", /2,700,000/.test(q) && /16,800/.test(q), q.slice(0,70));
check("sheet cells recognised as two boxes", /2 boxes/.test(prompt),
  (prompt.split("\n").find(l=>/boxes|blank/.test(l))||"").slice(0,70));
check("cells labelled from their row headers",
  /Annual percentage rate/.test(prompt) && /Effective annual rate/.test(prompt));
check("screen-reader description excluded", !/three columns/.test(prompt));

const f = p.frameLocator("iframe");
check("first sheet cell filled",
  await until(()=>f.locator("[id='0_table0_cell_c1_r0']").textContent().then(t=>(t||"").trim()==="6.13")),
  await f.locator("[id='0_table0_cell_c1_r0']").textContent().catch(()=>"?"));
check("second sheet cell filled",
  await until(()=>f.locator("[id='0_table0_cell_c1_r1']").textContent().then(t=>(t||"").trim()==="6.30")),
  await f.locator("[id='0_table0_cell_c1_r1']").textContent().catch(()=>"?"));
await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
