#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
perry compile app.ts -o press-ready-gui
echo "Built: press-ready-gui/press-ready-gui ($(stat -f%z press-ready-gui) bytes)"
