#!/bin/sh
set -eu
# Local quality gate; external CI is not connected or claimed to have run.
node node_modules/typescript/bin/tsc --noEmit
node node_modules/vitest/vitest.mjs run --maxWorkers=1 --no-file-parallelism
node scripts/build-extension.ts
node scripts/acceptance.ts
