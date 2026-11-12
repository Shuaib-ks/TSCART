#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
node scripts/setup.js
exec node --env-file-if-exists=.env server/index.js
