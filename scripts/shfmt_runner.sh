#!/usr/bin/env bash
# Copyright (c) Biotechnology Research Institute,
# Chinese Academy of Agricultural Sciences. 2024-2026. All rights reserved.
# Author: xieshang (xieshang0608@gmail.com)
#         guxiaofeng (guxiaofeng@caas.cn)

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/quality_runner_common.sh
source "$SCRIPT_DIR/quality_runner_common.sh"

QUALITY_TOOL=shfmt
QUALITY_VERSION=v3.10.0
QUALITY_VERSION_ARGUMENT=-version
QUALITY_INSTALL_HINT='download the approved shfmt v3.10.0 Linux amd64 asset and verify its SHA-256'

quality_runner_validate_output() {
    [[ "$1" =~ (^|$'\n')v3\.10\.0($'\n'|$) ]]
}

quality_runner_asset_for_platform() {
    case "$1" in
    linux-amd64)
        QUALITY_ASSET_URL='https://github.com/mvdan/sh/releases/download/v3.10.0/shfmt_v3.10.0_linux_amd64'
        QUALITY_ASSET_SHA256='1f57a384d59542f8fac5f503da1f3ea44242f46dff969569e80b524d64b71dbc'
        QUALITY_ASSET_KIND=raw
        QUALITY_ARCHIVE_MEMBER=''
        ;;
    *) return 1 ;;
    esac
}

quality_runner_main "$@"
