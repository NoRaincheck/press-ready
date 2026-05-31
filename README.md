# press-ready

> This is a fork of [vibranthq/press-ready](https://github.com/vibranthq/press-ready).

> Make your PDF compliant with press-ready PDF/X-1a.

## Install

### macOS

```bash
brew install poppler ghostscript
```

## Usage

```bash
press-ready build -i <input.pdf> -o <output.pdf>
press-ready lint <input.pdf>
```

### Tauri GUI

For the desktop GUI (Tauri), see `press-ready-gui/`.

```bash
cd press-ready-gui
npm install
npm run tauri dev    # development
npm run tauri build  # production bundle
```

Requires the same system dependencies (`brew install poppler ghostscript`).

### Options

- `--gray-scale` — convert to grayscale
- `--boundary-boxes` — add TrimBox, CropBox, BleedBox
- `--enforce-outline` / `--no-enforce-outline` — control font outlining

