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
chmod +x .githooks/pre-commit .githooks/pre-push
chmod +x scripts/scan_secrets.py scripts/check_repository_files.py scripts/scoped_gate.sh
chmod +x scripts/run_gate_group.sh scripts/validate_web_local.sh
chmod +x scripts/staticcheck_runner.sh scripts/shellcheck_runner.sh
chmod +x scripts/shfmt_runner.sh scripts/actionlint_runner.sh

printf '%s\n' "Installed Git hooks from .githooks"
printf '%s\n' "  Pre-commit  -> staged secret scan, then make precommit"
printf '%s\n' "  Pre-push    -> make full (default)"
printf '%s\n' "  Scoped local iteration only -> PHYTOMNI_SCOPED_GATE=1 git push"
