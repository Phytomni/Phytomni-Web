#!/usr/bin/env sh
# Copyright (c) Biotechnology Research Institute,
# Chinese Academy of Agricultural Sciences. 2024-2026. All rights reserved.
# Author: xieshang (xieshang0608@gmail.com)
#         guxiaofeng (guxiaofeng@caas.cn)
#
# Point this clone's git at the tracked .githooks/ directory so every
# contributor runs the same pre-commit gate without copying files around.
# Run once after `git clone`; idempotent.

set -eu

repo_root=$(git rev-parse --show-toplevel)
cd "$repo_root"

git config core.hooksPath .githooks
chmod +x .githooks/pre-commit
chmod +x scripts/scan_secrets.py

printf '%s\n' "Installed Git hooks from .githooks"
printf '%s\n' "  Pre-commit  -> scripts/scan_secrets.py --staged"
printf '%s\n' "  Bypass once -> git commit --no-verify  (NOT recommended)"
