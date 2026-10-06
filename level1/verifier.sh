#!/usr/bin/env bash
# Open the "Vérifier un document" page against your own node (127.0.0.1:9944).
# The page runs in your browser; files are fingerprinted locally and never sent.
set -euo pipefail
cd "$(dirname "$0")/verifier"
PORT="${PORT:-8765}"
echo "Page: http://localhost:$PORT/  (Ctrl+C to stop)"
( sleep 1; command -v open >/dev/null && open "http://localhost:$PORT/" || xdg-open "http://localhost:$PORT/" 2>/dev/null || true ) &
exec python3 -m http.server "$PORT" --bind 127.0.0.1
