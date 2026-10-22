# Contributing

## Environment

- Node.js ≥ 20 (developed and tested on 24)
- Windows 10/11 x64 (this project targets the Windows desktop only)
- A proxy is optional; you only need one to pull the Electron mirror when packaging

## Running it locally

```powershell
cd desktop
npm install
node node_modules\electron\install.js   # do this by hand when npm 11 blocks install scripts

# Engine dependencies (pick one)
#  A. Automatic
powershell -ExecutionPolicy Bypass -File ..\tools\setup-backend.ps1
#  B. Manual: clone opencode2api into essay-grader-rework\opencode2api,
#     and download opencode.exe to essay-grader-rework\bin\opencode.exe

$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
npm start
```

The first launch creates a data directory under `%APPDATA%\essay-grader\` and starts the embedded engine (ports from 10000 up).

## Code conventions

- The main process is CommonJS throughout (`'use strict'`); the renderer is ES Modules throughout — **no build tooling**.
- The renderer must not assemble user content with `innerHTML`; build DOM through `h()` in `js/util.js`.
- Any logic whose correctness depends on the model behaving itself needs a code-level safety net (see `onlyHanSubstitutions` in `ai.js`).
- Prompt changes must come with "why it changed" and measured results in `docs/PROMPTS.md`.

## Commit messages

`type(scope): subject`, where type is one of `feat|fix|docs|build|ci|refactor|test|chore`.
For bug fixes, spell out "symptom → root cause → how it was verified" in the body so it lines up with the issue.

## Opening an issue

- Use the template, and include the relevant excerpt from `%APPDATA%\essay-grader\engine.log` (**redact personal paths**).
- For recognition-quality problems, attach a redacted photo of the essay; without one the issue cannot be reproduced.

## Releasing

See section 6 of [`docs/PACKAGING.md`](PACKAGING.md).
