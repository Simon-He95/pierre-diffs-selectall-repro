# `@pierre/diffs` — select-all then typing keeps the previous document

Minimal repro for [pierrecomputer/pierre#1338](https://github.com/pierrecomputer/pierre/issues/1338).

`@pierre/diffs` auto-surrounds **any** non-collapsed selection, including one that
spans the whole document. After `cmd/ctrl+A`, typing `{` produces
`{<whole document>}` instead of replacing the selection, and the caret is then
placed just after the inserted opener — so every following character is inserted
near the start of the buffer while the original content stays.

The result is a corrupted document that cannot be recovered by continuing to
type. In a JSON editor it fails to parse; a host that saves the buffer would
store it as-is.

This repo uses **only** `@pierre/diffs` — no wrapper, no framework, no diff view.
A plain `File` component with an `Editor` attached.

## Run

```bash
npm install
npx playwright install chromium   # skip if a browser is already available
npm run build
npm run repro
```

`npm run repro` serves the build, drives it with real keyboard events, and reads
back the editor's model (from `onChange`, not from the rendered rows).

To use an existing Chromium binary instead of Playwright's download:

```bash
CHROME_PATH=/path/to/chrome npm run repro
```

## What it shows

```
=== default autoSurround (10-line document) ===
change events:   7
model after typing "{\"b\":2}":
"{\"b\":2}\"}"
replaced exactly: false
valid JSON:       false

=== default autoSurround (10-line document) ===
change events:   1
model after typing "{":
"{[
  {
    \"role\": \"user\",
...
]}"
replaced exactly: false
valid JSON:       false

=== autoSurround: 'never' (10-line document) ===
change events:   7
model after typing "{\"b\":2}":
"{\"b\":2}"
replaced exactly: true
valid JSON:       true
```

Three cases:

1. **default, type `{"b":2}`** — stale text survives the edit; not valid JSON.
2. **default, type `{` alone** — wraps the whole document: the model grows by one
   character and keeps its entire previous contents.
3. **`autoSurround: 'never'`, type `{"b":2}`** — replaces correctly.

Case 2 is the clearest statement of the bug: one keystroke should replace a
selection, and instead it brackets it. It is deterministic.

Case 1 is the same defect seen through a run of keystrokes, and **how much stale
text survives varies between runs**: reproductions have produced both a short
tail (`{"b":2}"}`) and the whole previous document
(`{"b":2}[…original…]}`). The difference is where the following keystrokes land
relative to the wrapped range, so treat the amount as timing-dependent and the
"not replaced" verdict as the invariant. Case 3 has been deterministic in every
run.

The script exits non-zero while cases 1 and 2 fail; once the default is fixed it
should exit zero. That makes it usable as a regression check.

## Files

- `main.js` — creates a `File`, renders it, attaches an `Editor`. `?autoSurround=never`
  switches the option under test.
- `repro.mjs` — static server + Playwright driver + assertions.
- `index.html` — the two mount points.

## Notes

- Verified against `@pierre/diffs` **1.7.1** on Chromium (headless), macOS, from a
  fresh clone of this repo.
- `File` is the non-virtualized file surface: `rows rendered == document lines`
  here, so this is unrelated to virtualized surfaces.
- The host app that surfaced this does pass `autoSurround: 'never'` as a
  mitigation, but the default remains surprising for any host that does not.
