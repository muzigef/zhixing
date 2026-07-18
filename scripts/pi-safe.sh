#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
exec env PI_TELEMETRY=0 PI_SKIP_VERSION_CHECK=1 pi --approve --no-extensions -e ./.pi/extensions/zhixing-guard.ts --tools read,write,edit,bash,grep,find,ls "$@"
