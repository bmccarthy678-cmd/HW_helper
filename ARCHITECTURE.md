# Browser-to-assistant automation: architecture

A pattern for a Manifest V3 Chrome extension that reads a question from one web
app, routes it to an AI assistant running in another tab, and applies the reply
back to the first page.

Nothing here is specific to a particular site. Two roles matter:

- **target** — the page holding the question and the answer controls
- **assistant** — a chat UI in another tab (ChatGPT, Gemini, DeepSeek, …)

Everything marked **[swap]** is what changes when you point this at something new.

---

## 1. Layout

```
manifest.json                       permissions and content-script matches   [swap]
background/background.js            service worker: routing + page automation
content-scripts/
  target.js                         button and status chip on the target page
  shared/prompt-builder.js          prompt construction, HTML-safe insertion
  <assistant>.js                    one adapter per assistant                [swap]
popup/settings.{html,css,js}        settings, run tally, export
```

## 2. The one decision that shapes everything

**Page reading and writing live in the service worker, not the content script.**

The worker injects a function into *every frame* with
`chrome.scripting.executeScript({ target: { tabId, allFrames: true } })`,
keeps whichever frame returned usable content, and remembers that `frameId` so
the answer is applied to the same frame the question came from.

This matters because a content script in the top frame cannot read a
cross-origin child frame, and embedded course/app players are usually nested.
A top-frame-only design fails silently on exactly the pages you care about.

The content script is then reduced to UI: a button and a status chip. It scrapes
nothing.

## 3. Request lifecycle

```
content script  --askQuestion-->  worker
                                  executeScript(scrape, allFrames)
                                  pick best frame, keep frameId
                                  buildPrompt()
                                  find or open assistant tab
                 <--receiveQuestion--
adapter          fills composer, sends, observes reply
                 --<name>Response-->  worker
                                  parseAnswer()
                                  executeScript(apply, [frameId])
                 <--status-------  worker   (outcome, advanced)
```

| Message | From → To |
|---|---|
| `askQuestion` | content script → worker |
| `receiveQuestion` | worker → adapter |
| `<name>Response` | adapter → worker |
| `status` | worker → content script |
| `assistantTimeout` | adapter → worker |
| `checkForUpdate` | popup → worker |

Give `status` a structured `outcome` field (`selected` / `failed` / `timeout` /
`manual`) rather than matching on prose. A run loop needs to branch on it.

## 4. Finding content without stable selectors

Modern apps ship hashed class names (`sc-kfPuZi`) that change between builds, so
selector lists rot. Detect by **structure** instead, with declared selectors
tried first as an optimisation.

- **Choices** — visible `input[type=radio|checkbox]`; label text from `for=`,
  a wrapping `<label>`, or the nearest small ancestor.
- **Free text** — visible `input`, `textarea`, `select`, `[contenteditable]`,
  `[role=textbox]`. Skip anything inside `header/nav/footer` and anything whose
  placeholder, label or name reads like search / filter / feedback, or you will
  type into the site's own search box.
- **Drag targets** — `[draggable="true"]` for the cards; empty, childless,
  reasonably-sized boxes for the slots.
- **Question text** — the last substantial text block *before* the first control.
  When the control sits mid-sentence, that fails; read the text from the
  control's own container instead and substitute a marker for each field.
- **Noise list** — a regex of page furniture (nav labels, progress counters,
  help links, footer text) keeps chrome out of both the question and the choices. **[swap]**

Two traps worth knowing up front:

- `element.parentElement` is `null` at a shadow-root boundary. Step to
  `getRootNode().host` or the walk stops dead.
- Cloning a node to build text drops shadow content. Walk nodes and build the
  string yourself.

## 5. Writing answers back

- **Click** — dispatch the full sequence `pointerdown, mousedown, pointerup,
  mouseup, click` at a `<label>` when one exists. A bare `.click()` on a hidden
  or styled-over input flips the DOM without the framework noticing.
