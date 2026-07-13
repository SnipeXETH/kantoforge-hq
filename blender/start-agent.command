#!/usr/bin/env bash
# KantoForge render agent — double-click to start (macOS/Linux).
# Leave the window open while you want renders to be processed.
cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "Python 3 was not found. Install it from https://www.python.org/downloads/ and try again."
  read -r -p "Press Enter to close..."
  exit 1
fi

if [ ! -f .env ]; then
  echo "No .env file found. Copy .env.example to .env and fill it in first."
  read -r -p "Press Enter to close..."
  exit 1
fi

echo "Starting KantoForge render agent - keep this window open (Ctrl+C to stop)..."
python3 kf_render_agent.py
