#!/usr/bin/env bash
set -euo pipefail

PORT="${1:-5183}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

if [ ! -d "node_modules" ]; then
  npm install
fi

npm run dev -- --port "$PORT" --strictPort
