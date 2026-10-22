# Troubleshooting

Split into what teachers hit and what development/packaging hits. Every entry maps to a closed issue that holds the root cause and the verification.

---

## 1. Teacher-facing (using an installed build)

### 1. The title bar stays on "Starting engine…"

Wait 30 seconds first (a first launch on a spinning disk has to unpack a 180 MB engine). If it still has not moved, check
`%APPDATA%\essay-grader\engine.log`:

| Log | Meaning | Action |
| --- | --- | --- |
| `missing opencode2api component` | Incomplete install | Reinstall (see [#14](../../issues/31)) |
| `missing opencode engine` | `resources\bin\opencode.exe` was quarantined by antivirus | Allowlist it, then reinstall |
| `backend exited abnormally (1)` | The proxy crashed | Same as above; or read the first line of `backend.log` |
| `Database is not empty ...` | The engine is reading someone else's data directory | Should not happen; if it does, XDG isolation has broken ([#3](../../issues/20)) |

### 2. "Cannot connect to the local engine (port 10000 is in use)"

The previous run did not exit cleanly. End `Essay Grader.exe` and `opencode.exe` in Task Manager, then start again.
The app itself looks for a free port starting at 10000 ([#4](../../issues/21)), so occasionally showing "Engine ready · 10001" is normal.

### 3. "The model did not return JSON"

Rate limiting on the free tier, or the model being flaky. The app retries 3 times automatically, then falls back to the backup model for one more attempt ([#17](../../issues/34)).
If all of that fails, press **Regrade**; recognised and reviewed content is not lost.

### 4. Student typos got corrected by the app / "0 student typos"

Fixed in v2.0.0 ([#11](../../issues/28)): same-length single-character substitutions are always classified `author_error`, and the original characters are kept in the body text.
If you still hit it, check that sentence's marker on the **Review** page, then attach the essay photo and the matching `store.json` excerpt to an issue.

### 5. Clicking Review does nothing

Fixed in v2.0.0 ([#12](../../issues/29)). If a newer version still does nothing, an uncaught exception is back:
press F12 to open DevTools, look at the Console, and paste the first red line into an issue.

### 6. Recognition is inaccurate

Photo quality sets the ceiling:

- Shoot straight on, with even lighting, and no shadow falling across the characters;
- The handwriting should fill at least 70% of the frame;
- Shoot one page at a time, and import multiple pages as multiple images in one go (they are merged in filename order).

Recognition output can always be corrected against the original image on the **Review** page; when you are done, use "grade current text".

---

## 2. Developer-facing (environment and packaging)

### 7. `node` / `npm` not found

On some machines `PATH` only contains `npm.cmd`. Prepend this in every script:

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
```

Note that `electron-builder` inside `npm run dist` also calls `node`; without it you get
`'"node"' is not recognized`, while npm's exit code is still 1, which makes it easy to misdiagnose ([#15](../../issues/32)).

### 8. npm 11 blocking install scripts

See [#2](../../issues/19). Patch it by hand with `node node_modules\electron\install.js`.

### 9. Exits immediately on launch, no window

Check the environment variable first:

```powershell
$env:ELECTRON_RUN_AS_NODE   # if it has a value, clear it first
Remove-Item Env:\ELECTRON_RUN_AS_NODE
electron.exe --version      # should print v33.x; v20.x means it is still in node mode
```

See [#7](../../issues/24).

### 10. Packaging fails with `EPERM ... opencode.exe`

A process is holding the file; see [#15](../../issues/32):

```powershell
Get-Process opencode, electron, 'Essay Grader' -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 4
npm run dist
```

### 11. The packaged build opens but the engine will not start

Two things to check ([#14](../../issues/31)):

1. Does `resources\backend\opencode2api\node_modules` exist (88 entries) — did `afterPack` run;
2. Does `resources\bin\opencode.exe` exist, and is it around 180 MB.

The classic path bug is appending `resources` a second time inside the asar:

```js
// packaged: appDir = ...\resources\app.asar
const resources = appDir.includes('app.asar') ? path.dirname(appDir) : path.join(appDir, '..');
```

### 12. Reading non-ASCII JSON with PowerShell throws a syntax error

The file is not corrupt; a GBK decode swallowed a quote ([#6](../../issues/23)):

```powershell
Get-Content $p -Raw -Encoding UTF8 | ConvertFrom-Json
```

Prefer Node for diagnostic scripts: `JSON.parse(fs.readFileSync(p, 'utf8'))`.

### 13. The engine reads someone else's database

Give the engine its own XDG directories ([#3](../../issues/20)); see the four variables such as `XDG_DATA_HOME` in `backend.js`.

### 14. The model returns 403 FreeTierError

The free tier only works inside `opencode.exe` ([#5](../../issues/22)); do not try to bypass the binary with a direct connection.

### 15. Testing the API with `Invoke-RestMethod` mangles Chinese text into `??????`

PowerShell 5.1 sends the body as Latin-1 ([#1](../../issues/18)). Test with Node instead, or send a byte array:

```powershell
Invoke-RestMethod -Uri $u -Method Post -ContentType 'application/json; charset=utf-8' `
  -Body ([Text.Encoding]::UTF8.GetBytes($json))
```

---

## 3. UI (comes back easily during development)

| Symptom | Root cause | Reference |
| --- | --- | --- |
| Feedback card renders one character per line | A single text node inside `grid-template-columns:16px 1fr` | [#10](../../issues/27) |
| The 5th cell of a grade row wraps | 5 child nodes in a 4-column grid | [#16](../../issues/33) |
| Score unchanged after regrading | `onProgress` did not handle "already on the result page" | [#13](../../issues/30) |
| Engine ready but the UI says starting | The main process never broadcast `backend:status` | [#8](../../issues/25) |
| Grading reports "essay body is empty" | Lost id prefix + `verify` filtering | [#9](../../issues/26) |

---

## 4. Turning logs into a minimal reproducible report

When you open an issue, include at least these three things:

1. The version (installer version, or `git rev-parse --short HEAD`);
2. The last 20 lines of `engine.log` (**strip out paths containing your username**);
3. The `store.json` excerpt for the essay that misbehaved (keep only `sentences` / `authorErrors` / `grade`; images are not needed).

With those three, 90% of problems need no guessing.
