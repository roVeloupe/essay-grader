# Changelog

All notable changes to this project are documented here, following the format of [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/),
and the version numbers follow [SemVer](https://semver.org/lang/zh-CN/).

## [2.0.0] - 2026-10-22

A ground-up rewrite: .NET 8 / WinUI3 + the paid StepFun API → Electron / Node.js + free OpenCode Zen models.
The goal changed from "it runs" to "a teacher gets an installer and can just use it — no configuration, no payment".

### Added

- **Desktop app (Electron 33)**: frameless window, dark theme, three-page sidebar (grading desk / rubrics / settings).
- **Embedded engine**: `opencode2api` and `opencode.exe` ship inside the installer; on startup the app picks a free port,
  launches the proxy under `ELECTRON_RUN_AS_NODE`, and polls `/health`, with engine data isolated under `%APPDATA%\essay-grader\opencode`.
- **Three-stage pipeline**: per-page OCR → plain-text review → grading against the rubric, with progress events pushed to the UI in real time.
- **Manual review page**: original image on the left, editable sentences on the right, four-state markers (`ok` / `ocr_fix` / `author_error` / `verify`),
  changes auto-saved with a 500 ms debounce, and a "grade current text" action that overwrites an older result.
- **Slip list**: `author_error` items are **recorded only and never rewrite the body text**, and are listed separately on export so the app never corrects work on the student's behalf.
- **Rubric templates**: built-in middle-school narrative (50 points: content 20 / structure 10 / language 15 / handwriting 5) and
  high-school argumentative (60 points: thesis 20 / argument 20 / structure 10 / language 10), with custom dimensions, point values, and grade thresholds.
- **Export**: Markdown, Word (docx, A4 table + a large score figure), PDF (hidden window `printToPDF`), plus one-click export of everything.
- **Backup-model fallback**: `withFallback()` in `ai.js` switches to
  `opencode/minimax-m3.1-flash-free` and retries once when the primary model fails (rate limit / timeout / invalid JSON); the result page records which model was actually used.
- **Packaging**: electron-builder + NSIS; `build/afterPack.cjs` copies the whole `opencode2api` directory (including `node_modules`) into
  `resources\backend\opencode2api`; the installer is 121.4 MB and needs no administrator rights.
- **Documentation**: README, architecture notes, prompt design, packaging and troubleshooting, issue/PR templates, CI and release workflows.

### Changed

- All prompts rewritten (`desktop/electron/prompts.js`):
  - Recognition stage: verbatim transcription, misspellings preserved as written, `□` for illegible characters, backed by correct/incorrect few-shot pairs.
  - Review stage: four-state priority `verify → author_error → ocr_fix → ok`, with the explicit rule "better that the teacher takes a second look than the app quietly fixes a child's slip".
  - Grading stage: mandatory quotation of source sentences, 3–5 items per category, integer dimension scores that sum to the total.
- Storage moved from SQLite to a single `store.json` plus a `papers/<id>/` directory, which makes backup and debugging straightforward.
- Default model `opencode/deepseek-v4.1-flash-free`; default backup model `opencode/minimax-m3.1-flash-free`.

### Fixed

- Vision model "auto-correcting" student misspellings (`teh → the`, `adn → and`) —
  prompts alone cannot reverse the OCR prior, so `onlyHanSubstitutions()` adds a deterministic rule: identical length with 1–2 Han-character substitutions is always `author_error`.
- The review stage classifying a student slip as `ocr_fix` and rewriting the body text (same root cause).
- Result-page feedback rendering one character per line: `.feedback-item` used `grid-template-columns:16px 1fr` against a single child node; switched to `display:block`.
- Scores not refreshing after "regrade" on the result page: `onProgress` now calls `reloadPapers()` for the current route on `done/error` and then `go('result')`.
- Clicking the review page doing nothing: `chip()` in `review.js` ran before the `let only` declaration and hit a TDZ `ReferenceError`;
  `renderView()` also gained a try/catch plus global `error` / `unhandledrejection` reporting.
- Grade rows in the rubrics page mis-aligning across five columns: added `.level-edit-row` (130px / 72px / 72px / 1fr / 30px).
- Packaged builds stuck on "starting engine" forever: ① `extraResources` does not copy `node_modules` → `afterPack` fills it in;
  ② `backend.js` appended `resources` again inside the asar → now uses `path.dirname(appDir)`.
- App exiting immediately on launch: an inherited `ELECTRON_RUN_AS_NODE=1` turned `electron.exe` into a node process; the variable is now cleared before launch.
- Settings page still showing Big Pickle as the backup model: `load()` in `store.js` gained a migration that rewrites the stale `opencode/big-pickle` value (text-only, recognition always fails) to MiniMax.

### Removed

- The StepFun API key / BaseUrl / reasoning-effort settings that users had to fill in by hand.
- The paid model call path (v1's `StepFunClient.cs` remains in `src/` as historical reference).

---

## Development timeline (2026-10-22, local time UTC+8)

| Time | Event |
| --- | --- |
| 20:33 | Cloned the old repository; confirmed v1 was .NET 8 + a paid StepFun path |
| 20:41 | Installed opencode-ai 1.19.0 and opencode2api; the proxy came up on `127.0.0.1:10000` |
| 20:52 | Confirmed 11 free models work with zero credentials; found PowerShell garbling Chinese output (an encoding problem) |
| 21:03 | A direct call to `opencode.ai/inference` returned 403 `FreeTierError`, establishing that calls must go through `opencode.exe` |
| 21:18 | v2 skeleton complete (main process / engine / prompts / renderer) |
| 21:24 | First end-to-end run: recognition 5.7s, review 4.8s, grading 14.9s; 32/60 on the 60-point rubric |
| 21:31 | A photographed mock exam reported "0 student slips" → traced to OCR normalisation plus review misclassification |
| 21:38 | Added the `onlyHanSubstitutions()` safety net; the slip path worked end to end (both misspellings correctly reported as `author_error`) |
| 21:52 | Fixed the review-page TDZ, the result-page refresh and the feedback layout; verified with per-page screenshots |
| 22:07 | First successful package (121 MB NSIS), but the packaged app's engine would not start |
| 22:16 | Traced it to missing `node_modules` plus asar path concatenation; after the fix the packaged app scored 31/50 and 36/50 |
| 22:24 | Verified that Markdown / Word / PDF exports actually landed on disk |
| 22:31 | Switched the backup model to MiniMax M3.1 Flash (valid JSON in 21.4s), added config migration and the settings-page dropdown |
| 22:40 | Rebuilt the installer at 121.4 MB; wrote the README and this document |
