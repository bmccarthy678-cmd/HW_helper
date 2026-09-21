# HW Helper

A Chrome extension (Manifest V3) that transfers a question from McGraw Hill's
Smartbook to an AI assistant and then uses the response to auto-select an answer.

## Supported sites

| Site | Role |
| --- | --- |
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

## Project layout

```
manifest.json                            Extension manifest (MV3)
background/background.js                 Service worker — message routing between tabs
content-scripts/mheducation.js           Smartbook question capture / answer selection
content-scripts/ezto-mheducation.js      EZTO question capture / answer selection
content-scripts/shared/prompt-builder.js Shared prompt construction for AI tabs
content-scripts/chatgpt.js               ChatGPT adapter
content-scripts/gemini.js                Gemini adapter
content-scripts/deepseek.js              DeepSeek adapter
popup/settings.{html,css,js}             Settings UI
assets/                                  Icons
```

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
