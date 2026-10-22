# Essay Grader (desktop)

Photograph a student essay and the app takes it through **recognition → review → rubric-based grading → export** automatically.
A Windows desktop app for middle- and high-school Chinese-language teachers: **no API key, no sign-up, no cost**.

---

## 1. Installation

1. Double-click `essay-grader-setup-2.0.0.exe`.
2. Choose an install location (the default is the current user's profile; no administrator rights needed).
3. When installation finishes, an "Essay Grader" icon appears on the desktop — double-click it to start.

> The installer is about 120 MB, of which 60 MB is the embedded OpenCode engine (the runtime the free models go through).
> A first launch taking about 5–15 seconds on a thin laptop with a spinning disk is normal.

## 2. First run (three steps)

1. **Import**: drag essay photos into the window, or click "Import images" in the top-right corner.
   Select all pages of the same essay **in one go**; the app merges them into a single essay in filename order.
   Supports `jpg / jpeg / png / bmp / webp`.
2. **Start grading**: click "Start grading". When the status in the top-right corner becomes "**Engine ready · 10000**", the local engine is up,
   and each essay then takes about **30–60 seconds** (recognition 8s + review 5s + grading 20–40s, depending on how busy the free models are at the time).
3. **Review and export**: when grading finishes, click the row to open the result page, where you can "Export Word / Markdown";
   "Export all" in the top-right corner of the grading desk exports several essays at once.

## 3. Check the text before grading (important)

Click "**Review**" on a row to open the "Recognition and review" page:

- The original image is on the left and the sentence-by-sentence result on the right; click a sentence to correct a character and it saves automatically.
- Sentences marked **student slip** mean the student's own page was already wrong there (for example `teh` → `the`).
  The app **records it without rewriting the body text**, keeps the child's original characters, and puts it in the "Student slips" list on export.
- Sentences marked **needs verification** mean the handwriting was unclear and recognition is not confident; check them against the original image and then click "Verified".

Once everything looks right, click "**Grade current text**" in the top-right corner; the result overwrites the previous score.

## 4. Rubrics

The "Rubrics" page in the sidebar ships with two built-in templates:

| Template | Level | Total | Dimensions |
| --- | --- | --- | --- |
| Middle-school narrative | Middle school | 50 | Content 20 / Structure 10 / Language 15 / Handwriting 5 |
| High-school argumentative | High school | 60 | Thesis 20 / Argument 20 / Structure 10 / Language 10 |

You can duplicate a built-in template and adapt it to your school's standard (dimension names, point values, scoring criteria, and grade thresholds are all editable).
Then pick it under "Settings → Default rubric" and newly imported essays will use it.

## 5. Free tier and rate limits

- It runs on **OpenCode Zen free models** (default `DeepSeek V4.1 Flash`) and consumes no paid quota.
- The free tier is **rate limited**: back-to-back grading sometimes waits 1–3 minutes, or throws a timeout-style message such as "the model did not return JSON".
  When that happens, **wait a moment and press "Regrade"**; recognised and reviewed content is not lost.
- Keep "essays graded at once" under "Settings" at **1**. Raising it makes rate limiting more likely and ends up slower.

## 6. Where the files are

| Content | Location |
| --- | --- |
| Exported essays | `Documents\Essay Grading` by default (changeable in settings; click "Choose" to pick another directory) |
| Essay data and photos | `%APPDATA%\essay-grader\` (`store.json` + `papers\`) |
| Engine logs | `%APPDATA%\essay-grader\engine.log`, `backend.log` |
| Engine data (isolated) | `%APPDATA%\essay-grader\opencode\` |

Uninstalling does not delete `%APPDATA%\essay-grader`, so essays survive a reinstall; delete that folder by hand to remove everything.

## 7. FAQ

**1. The top-right corner stays on "Starting engine…"**
Wait 30 seconds; if it still has not moved, close and reopen the app. If that does not help, look at `%APPDATA%\essay-grader\engine.log`:

- `missing opencode2api component` / `missing opencode engine` → the install is incomplete; reinstall.
- `backend exited abnormally (1)` → most likely antivirus blocked `resources\bin\opencode.exe`; allowlist it.

**2. It says "Cannot connect to the local engine (port 10000 is in use)"**
Usually the previous run did not exit cleanly. End `Essay Grader.exe` and `opencode.exe` in Task Manager, then start again;
the app also falls back to free ports such as 10001 and 10002 by itself.

**3. "The model did not return JSON"**
Free models occasionally write prose instead of JSON; the app retries 3 times automatically, and if that still fails, press "Regrade".

**4. Inaccurate recognition / student slips getting corrected**
First correct it once against the original image on the "Review" page, then use "Grade current text".
When taking the photo, keep it **straight on, evenly lit, with the handwriting filling 70%+ of the frame** — accuracy improves noticeably.

**5. Adjusting the format after a Word export**
The exported `.docx` is a standard A4 document (Microsoft YaHei), so you can change margins, add a school crest, and print straight from Word.

## 8. Running from source (development)

```bash
# Dependencies
npm install                     # installs electron and docx
node node_modules/electron/install.js   # do this by hand when npm 11 blocks install scripts

# Backend (local proxy + OpenCode engine)
# opencode2api must be at ../opencode2api and opencode.exe at ../bin/
npm start                       # dev mode (with console logs)
```

Packaging:

```bash
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run pack    # win-unpacked only (quick verification)
npm run dist    # NSIS installer
```

When packaging, `build/afterPack.cjs` copies the whole `opencode2api` directory (including `node_modules`) into
`resources\backend\opencode2api` — `extraResources` does not copy `node_modules` by default, so this patch is required.

## 9. Technical structure

```
electron/
  main.js       main process: window, IPC, export, the app-media protocol
  backend.js    starts the embedded engine (opencode2api + opencode.exe, isolated XDG data directories)
  ai.js         the three calls (OCR / review / grading), with JSON extraction and the deterministic slip safety net
  prompts.js    the three prompts (faithful recognition, four-state review, grading that quotes the essay)
  runner.js     queue and stage orchestration, progress events
  store.js      JSON storage + built-in rubric templates
  export.js     Markdown / Word (docx) / PDF
renderer/       build-free ES Module front end (grading desk / review / result / templates / settings)
```

Data flow:
`image → base64 → multimodal recognition (per sentence + confidence) → plain-text review (ok/ocr_fix/author_error/verify) → rubric scoring → export`

## 10. Privacy

Every request originates on your own machine: essay photos go only to your local `127.0.0.1` engine, which forwards them to the model through the OpenCode free tier.
The app collects no analytics and never uploads essays to a server run by this project (this project has no servers).
