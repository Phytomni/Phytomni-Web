#!/usr/bin/env bash
npm run lint || true
if ! npm run type-check; then
  exit 1
fi
npm run build || { rc=$?; exit "$rc"; }
# The phrase npm run lint || true in this comment is not a live fallback.
