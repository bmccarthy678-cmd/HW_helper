// Builds a Canvas-only copy of the extension into dist/canvas.
//
// It is generated from the same sources rather than kept as a fork, so a fix
// made to the full extension reaches this one on the next build. The manifest
// keeps only the Canvas and assistant content scripts and asks for nothing
// beyond Canvas and the assistants, so the result never runs on any other site.
//
//   node scripts/build-canvas.mjs

import fs from "fs";
import path from "path";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);
const OUT = path.join(ROOT, "dist", "canvas");

const CANVAS = "https://*.instructure.com/*";
const ASSISTANTS = [
  "https://chatgpt.com/*",
  "https://gemini.google.com/*",
  "https://chat.deepseek.com/*",
];

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));

const keep = (entry) =>
  entry.matches.some((match) => match === CANVAS || ASSISTANTS.includes(match));

const contentScripts = manifest.content_scripts.filter(keep);
if (!contentScripts.some((entry) => entry.matches.includes(CANVAS))) {
  throw new Error("manifest has no Canvas content script to build from");
}

const canvasManifest = {
  ...manifest,
  name: "HW Helper for Canvas",
  description:
    "Sends Canvas quiz questions to an AI assistant (ChatGPT, Gemini or DeepSeek) and fills in its answers.",
  host_permissions: [
    CANVAS,
    ...ASSISTANTS,
    // the popup's update check
    "https://api.github.com/*",
  ],
  content_scripts: contentScripts,
};

// everything the manifest points at, plus what the popup and worker load
const files = new Set([
  canvasManifest.background.service_worker,
  ...Object.values(canvasManifest.icons || {}),
  canvasManifest.action.default_icon,
  canvasManifest.action.default_popup,
  ...contentScripts.flatMap((entry) => entry.js),
  ...(canvasManifest.web_accessible_resources || []).flatMap((entry) => entry.resources),
  "popup/settings.css",
  "popup/settings.js",
  "assets/settings-icon.svg",
  "LICENSE",
]);

fs.rmSync(OUT, { recursive: true, force: true });

for (const file of files) {
  const from = path.join(ROOT, file);
  if (!fs.existsSync(from)) throw new Error(`missing ${file}`);
  const to = path.join(OUT, file);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

fs.writeFileSync(
  path.join(OUT, "manifest.json"),
  JSON.stringify(canvasManifest, null, 2) + "\n"
);

console.log(`Built ${path.relative(ROOT, OUT)} (v${canvasManifest.version})`);
for (const file of [...files, "manifest.json"].sort()) console.log(`  ${file}`);
