# AGENTS.md — press-ready

## Project Overview

press-ready converts PDFs to PDF/X-1a compliant files. The project has two parts:

- **CLI**: Node.js/TypeScript CLI (`press-ready` command)
- **GUI**: Tauri v1 desktop app in `press-ready-gui/`

## Directory Layout

```
press-ready-gui/              — Tauri desktop GUI
  index.html                  — entry HTML
  src/main.js                 — vanilla JS frontend
  src/style.css               — Catppuccin theme
  src-tauri/
    Cargo.toml                — Rust deps (tauri 1.6, serde)
    tauri.conf.json           — Tauri configuration
    src/main.rs               — Rust backend (3 commands, Ghostscript invocation)
    build.rs                  — tauri-build
    icons/                    — app icons
  vite.config.js              — Vite dev/build config
  package.json                — JS deps (@tauri-apps/api, @tauri-apps/cli, vite)

assets/                       — ICC profile, PS templates
src/                          — CLI TypeScript source
lib/                          — compiled CLI output
```

## Key Commands

```bash
brew install poppler ghostscript       # system deps (macOS)
npm install -g .                        # install CLI
cd press-ready-gui && npm install       # install GUI deps
cd press-ready-gui && npm run tauri dev # run GUI in dev mode
cd press-ready-gui && npm run tauri build # build production bundle
just build                              # build CLI
just test                               # run tests
```

## Rust Backend (`src-tauri/src/main.rs`)

Three Tauri commands invoked from JS via `@tauri-apps/api`:

- `check_dependencies()` — checks for `gs` and `pdffonts` on PATH
- `run_pdffonts(filePath)` — runs pdffonts on a PDF, returns stdout
- `convert_pdf(input, output, grayscale, enforce_outline, boundary_boxes)` — runs Ghostscript to produce PDF/X-1a

## Frontend (`press-ready-gui/src/main.js`)

Uses `@tauri-apps/api` imports:

- `invoke` from `@tauri-apps/api/tauri` for Rust commands
- `open`/`save` from `@tauri-apps/api/dialog` for native file dialogs

## Tauri Config Notes

- Dev server on port 1420 (Vite)
- Allowed APIs: dialog, path, shell.open
- Bundle identifier: `com.press-ready.app`
- Window: 760×640, min 600×500
