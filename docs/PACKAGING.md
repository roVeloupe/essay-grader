# Packaging and distribution

## 1. Artifacts

| Target | Command | Artifact |
| --- | --- | --- |
| Unpacked directory | `npm run pack` | `desktop/dist/win-unpacked/` |
| NSIS installer | `npm run dist` | `desktop/dist/essay-grader-setup-<version>.exe` |

The installer is about **121 MB**: Electron runtime ~90 MB + `opencode.exe` 172 MB (~60 MB compressed) + proxy dependencies.

## 2. Required environment variables

On mainland-China networks, both the Electron and the NSIS toolchain go through mirrors, and a proxy is needed as well:

```powershell
$env:PATH = 'C:\Program Files\nodejs;' + $env:PATH
$env:ELECTRON_MIRROR = 'https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_BUILDER_BINARIES_MIRROR = 'https://npmmirror.com/mirrors/electron-builder-binaries/'
$env:HTTP_PROXY  = 'http://127.0.0.1:7897'
$env:HTTPS_PROXY = 'http://127.0.0.1:7897'
npm run dist
```

`node` must be on `PATH`: some `electron-builder` child processes invoke `node` directly,
otherwise you get `'"node"' is not recognized as an internal or external command` (npm itself only reports `exit 1`, so this is easy to misdiagnose as a build failure).

## 3. `build` configuration (package.json)

```json
{
  "build": {
    "appId": "com.essaygrader.desktop",
    "productName": "Essay Grader",
    "files": ["electron/**/*", "renderer/**/*", "package.json"],
    "extraResources": [
      { "from": "../opencode2api", "to": "backend/opencode2api" },
      { "from": "../bin/opencode.exe", "to": "bin/opencode.exe" }
    ],
    "win": { "target": [{ "target": "nsis", "arch": ["x64"] }], "icon": "build/icon.ico" },
    "nsis": { "oneClick": false, "allowToChangeInstallationDirectory": true },
    "afterPack": "build/afterPack.cjs"
  }
}
```

## 4. Two required patches

### 1. `extraResources` does not copy `node_modules`

`extraResources` moves files, it does not expand the dependency tree. The proxy `opencode2api` needs 88 packages including `express / axios / body-parser / @opencode-ai/sdk`,
and it crashes on startup without them. `build/afterPack.cjs` does a whole-directory `fs.cpSync` once packaging is done:

```js
const src = path.join(__dirname, '..', '..', 'opencode2api');
const dst = path.join(context.appOutDir, 'resources', 'backend', 'opencode2api');
fs.cpSync(src, dst, { recursive: true, dereference: true, filter: (p) => !/[\\/](\.git|tests?|docs?)[\\/]/.test(p) });
```

### 2. Paths mean different things inside and outside the asar

`app.getAppPath()` is `…\resources\app.asar` once packaged;
joining `..\resources` on top of the source layout yields `…\resources\resources\backend\…`, and the app then reports "missing opencode2api component".
`backend.js` branches on whether it is inside the asar:

```js
const resources = appDir.includes('app.asar')
  ? path.dirname(appDir)                      // …\resources
  : path.join(appDir, '..');                  // source: desktop\..
```

## 5. Common failures

| Error | Root cause | Fix |
| --- | --- | --- |
| `EPERM: operation not permitted, unlink ...\bin\opencode.exe` | An `opencode.exe` left behind by a packaged or dev run is still holding the file | `Get-Process opencode, electron, 'Essay Grader' -EA SilentlyContinue \| Stop-Process -Force`, wait 3–4 seconds, then rebuild |
| `'\"node\"' is not recognized` | `PATH` is missing the node directory | Prepend `C:\Program Files\nodejs` |
| `1 package has install scripts not yet covered by allowScripts: electron@…` | npm 11 blocks install scripts by default, so `electron`'s postinstall never ran | Run `node node_modules\electron\install.js` manually, or `npm config set ignore-scripts false` and reinstall |
| The packaged UI works but it stays on "Starting engine" forever | One of the two patches above did not take effect | Check `%APPDATA%\essay-grader\engine.log`: `missing opencode2api component` / `missing opencode engine` / `backend exited abnormally (1)` |

## 6. Release process

1. Bump `version` in `desktop/package.json` and update `CHANGELOG.md`.
2. Build the installer and record its size and SHA256:
   ```powershell
   Get-FileHash 'dist\essay-grader-setup-2.0.0.exe' -Algorithm SHA256
   ```
3. `git tag v2.0.0 && git push origin v2.0.0` — `.github/workflows/release.yml` rebuilds on windows-latest and attaches the asset.
4. Put the SHA256 and the note "the installer bundles opencode.exe, some antivirus products flag it, allowlist it" into the release description.

## 7. Antivirus and code signing

The installer is not code-signed (a certificate costs more than this project's positioning justifies). Things to be aware of:

- The 180 MB static `opencode.exe` binary is easily flagged by heuristic engines;
- NSIS self-extraction behaviour adds to the score.
- That is why both the README and the release notes ask users to allowlist `resources\bin\opencode.exe`, or to choose "Run anyway".

If you ever do sign it, use `electron-builder`'s `win.certificateFile` plus `CSC_KEY_PASSWORD`; nothing else in the configuration needs to change.
