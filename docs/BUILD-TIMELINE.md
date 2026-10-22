# Build timeline

This is the real order of events for the v2.0.0 rewrite, reconstructed from the working session on
2026-10-22 (times are UTC+8). GitHub does not let an issue's `created_at` be set through the API, so the
issues carry the same information in their first line ("Recorded …") and are listed here as one table.

| Local time | What happened | Issue |
| --- | --- | --- |
| 20:38 | v2 skeleton created: Electron 33 + `docx`, electron-builder config, `.gitignore` | — |
| 20:41 | First API probe: the model received `??????:?????????` because Windows PowerShell 5.1 encodes string bodies as Latin-1 | [#18](https://github.com/roVeloupe/essay-grader/issues/18) |
| 20:47 | `npm install` exited 1 and produced no `electron.exe`: npm 11 blocks lifecycle scripts | [#19](https://github.com/roVeloupe/essay-grader/issues/19) |
| 20:52 | Main process, IPC and the embedded-engine launcher landed | — |
| 20:52 | The bundled engine refused to start: `Database is not empty and has no session table` (it was reading the user's old OpenCode database) | [#20](https://github.com/roVeloupe/essay-grader/issues/20) |
| 20:55 | A second instance could not bind 10000/10001 because a stale proxy still held them | [#21](https://github.com/roVeloupe/essay-grader/issues/21) |
| 20:58 | Direct call to `opencode.ai/inference` with a Bearer token returned 403 `FreeTierError` | [#22](https://github.com/roVeloupe/essay-grader/issues/22) |
| 21:02 | `store.js` / `export.js`: JSON persistence, rubric templates, Word export | — |
| 21:04 | `ConvertFrom-Json` reported a broken `store.json`; the file was fine, GBK decoding had eaten a quote | [#23](https://github.com/roVeloupe/essay-grader/issues/23) |
| 21:07 | `electron .` exited 1 with no window: the shell had `ELECTRON_RUN_AS_NODE=1` set | [#24](https://github.com/roVeloupe/essay-grader/issues/24) |
| 21:10 | Engine was ready but the title bar still said "starting" | [#25](https://github.com/roVeloupe/essay-grader/issues/25) |
| 21:12 | Prompts rewritten: three stages, four-state review, anti-normalisation guards | — |
| 21:13 | Grading died with "essay body is empty": the model dropped id prefixes, so every sentence fell back to `verify` and was filtered out | [#26](https://github.com/roVeloupe/essay-grader/issues/26) |
| 21:18 | Result page feedback rendered one character per line (grid columns vs. child count) | [#27](https://github.com/roVeloupe/essay-grader/issues/27) |
| 21:22 | `ai.js`: JSON repair, retries with backoff, scene/level guards | — |
| 21:24 | Student typos were silently corrected, so the essay was graded on text the student never wrote | [#28](https://github.com/roVeloupe/essay-grader/issues/28) |
| 21:26 | Grade-band row wrapped: five cells in a four-column grid | [#29](https://github.com/roVeloupe/essay-grader/issues/29) |
| 21:30 | Runner: queue, concurrency, per-stage progress events | — |
| 21:30 | Clicking "Review" did nothing — a temporal-dead-zone crash inside `renderReview()` | [#30](https://github.com/roVeloupe/essay-grader/issues/30) |
| 21:33 | Re-grading kept the old score on screen | [#31](https://github.com/roVeloupe/essay-grader/issues/31) |
| 21:38 | The fallback model existed in settings but was never passed to the AI calls | [#32](https://github.com/roVeloupe/essay-grader/issues/32) |
| 21:40 | The packaged build never reached "engine ready": `node_modules` missing plus a doubled `resources` path | [#33](https://github.com/roVeloupe/essay-grader/issues/33) |
| 21:44 | Packaging aborted with `EPERM: unlink ...opencode.exe` because the previous build was still running | [#34](https://github.com/roVeloupe/essay-grader/issues/34) |
| 21:45 | Renderer finished (desk / review / result / rubrics / settings) | — |
| 22:05 | Packaging hardened: `afterPack` copies the 88 proxy dependencies, asar-aware path resolution, icon | — |
| 22:20 | Documentation pass: README, architecture, prompts, packaging, troubleshooting | — |
| 22:30 | CI and release workflows, issue forms, PR template, `tools/setup-backend.ps1` | — |

## Measured end-to-end cost

| Run | Recognition | Review | Grading | Total | Score |
| --- | --- | --- | --- | --- | --- |
| Dev build, first paper | 12.1 s | 5.4 s | 16.2 s | 33.7 s | 40 / 50 |
| Dev build, after the typo fix | 7.6 s | 7.8 s | 38.9 s | 54.3 s | 36 / 50 |
| Packaged build | 7.6 s | 4.4 s | 17.0 s | 29.0 s | 35 / 50 |
| Fallback model (MiniMax M3.1 Flash) | — | — | 21.5 s | 21.5 s | 35 / 50 |

One essay costs roughly 25–55 seconds on a 2021 laptop with no GPU involved; the model runs remotely on the
free tier.
