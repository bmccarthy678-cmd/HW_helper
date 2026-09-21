# End-to-end tests

These load the unpacked extension into Chromium and drive a full question ->
assistant -> answer round trip. The courseware and assistant pages are mocked
and served through Playwright request interception at the real URLs, so the
manifest's match patterns apply exactly as they would in normal use.

What they cover: the service worker registering, content scripts injecting,
cross-frame scraping, prompt delivery, reply parsing, and answer selection.

What they do not cover: whether the CSS selectors match the real McGraw Hill
and assistant DOMs. Those can only be checked against the live sites.

## Running

```
npm install playwright        # or use a global install
node test/e2e-direct.mjs      # Smartbook opened directly
node test/e2e-nested.mjs      # Smartbook embedded in a cross-origin frame
```

Both exit non-zero on failure.
