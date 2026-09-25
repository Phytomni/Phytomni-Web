#!/usr/bin/env bash
# Copyright (c) Biotechnology Research Institute,
# Chinese Academy of Agricultural Sciences. 2024-2026. All rights reserved.
# Author: xieshang (xieshang0608@gmail.com)
#         guxiaofeng (guxiaofeng@caas.cn)

set -euo pipefail

# Shared resolver for the pinned repository quality tools. Each wrapper sets
# QUALITY_* metadata and supplies quality_runner_validate_output plus
# quality_runner_asset_for_platform before calling quality_runner_main.

quality_runner_die() {
    printf 'quality runner: %s\n' "$*" >&2
    exit 1
}

quality_runner_platform() {
    local os arch
    case "$(uname -s)" in
    Linux) os=linux ;;
    Darwin) os=darwin ;;
    *)
        quality_runner_die "unsupported operating system '$(uname -s)'; ${QUALITY_INSTALL_HINT}"
        ;;
    esac

    case "$(uname -m)" in
    x86_64 | amd64) arch=amd64 ;;
    aarch64 | arm64) arch=arm64 ;;
    armv7l) arch=armv7l ;;
    *)
        quality_runner_die "unsupported architecture '$(uname -m)'; ${QUALITY_INSTALL_HINT}"
        ;;
    esac
    printf '%s-%s' "$os" "$arch"
}

quality_runner_require_commands() {
    local command_name
    for command_name in "$@"; do
        if ! command -v "$command_name" >/dev/null 2>&1; then
            quality_runner_die "required prerequisite '$command_name' is unavailable; ${QUALITY_INSTALL_HINT}"
        fi
    done
}

quality_runner_validate_binary() {
    local binary="$1"
    local output
    QUALITY_RUNNER_LAST_OUTPUT=''

    if [[ ! -x "$binary" ]]; then
        QUALITY_RUNNER_LAST_OUTPUT='binary is not executable'
        return 1
    fi
    if ! output="$($binary "$QUALITY_VERSION_ARGUMENT" 2>&1)"; then
        QUALITY_RUNNER_LAST_OUTPUT="$output"
        return 1
    fi
    QUALITY_RUNNER_LAST_OUTPUT="$output"
    quality_runner_validate_output "$output"
}

quality_runner_download() {
    local cache_dir="$1"
    local cache_bin="$2"
    local temporary_dir asset candidate

    if [[ ${QUALITY_RUNNER_OFFLINE:-0} == 1 ]]; then
        quality_runner_die "no exact PATH/cache binary is available while offline; ${QUALITY_INSTALL_HINT}"
    fi

    quality_runner_require_commands curl sha256sum
    if [[ "$QUALITY_ASSET_KIND" != raw ]]; then
        quality_runner_require_commands tar
    fi

    mkdir -p "$cache_dir"
    temporary_dir="$(mktemp -d "${cache_dir}.tmp.XXXXXX")" || {
        quality_runner_die "cannot create a temporary download directory; ${QUALITY_INSTALL_HINT}"
    }
    cleanup_download() {
        rm -rf "$temporary_dir"
    }
    trap cleanup_download EXIT

    asset="$temporary_dir/asset"
    if ! curl --fail --silent --show-error --location --proto '=https' \
        --tlsv1.2 --retry 2 --output "$asset" "$QUALITY_ASSET_URL"; then
        quality_runner_die "download failed for $QUALITY_ASSET_URL; ${QUALITY_INSTALL_HINT}"
    fi
    if ! printf '%s  %s\n' "$QUALITY_ASSET_SHA256" "$asset" |
        sha256sum --check --status -; then
        quality_runner_die "checksum verification failed for $QUALITY_TOOL $QUALITY_VERSION; ${QUALITY_INSTALL_HINT}"
    fi

    case "$QUALITY_ASSET_KIND" in
    raw)
        candidate="$asset"
        ;;
    tar.gz)
        if ! tar -xzf "$asset" -C "$temporary_dir" --no-same-owner --no-same-permissions; then
            quality_runner_die "tar extraction failed for $QUALITY_TOOL $QUALITY_VERSION; ${QUALITY_INSTALL_HINT}"
        fi
        candidate="$temporary_dir/$QUALITY_ARCHIVE_MEMBER"
        ;;
    tar.xz)
        if ! tar -xJf "$asset" -C "$temporary_dir" --no-same-owner --no-same-permissions; then
            quality_runner_die "tar extraction failed for $QUALITY_TOOL $QUALITY_VERSION; ${QUALITY_INSTALL_HINT}"
        fi
        candidate="$temporary_dir/$QUALITY_ARCHIVE_MEMBER"
        ;;
    *)
        quality_runner_die "unknown asset type '$QUALITY_ASSET_KIND' for $QUALITY_TOOL"
        ;;
    esac

    if [[ ! -f "$candidate" ]]; then
        quality_runner_die "approved archive did not contain '$QUALITY_ARCHIVE_MEMBER'; ${QUALITY_INSTALL_HINT}"
    fi
    chmod 755 "$candidate"
    if ! quality_runner_validate_binary "$candidate"; then
        quality_runner_die "downloaded binary reported an unexpected version: ${QUALITY_RUNNER_LAST_OUTPUT:-unknown}; ${QUALITY_INSTALL_HINT}"
    fi
    mv -f "$candidate" "$cache_bin"
    chmod 755 "$cache_bin"
    trap - EXIT
    cleanup_download
}

quality_runner_main() {
    local repository_root platform cache_root cache_dir cache_bin path_binary
    local path_mismatch=''

    repository_root="$(git rev-parse --show-toplevel 2>/dev/null)" || {
        quality_runner_die "cannot locate the repository root; ${QUALITY_INSTALL_HINT}"
    }
    platform="$(quality_runner_platform)"
    cache_root="${QUALITY_RUNNER_CACHE_ROOT:-$repository_root/.cache/phytomni}"
    cache_dir="$cache_root/$QUALITY_TOOL-$QUALITY_VERSION/$platform"
    cache_bin="$cache_dir/$QUALITY_TOOL"

    if ! quality_runner_asset_for_platform "$platform"; then
        quality_runner_die "no approved $QUALITY_TOOL asset exists for $platform; ${QUALITY_INSTALL_HINT}"
    fi

    if path_binary="$(command -v "$QUALITY_TOOL" 2>/dev/null)"; then
        if quality_runner_validate_binary "$path_binary"; then
            exec "$path_binary" "$@"
        fi
        path_mismatch="$path_binary -> ${QUALITY_RUNNER_LAST_OUTPUT:-unexpected version}"
    fi

    if [[ -e "$cache_bin" ]]; then
        if quality_runner_validate_binary "$cache_bin"; then
            exec "$cache_bin" "$@"
        fi
        quality_runner_die "cached $QUALITY_TOOL has an unexpected version ($cache_bin: ${QUALITY_RUNNER_LAST_OUTPUT:-unknown}); ${QUALITY_INSTALL_HINT}"
    fi

    if [[ -n "$path_mismatch" ]]; then
        printf 'quality runner: ignoring mismatched PATH binary %s\n' "$path_mismatch" >&2
    fi
    quality_runner_download "$cache_dir" "$cache_bin"
    exec "$cache_bin" "$@"
}
