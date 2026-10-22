# Essay Grader

A desktop tool that takes **photos** of student essays and automates **recognition → review → rubric-based grading → export**.
Built for middle- and high-school Chinese-language teachers. Windows desktop. **No API key, no sign-up, no cost.**

> This repository has two tracks:
> - **`desktop/` (v2, recommended)** — rewritten in Electron + Node.js on free OpenCode Zen models. Double-click and go.
> - **`src/` (v1, legacy)** — the old .NET 8 / WinUI3 build, which depended on the paid StepFun API. Kept for reference, no longer maintained.

---

## Why the rewrite

The old build asked teachers to apply for a StepFun API key themselves, fill in the BaseUrl themselves, and pay for usage themselves.
Both barriers sat in "configuration" and "cost" — precisely the two things the target user (8 GB laptop, 10th-gen Core i5, never opens a log file) is least equipped to deal with.

v2 removes both at once:

| | v1 (.NET 8) | v2 (Electron) |
| --- | --- | --- |
| Model source | StepFun `step-3.7-flash`, your own key, pay per use | OpenCode Zen free models, **zero setup, zero cost** |
| Runtime | .NET 8 runtime + WinUI3 | None (Electron ships its own) |
| Install | Manual deployment / compile it yourself | One NSIS installer, click Next |
| Engine | Direct calls to the cloud API | `opencode.exe` + a local proxy bundled in the installer, serving on `127.0.0.1` |
| Prompts | Three generic prompts | Three rewritten prompts: faithful recognition / four-state review / grading that quotes the essay |
| Fallback | None | Switches to a backup model automatically when the primary fails (MiniMax M3.1 Flash) |

---

## Features

- **Batch import**: drag in or pick images (`jpg/jpeg/png/bmp/webp`); several pages of one essay are merged in filename order.
- **Sentence-level recognition**: the multimodal model returns the title, author, sentence-by-sentence body text, confidence, and paragraph membership.
- **Human review**: the original image on the left, editable sentences on the right; four-state markers (normal / student slip / OCR fix / needs verification).
- **Slips**: **recorded only, never rewritten** — a student's misspelling is exactly what the teacher has to mark, so the app never corrects work on the student's behalf.
- **Rubric-based grading**: two built-in templates — middle-school narrative (50 points) and high-school argumentative (60 points) — plus custom dimensions, point values, and grade thresholds.
- **Result page**: total score + level + per-dimension breakdown + what worked / what to improve / how to practise next (all quoting the essay) + a slip list.
- **Export**: Markdown / Word (`docx`, A4 layout) / PDF, one essay at a time or all of them in one click.
- **Readable offline**: essays and photos are stored locally under `%APPDATA%\essay-grader` and survive an uninstall.

---

## Quick start (users)

