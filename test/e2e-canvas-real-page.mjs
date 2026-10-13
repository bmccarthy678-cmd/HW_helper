import { chromium } from "playwright";
import os from "os"; import path from "path"; import fs from "fs";
const EXT = process.env.EXT_DIR || new URL("..", import.meta.url).pathname;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hwhcrp-"));
let failures=0; const check=(n,ok,x="")=>{console.log(`${ok?"PASS":"FAIL"}  ${n}${x?"  -> "+x:""}`);if(!ok)failures++;};

// A Canvas quiz as it is really used: no settings touched, a school logo in the
// header that the extension cannot fetch, a tracker frame that never finishes
// loading, and several questions of different kinds down one page. These are
// the conditions that froze SmartBook; Canvas has to come through all of them.
const LOGO = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAKAAAACgCAIAAAAErfB6AAACJklEQVR4nO3OAQkAMQDEsCqZsKl7qa+iHIxCBIRzvzyM+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+iYj6IivkgKuaDqJgPomI+iIr5ICrmg6iYD6JiPoiK+SAq5oOomA+i+gHokWZkT6aKpQAAAABJRU5ErkJggg==", "base64");

const QUIZ=`<!DOCTYPE html><html><body style="margin:0">
<header id="header"><img src="https://images.example-cdn.com/school-logo.png" alt="School"></header>
<iframe src="https://school.instructure.com/tracker.html" width="10" height="10"></iframe>
<div id="questions">
 <div class="question_holder"><div class="display_question" id="question_1">
  <div class="question_text">What is 2 + 2?</div>
  <label><input type="radio" name="q1" id="q1a">4</label>
  <label><input type="radio" name="q1" id="q1b">5</label>
 </div></div>
 <div class="question_holder"><div class="display_question" id="question_2">
  <div class="question_text">Select every prime number.</div>
  <label><input type="checkbox" id="q2a">2</label>
  <label><input type="checkbox" id="q2b">4</label>
  <label><input type="checkbox" id="q2c">7</label>
 </div></div>
 <div class="question_holder"><div class="display_question" id="question_3">
  <div class="question_text">What is the capital of France?</div>
  <label><input type="radio" name="q3" id="q3a">Lyon</label>
  <label><input type="radio" name="q3" id="q3b">Paris</label>
 </div></div>
</div>
<button id="submit_quiz_button" type="button" onclick="window.__submitted=true">Submit Quiz</button>
</body></html>`;

const TRACKER=`<!DOCTYPE html><html><head><script src="https://school.instructure.com/never-arrives.js"></script></head><body></body></html>`;

const GPT=`<!DOCTYPE html><html><body><div id="thread"></div>
<div id="prompt-textarea" contenteditable="true"></div>
<button data-testid="send-button">Send</button><script>
window.__sends=0;
document.querySelector("[data-testid='send-button']").addEventListener("click",()=>{
 window.__sends++;
 const p=document.getElementById("prompt-textarea").innerText;
 const a=/2 \\+ 2/.test(p)?'"A"':/prime/.test(p)?'["A","C"]':'"B"';
 setTimeout(()=>{const d=document.createElement("div");
 d.setAttribute("data-message-author-role","assistant");
 d.textContent='{"answer": '+a+', "explanation":"ok"}';
 document.getElementById("thread").appendChild(d);
 document.getElementById("prompt-textarea").innerText="";},300);});
</script></body></html>`;

const ctx=await chromium.launchPersistentContext(dir,{channel:"chromium",headless:true,
 viewport:{width:1200,height:900},args:[`--disable-extensions-except=${EXT}`,`--load-extension=${EXT}`]});
let logo=0;
await ctx.route("https://images.example-cdn.com/**", r=>{ logo+=1; return logo===1
  ? r.fulfill({status:200,contentType:"image/png",body:LOGO}) : r.abort("failed"); });
await ctx.route("https://school.instructure.com/never-arrives.js", ()=>{});
await ctx.route("https://school.instructure.com/tracker.html", r=>r.fulfill({status:200,contentType:"text/html",body:TRACKER}));
await ctx.route("https://school.instructure.com/courses/**", r=>r.fulfill({status:200,contentType:"text/html",body:QUIZ}));
await ctx.route("https://chatgpt.com/**",r=>r.fulfill({status:200,contentType:"text/html",body:GPT}));
let sw=null; for(let i=0;i<40&&!sw;i++){sw=ctx.serviceWorkers()[0]||null; if(!sw) await new Promise(r=>setTimeout(r,500));}
if(!sw){console.log("NO SW");process.exit(1);}

const gpt=await ctx.newPage(); await gpt.goto("https://chatgpt.com/");
const q=await ctx.newPage();
await q.goto("https://school.instructure.com/courses/1/quizzes/2/take", { waitUntil: "domcontentloaded" });
await q.locator("#hw-helper-trigger-canvas").waitFor({state:"visible",timeout:15000});
await q.locator("#hw-helper-trigger-canvas").click({force:true});

const until=async(f,ms)=>{const e=Date.now()+ms;while(Date.now()<e){if(await f().catch(()=>false))return true;await new Promise(r=>setTimeout(r,500));}return false;};
const chip=()=>q.locator("#hw-helper-status-canvas").textContent().catch(()=>"");

check("the whole quiz runs to the end", await until(()=>chip().then(t=>/Done\./.test(t)), 120000), await chip());
check("Q1 radio answered", await q.locator("#q1a").isChecked());
check("Q2 every correct checkbox ticked, the wrong one left",
  (await q.locator("#q2a").isChecked()) && (await q.locator("#q2c").isChecked()) && !(await q.locator("#q2b").isChecked()));
check("Q3 radio answered", await q.locator("#q3b").isChecked());
check("each question asked once", (await gpt.evaluate(()=>window.__sends))===3, `sends=${await gpt.evaluate(()=>window.__sends)}`);
check("reports all three answered", /Answered 3 questions/.test(await chip()), await chip());
check("the logo was not taken for a diagram", !/diagram/i.test(await chip()), await chip());
check("the quiz was NOT submitted", !(await q.evaluate(()=>!!window.__submitted)));

await ctx.close();
console.log(`\n${failures===0?"ALL CHECKS PASSED":failures+" CHECK(S) FAILED"}`);
process.exit(failures===0?0:1);
