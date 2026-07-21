#!/usr/bin/env bash
# Copyright (c) Biotechnology Research Institute,
# Chinese Academy of Agricultural Sciences. 2024-2026. All rights reserved.
# Author: xieshang (xieshang0608@gmail.com)
#         guxiaofeng (guxiaofeng@caas.cn)

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/quality_runner_common.sh
source "$SCRIPT_DIR/quality_runner_common.sh"

QUALITY_TOOL=shellcheck
QUALITY_VERSION=0.10.0
QUALITY_VERSION_ARGUMENT=--version
QUALITY_INSTALL_HINT='download the approved ShellCheck 0.10.0 Linux x86_64 asset and verify its SHA-256'

quality_runner_validate_output() {
    [[ "$1" =~ (^|$'\n')version:\ 0\.10\.0($'\n'|$) ]]
}

quality_runner_asset_for_platform() {
    case "$1" in
    linux-amd64)
        QUALITY_ASSET_URL='https://github.com/koalaman/shellcheck/releases/download/v0.10.0/shellcheck-v0.10.0.linux.x86_64.tar.xz'
        QUALITY_ASSET_SHA256='6c881ab0698e4e6ea235245f22832860544f17ba386442fe7e9d629f8cbedf87'
        QUALITY_ASSET_KIND=tar.xz
        QUALITY_ARCHIVE_MEMBER=shellcheck-v0.10.0/shellcheck
        ;;
    *) return 1 ;;
    esac
}

quality_runner_main "$@"
