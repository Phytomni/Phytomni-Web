#!/usr/bin/env bash
# Copyright (c) Biotechnology Research Institute,
# Chinese Academy of Agricultural Sciences. 2024-2026. All rights reserved.
# Author: xieshang (xieshang0608@gmail.com)
#         guxiaofeng (guxiaofeng@caas.cn)

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/quality_runner_common.sh
source "$SCRIPT_DIR/quality_runner_common.sh"

QUALITY_TOOL=staticcheck
QUALITY_VERSION=2025.1.1
QUALITY_VERSION_ARGUMENT=-version
QUALITY_INSTALL_HINT='download the approved Staticcheck 2025.1.1 Linux amd64 asset and verify its SHA-256'

quality_runner_validate_output() {
    [[ "$1" =~ (^|$'\n')staticcheck\ 2025\.1\.1\ \(0\.6\.1\)($'\n'|$) ]]
}

quality_runner_asset_for_platform() {
    case "$1" in
    linux-amd64)
        QUALITY_ASSET_URL='https://github.com/dominikh/go-tools/releases/download/2025.1.1/staticcheck_linux_amd64.tar.gz'
        QUALITY_ASSET_SHA256='ae320e410225295ecb2a2cd406113e3c2fe40521aaed984dd11dc41a0a50b253'
        QUALITY_ASSET_KIND=tar.gz
        QUALITY_ARCHIVE_MEMBER=staticcheck/staticcheck
        ;;
    *) return 1 ;;
    esac
}

quality_runner_main "$@"
