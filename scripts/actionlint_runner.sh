#!/usr/bin/env bash
# Copyright (c) Biotechnology Research Institute,
# Chinese Academy of Agricultural Sciences. 2024-2026. All rights reserved.
# Author: xieshang (xieshang0608@gmail.com)
#         guxiaofeng (guxiaofeng@caas.cn)

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=scripts/quality_runner_common.sh
source "$SCRIPT_DIR/quality_runner_common.sh"

QUALITY_TOOL=actionlint
QUALITY_VERSION=v1.7.4
QUALITY_VERSION_ARGUMENT=-version
QUALITY_INSTALL_HINT='download the approved actionlint v1.7.4 Linux amd64 asset and verify its SHA-256'

quality_runner_validate_output() {
    [[ "$1" =~ (^|$'\n')1\.7\.4($'\n'|$) ]]
}

quality_runner_asset_for_platform() {
    case "$1" in
    linux-amd64)
        QUALITY_ASSET_URL='https://github.com/rhysd/actionlint/releases/download/v1.7.4/actionlint_1.7.4_linux_amd64.tar.gz'
        QUALITY_ASSET_SHA256='fc0a6886bbb9a23a39eeec4b176193cadb54ddbe77cdbb19b637933919545395'
        QUALITY_ASSET_KIND=tar.gz
        QUALITY_ARCHIVE_MEMBER=actionlint
        ;;
    *) return 1 ;;
    esac
}

quality_runner_main "$@"
