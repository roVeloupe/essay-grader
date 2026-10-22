# Security

## Data flow

| Data | Destination | Notes |
| --- | --- | --- |
| Essay photos | Local `127.0.0.1` engine → OpenCode free tier → model | Never touches a server run by this project (this project has no servers) |
| Recognition results, scores, exported files | Local `%APPDATA%\essay-grader` and the export directory | Purely local |
| Crash logs | Not collected | The app reports no analytics of any kind |

Uninstalling does not delete `%APPDATA%\essay-grader`; delete that directory by hand if you want it gone completely.

## Keys

This app **does not use and does not need an API key**. If you modify it to call a paid model, keep the key in an environment variable or in configuration outside
`%APPDATA%\essay-grader\store.json` — **never commit it to the repository**.

## Reporting a vulnerability

Please report privately through the repository's Security → Report a vulnerability, or simply leave exploitation details out when you open an issue.
Path traversal and privilege abuse in the `app-media` protocol are in scope:

- `app-media://` may only map files under `%APPDATA%\essay-grader\papers`; the implementation validates the prefix.
- The renderer CSP is `default-src 'self'; img-src 'self' app-media: data: blob:` and does not enable `unsafe-eval`.

## Dependencies

`opencode2api` and `opencode.exe` are third-party components and remain under their respective upstream licenses;
this project only packages and integrates them and has not modified their source logic.