- **Type** — set through the native value setter
  (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set`),
  then emit `keydown, keypress, input, keyup, change`. A controlled input reverts
  a plain assignment. Verify the value stuck and report if it did not.
- **Drag** — send a pointer drag *and* an HTML5 `dragstart/dragover/drop`
  sequence; libraries use one or the other. Treat this as best-effort and print
  the intended pairing on failure so it can be done by hand.
- **Single vs multiple** — with loose text matching, several options can match
  one answer. Click only the first unless the question is genuinely multi-select.

## 6. Assistant adapters

One file per assistant, all the same shape: **[swap]**

```js
chrome.runtime.onMessage -> "receiveQuestion"
  waitForIdle()                  // no response currently streaming
  fill composer                  // native setter for textarea, HTML for rich editors
  send                           // click when enabled, else synthetic Enter
  observe reply                  // MutationObserver + independent fallback timer
  chrome.runtime.sendMessage({ type: "<name>Response", response })
```

Three things that bite:

- **Never gate the fallback on elapsed time checked inside the observer.** If the
  reply lands fast and the DOM goes quiet, the observer never fires again and the
  question is abandoned. Drive the fallback from its own timer.
- **Report timeouts.** An adapter that gives up silently leaves the UI waiting
  forever and the pending request stranded in storage.
- **Escape before inserting into a rich-text composer.** Interpolating into
  `innerHTML` means a `<` in the question truncates the prompt silently.

Ask for a strict reply shape and parse defensively:

```
{"answer": ..., "explanation": "..."}
```

`JSON.parse` first, then regex-extract an object from surrounding prose.

## 7. State

| Store | Holds | Why |
|---|---|---|
| `storage.sync` | user settings | follows the profile |
| `storage.session` | the in-flight request | survives MV3 worker eviction |
| `storage.local` | run log | export and tally |

Do **not** keep the pending request in a module variable. MV3 workers are evicted
between events and you will lose it mid-flight. Clear it on *every* failure path,
or a late reply gets applied to the next question.

## 8. Continuous run

The loop lives in the content script, which owns the button:

```
while (running && count < CAP) {
  cycle = promise resolved by the next status message
  result = await sendMessage(askQuestion)
  if (!result.ok)            -> finished, or count a failure
  status = await race(cycle, timeout)
  if (status.outcome !== "selected") -> count a failure
  if (!status.advanced)      -> stop, cannot progress
  await gap
}
```

Non-negotiables for anything unattended:

- a **Stop** control, with `running` re-checked after every await
- a **consecutive failure limit** (2 is plenty)
- a **hard cap** on iterations
- a **watchdog** in the UI in case the worker never reports back
- **preserve single-shot mode** — deriving "run continuously" from settings is
  fine, but do not let it become the only behaviour

## 9. Logging

Record per item: prompt text, options, what was chosen, the assistant's stated
reasoning, and — if the target page grades it — the verdict and the correct
answer. Export as Markdown from the popup with a `Blob` and an `<a download>`;
this needs no `downloads` permission.

The verdict is the valuable part: it turns "the model sounded confident" into a
measured hit rate.

## 10. Testing without the live site

Load the unpacked extension into Chromium with Playwright and serve mock pages
**at the real URLs** via request interception, so manifest match patterns,
`all_frames` and cross-frame injection all resolve exactly as in production:

```js
const ctx = await chromium.launchPersistentContext(dir, {
  channel: "chromium", headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
await ctx.route("https://target.example.com/**", r => r.fulfill({ body: MOCK }));
```

Build mocks that are *adversarial*, not convenient. The ones that found real bugs:

- a controlled input that reverts unless a real `keydown` preceded `input`
- a control inside a shadow root **nested mid-sentence** in the light DOM
- the target embedded in a cross-origin iframe
- a page whose only selectors are build-hashed class names
- a multi-item run, to catch state leaking between iterations

A mock built from your own selectors proves nothing — it assumes the answer.

## 11. Porting checklist

1. `manifest.json`: host permissions and content-script matches for the new
   target and assistants. Set `all_frames: true` for the target.
2. Selector hint lists and the noise regex for the new target.
3. One adapter per assistant: composer, send button, message container,
   streaming indicator.
4. Prompt instructions per question type.
5. Submit / advance controls, if the target has them.
6. Mocks mirroring the real markup, including the adversarial cases above.