1. Download `essay-grader-setup-2.0.0.exe` from [Releases](../../releases).
2. Double-click to install (installs into the current user's profile by default; no administrator rights needed).
3. Open it, then: drop in essay photos → click "Start grading" → wait 30–60 seconds → open the result → export to Word.

For the full walkthrough (including "check the text before grading"), see [`desktop/README.md`](desktop/README.md).

## Quick start (development)

```powershell
# 1. Front-end dependencies
cd desktop
npm install
node node_modules\electron\install.js   # needed by hand when npm 11 blocks install scripts

# 2. Local engine: opencode binary + proxy
#    opencode.exe  → desktop\..\bin\opencode.exe
#    opencode2api  → desktop\..\opencode2api\ (git clone, then npm install)
#    or just run tools\setup-backend.ps1, which prepares both

# 3. Start the dev build
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
npm start
```

Build the installer:

```powershell
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR = "https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist     # output: desktop\dist\essay-grader-setup-2.0.0.exe
```

---

## Architecture

```
┌───────────────────────────────── Electron main process ──────────────────────────────────┐
│  main.js      window / IPC / export / app-media protocol                                 │
│  backend.js   engine: pick a free port, isolate XDG dirs, spawn proxy, poll /health      │
│  runner.js    queue + three-stage orchestration, progress events to the renderer         │
│  ai.js        OpenAI-compatible calls, JSON extraction, model fallback, typo guard       │
│  prompts.js   recognition / review / grading prompts                                     │
│  store.js     JSON storage + built-in rubric templates                                   │
│  export.js    Markdown / docx / PDF                                                      │
└─────────────────────────────────┬────────────────────────────────────────────────────────┘
                                  │ HTTP (127.0.0.1, random free port)
┌─────────────────────────────────▼────────────────────────────────────────────────────────┐
│  opencode2api (embedded Node child process, ELECTRON_RUN_AS_NODE)                        │
│      └── opencode.exe (the only supported route to OpenCode Zen free models)             │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

The renderer is a **build-free** ES Module front end (`desktop/renderer/`), loaded directly through `<script type="module">` —
no webpack, no Vite; edit and refresh.

Data flow:

```
photo → base64 data URL → multimodal recognition (per sentence + confidence)
      → plain-text review (ok / ocr_fix / author_error / verify)
      → rubric scoring (score + level + suggestions, all quoting the essay)
      → Markdown / docx / PDF
```

For details see [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## Prompt design (the core of this project)

The three prompts each counter a different failure mode:

| Stage | Failure mode | Countermeasure |
| --- | --- | --- |
| Recognition | The vision model "helpfully fixes" misspellings | Strict verbatim transcription + correct/incorrect few-shot pairs + `□` for illegible characters |
| Review | The model reinterprets "the student wrote it wrong" as "OCR read it wrong", and corrects the student's work | Four-state priority `verify → author_error → ocr_fix → ok`; the body text of an `author_error` must match the source exactly |
| Grading | Vague generalities, no quotations, dimension scores that do not add up to the total | Mandatory quotation of source sentences, 3–5 items per category, integer scores that sum to the total |

What we measured, though, is that **prompts cannot override the model's OCR prior**.
A slip such as `teh → the` is still silently normalised at the recognition stage and still judged `ocr_fix` at the review stage.
So `ai.js` adds a deterministic safety net, `onlyHanSubstitutions()`: same length with only 1–2 Han-character substitutions → always `author_error`, with the original characters kept in the body text.
Prompts handle "most of it"; code handles the "safety net". See [`docs/PROMPTS.md`](docs/PROMPTS.md) for details.

---

## Free-tier quota

- Default `opencode/deepseek-v4.1-flash-free` (200k context, image input).
- Backup `opencode/minimax-m3.1-flash-free` (1M context, image input).
- The free tier is **rate limited**: back-to-back grading occasionally waits 1–3 minutes, or returns content that cannot be parsed.
  When the primary model fails the app switches to the backup and retries once; if that also fails, press "Regrade" — recognised and reviewed text is not lost.
- Keep "essays graded at once" at 1; raising it makes rate limiting more likely.

---

## When something goes wrong

Every pothole this project hit while being built became an issue with its own write-up, in chronological order:

→ [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) · [Issues](../../issues?q=is%3Aissue)

The most common ones:

| Symptom | Where to look |
| --- | --- |
| Status stuck on "Starting engine…" | `%APPDATA%\essay-grader\engine.log`; see [#8](../../issues/25) / [#14](../../issues/31) |
| `EPERM ... opencode.exe` during packaging | Stop the running `opencode.exe` process first; see [#15](../../issues/32) |
| Student slips were corrected by the app | Fixed (the `onlyHanSubstitutions` safety net); see [#11](../../issues/28) |
| Clicking "Review" does nothing | Fixed (TDZ); see [#12](../../issues/29) |

---

## Layout

```
desktop/            v2 application (Electron)
  electron/         main process: window / engine / prompts / API calls / queue / storage / export
  renderer/         build-free front end: grading desk / review / result / rubrics / settings
  build/            afterPack hook and icons
docs/               architecture, prompts, packaging, troubleshooting
tools/              engine setup script and sample config
src/                v1 (.NET 8) legacy code
.github/            issue and PR templates, CI, release workflow
```

## License

No license has been declared yet, so all rights are reserved. If you want to reuse this work, please open an issue to reach the author.
