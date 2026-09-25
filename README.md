# HW Helper

A Chrome extension (Manifest V3) that transfers a question from McGraw Hill's
Smartbook to an AI assistant and then uses the response to auto-select an answer.

## Supported sites

| Site | Role |
| --- | --- |
| `*.instructure.com` | Canvas quizzes - all questions on one page |
| `learning.mheducation.com/static/awd/*` | Smartbook — question capture and answer selection |
| `ezto.mheducation.com/*` | Connect / EZTO — question capture and answer selection |
| `chatgpt.com` | AI assistant |
| `gemini.google.com` | AI assistant |
| `chat.deepseek.com` | AI assistant |

## Installation

1. Download `HW_helper.zip` from the [latest release](../../releases/latest) and unzip it,
   or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the folder containing `manifest.json`.
5. Open the extension's popup to configure which AI assistant to use.

## How it works

1. A content script on the courseware page adds an **Ask AI** button. Clicking it
   scrapes the question stem, the answer choices, and the question type.
2. `background.js` reads your chosen assistant from storage, finds or opens that
   assistant's tab, and forwards the question.
3. The assistant adapter builds a prompt with `AutoMcGraw.buildPrompt`, types it
   into the composer, sends it, and watches for the reply.
4. The reply is expected to be `{"answer": ..., "explanation": "..."}`. The adapter
   relays it back, and the courseware script selects the matching choice.

Messages on the wire:

| Message | From | To |
| --- | --- | --- |
| `askQuestion` | courseware script | background |
| `receiveQuestion` | background | assistant adapter |
| `chatgptResponse` / `geminiResponse` / `deepseekResponse` | assistant adapter | background |
| `applyAnswer`, `answerFailed` | background | courseware script |
| `checkForUpdate` | popup | background |

## Project layout

```
manifest.json                            Extension manifest (MV3)
background/background.js                 Service worker - routing, settings, update check
content-scripts/mheducation.js           Smartbook question capture / answer selection
content-scripts/ezto-mheducation.js      EZTO question capture / answer selection
content-scripts/shared/prompt-builder.js Prompt construction and HTML-safe insertion
content-scripts/chatgpt.js               ChatGPT adapter
content-scripts/gemini.js                Gemini adapter
content-scripts/deepseek.js              DeepSeek adapter
popup/settings.{html,css,js}             Settings UI
assets/                                  Icons
```

## Running a whole assignment

With **Select automatically**, a **Submit confidence** level, and **Next
Question** all enabled, the button starts a continuous run: it answers, submits,
advances, and repeats until the assignment ends. While running the button reads
**Stop** and pressing it halts after the question in flight.

The run stops by itself when no further question is found, after two consecutive
failures, if Next Question cannot be pressed, or at a 100 question safety limit.

With any of those three settings off, the button answers a single question and
waits for you, which is the better setting if you want to check the answers.

## Question types

Multiple choice and multiple select are answered by clicking. Fill in the blank
and dropdown matching are answered by typing into the fields, one value per
blank in the order they appear. Questions with several blanks ask the assistant
for an array so each value lands in the right field.

Inputs inside a header, nav or footer are ignored, as are search and filter
boxes, so the page's own controls are never mistaken for answer fields.

## Platforms

Sites come in two shapes. A **single** site shows one question at a time and has
a next control, so the run answers, submits and advances. A **page** site puts
every question on one page, so the run walks the question blocks in order,
answers each in place and never submits - you review and submit yourself.

Anything holding a diagram is skipped rather than guessed at, since only the
question's text reaches the assistant. The run reports which numbers were
skipped when it finishes.

## Matching questions

Drag and drop matching is handled too: the cards and the empty slots are found
from the page, the assistant is asked for one option per item in slot order, and
each card is dragged into place. Both a pointer drag and the HTML5 drag sequence
are sent, since courseware uses one or the other.

If the drag does not register, the status chip prints the pairing so it can be
placed by hand rather than leaving the question unanswered.

## Diagrams

A question carrying a diagram is answered rather than skipped when **Send
diagrams** is on. The image is read from the page itself - fetched from its own
source with credentials, so an image behind a login still works - and pasted
into the assistant's composer alongside the question text. An inline SVG is
rasterised first, since assistants handle pasted SVG poorly.

Nothing is screenshotted, so no capture permission is needed and the assistant
sees the diagram itself rather than a picture of the screen. If the image cannot
be read, the question is skipped with a reason instead of being answered from
its text alone.

## Double checking

With **Ask each question twice** on, every question is asked twice in separate
exchanges and the answers compared, ignoring case, spacing and the order of a
multiple answer. Matching answers are applied. Differing ones trigger a third
ask, and the majority wins. Three different answers leaves the question
unanswered and prints all three.

It roughly doubles the time per question, and agreeing twice is not the same as
being right - it catches coin flips, not settled misconceptions.

## Notes

Every answered question is recorded: the question text, the choices, which one
was picked, the assistant's reasoning, and — once the result screen renders —
whether it was marked correct, plus the correct answer when it was not.

The popup shows a running tally, including how many the assistant got right,
and exports everything as Markdown. Notes live in local extension storage and
stay until cleared.

## Settings

Open the extension's popup to choose the assistant, toggle automatic answer
selection, and choose whether the assistant tab is brought to the foreground.
Settings are stored in `chrome.storage.sync`. The popup can also check
`api.github.com` for a newer release.

## Selector caveat

The DOM selectors for both McGraw Hill sites and for the three assistants are
best-effort and will drift as those sites change. Each script tries several
candidate selectors and reports a readable failure in the on-page status chip
when none match. Expect to update the selector lists over time.

## Releases

Pushing a change to `manifest.json` on `main` triggers
[`.github/workflows/release.yml`](.github/workflows/release.yml). The workflow compares the
manifest `version` against the latest git tag and, when they differ, packages the extension
into `HW_helper.zip` and publishes a GitHub release tagged `v<version>`.

## Disclaimer

This project is provided for educational purposes. Using it to complete graded coursework may
violate your institution's academic integrity policy. Use it at your own risk. It is not
affiliated with or endorsed by McGraw Hill.

## License

[MIT](LICENSE) © 2024 ctmcc
