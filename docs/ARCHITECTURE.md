# Architecture

## 1. Process model

```
essay-grader.exe (Electron main process)
├── BrowserWindow (frameless, titleBarOverlay 36px)
│   └── renderer/index.html — build-free ES Module front end
└── child_process: node opencode2api/index.js   (ELECTRON_RUN_AS_NODE=1)
    └── child_process: opencode.exe serve --port 10001
```

- The **main process** owns all business logic and on-disk state; the renderer only displays and handles interaction, over IPC through `contextBridge`.
- The **engine child process** is the third-party proxy `opencode2api`, which in turn launches `opencode.exe`.
  Free models are only reachable through `opencode.exe` (see the "direct call returns 403 FreeTierError" issue), which is why both processes have to ship in the package.
- The engine data directory is pointed at `%APPDATA%\essay-grader\opencode` through `XDG_DATA_HOME` / `XDG_CONFIG_HOME` / `XDG_STATE_HOME` / `XDG_CACHE_HOME`,
  and it **never writes into a user's existing `%LOCALAPPDATA%\opencode`**
  (when the old schema is incompatible, opencode exits immediately with `Database is not empty and has no session table`).

## 2. Engine lifecycle (`desktop/electron/backend.js`)

1. `resolvePaths()` locates two things:
   - Proxy directory: `resources/backend/opencode2api` (packaged) → `../opencode2api` (source) → `../../opencode2api`
   - Engine binary: `resources/bin/opencode.exe` → `../bin/opencode.exe` → `%APPDATA%\npm\node_modules\opencode-ai\bin\opencode.exe`
2. `freePort(10000)` finds a free port starting at 10000 (moving on when one is taken).
3. `spawn(process.execPath, [index.js], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', XDG_* } })`
   — the proxy runs on the Node that ships with Electron, so the installer does not need to carry another Node runtime.
4. Polls `GET /health` every 250 ms for up to 60 s; on success it sets `ready=true` and reports the port back to the renderer (the title bar shows "Engine ready · 10000").
5. Appends logs to `%APPDATA%\essay-grader\engine.log` (**UTF-8**; mind the encoding when reading it with PowerShell — see the troubleshooting doc).

## 3. IPC at a glance (`preload.js` → `window.api.*`)

| Channel | Purpose |
| --- | --- |
| `app:info` | Version, data directory, export directory, templates, settings, engine status |
| `backend:start` / `backend:status` | Restart the engine manually / query its status (the `backend:status` event is pushed too) |
| `settings:get` / `settings:save` | Read and write settings (model, backup model, concurrency, threshold, export format) |
| `templates:list` / `templates:save` / `templates:delete` | Rubric template CRUD (built-in templates cannot be deleted) |
| `papers:list` / `papers:add` / `papers:addBatch` / `papers:update` / `papers:delete` | Essay CRUD |
| `dialog:pickImages` / `dialog:pickDir` | Native file and directory pickers |
| `shell:openPath` / `shell:showItem` | Open the export directory / reveal a file in Explorer |
| `grade:start` / `grade:cancel` / `grade:regrade` | Start grading / stop / regrade the current text only |
| `export:one` / `export:all` | Export one essay / everything (`md` / `docx` / `pdf`) |

Events: `progress` (stage and percentage), `paper` (record updated), `log` (engine log summary), `theme`, `backend:status`.

`papers:update` accepts two payload shapes: `{ id, patch }` and `{ id, ...fields }`.

## 4. Data contracts

```js
paper = {
  id, name, images: [], createdAt,
  status: 'ready' | 'running' | 'graded' | 'error',
  templateId, title, author,
  sentences: [sentence], authorErrors: [error], grade: gradeResult,
  error, timing: { ocr, correct, grade, total }, gradedAt
}

sentence = {
  id,                       // `${page}-p${paragraph}s${index}`
  paragraph, text,          // recognised source text
  confidence, needVerify,
  verdict: 'ok' | 'ocr_fix' | 'author_error' | 'verify',
  finalText,                // body text after the teacher confirms it (equals text when author_error)
  issues: [{ wrong, right, kind, reason }]
}

gradeResult = {
  total, level, summary,
  dimensions: [{ name, score, max, comment }],
  pros / cons / suggestions: [{ text, source }],
  highlights, model
}
```

Storage layout:

```
%APPDATA%\essay-grader\
├── store.json          all essays, templates, settings
├── papers\<id>\page-01.jpg
├── engine.log          engine startup and errors
├── backend.log         proxy output
└── opencode\{data,config,state,cache}
```

## 5. Pipeline (`runner.js`)

```
runOne(id)
 ├─ recognizePage(image) per page  → merge sentences (paragraphs in page order)
 ├─ correctSentences(all sentences) → verdict + finalText + authorErrors
 └─ gradeEssay(body + template + authorErrors) → gradeResult
```

- Concurrency is controlled by `settings.concurrency` (default 1; raising it while the free tier is rate limited only makes things slower).
- `runOneGrade(id)` reuses the existing sentences and runs grading only, which is what "grade current text" uses:
  the body is `sentences.filter(s => s.verdict !== 'verify').map(s => s.finalText || s.text)`, joined per paragraph with `\n\n`.
- Progress events: `{ paperId, stage, pct, message }`, with `stage` ∈ `ocr | correct | grade | done | error`.

## 6. Renderer

Build-free ES Modules, five views:

| File | View |
| --- | --- |
| `views/desk.js` | Grading desk: drag-and-drop import, filtering, inline actions, multi-select, export all |
| `views/review.js` | Recognition and review: original on the left, sentences on the right, four-state highlighting, debounced saving |
| `views/result.js` | Grading result: score hero, dimension bars, three-column advice, typo table |
| `views/templates.js` | Rubrics: dimension rows and grade rows |
| `views/settings.js` | Settings: engine status, model, school level, concurrency, export, theme |

State is centralised in `js/state.js` (`subscribe/emit`), routing lives in `renderView()` in `js/app.js`,
and every view function is wrapped in try/catch so an exception renders an error page instead of a blank window.

## 7. Packaged layout

```
essay-grader-setup-2.0.0.exe    121 MB (NSIS, no admin rights)
└── after install
    ├── Essay Grader.exe
    └── resources\
        ├── app.asar                    Electron app (electron/ + renderer/)
        ├── bin\opencode.exe            172 MB engine (the OpenCode Zen free tier)
        └── backend\opencode2api\       proxy source + node_modules (88 packages)
```

`extraResources` does not copy `node_modules`, so `build/afterPack.cjs` fills it in with a whole-directory `cpSync` after packaging;
`backend.js` in turn has to compute the `resources` root differently inside and outside the asar, otherwise it ends up with
`resources\resources\backend\...` and reports "missing component". Both have to be right, or the installer "installs but won't open".
