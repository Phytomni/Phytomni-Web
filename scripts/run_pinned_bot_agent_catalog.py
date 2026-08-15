# Copyright (c) Biotechnology Research Institute,
# Chinese Academy of Agricultural Sciences. 2024-2026. All rights reserved.
# Author: xieshang (xieshang0608@gmail.com)
"""Execute a fixed Bot checkout's authenticated agent catalog offline."""

from __future__ import annotations

import argparse
import asyncio
import base64
import ctypes
import ctypes.util
import errno
import json
import os
import socket
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace
from typing import NoReturn

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from strict_json import StrictJsonError, loads_strict_json
else:
    from scripts.strict_json import StrictJsonError, loads_strict_json


PROFILE = "full_readiness_offline_v1"
MIN_BOT_PYTHON = (3, 12)
OFFLINE_ENFORCEMENT = "seccomp_socket_deny_v1"
PROFILE_ENV = {
    "PHYTOMNI_CONVERSATION_CONTEXT_V1_ENABLED": "1",
    "PHYTOMNI_RELAY_MODE": "0",
}
_SECCOMP_RET_ALLOW = 0x7FFF0000
_SECCOMP_RET_ERRNO = 0x00050000
_NETWORK_SYSCALL_NAMES = (
    b"socket",
    b"socketpair",
    b"connect",
    b"accept",
    b"accept4",
    b"bind",
    b"listen",
    b"sendto",
    b"sendmsg",
    b"sendmmsg",
    b"recvfrom",
    b"recvmsg",
    b"recvmmsg",
    b"getsockname",
    b"getpeername",
    b"setsockopt",
    b"getsockopt",
    b"shutdown",
)


def _blocked_network(*_args: object, **_kwargs: object) -> NoReturn:
    raise RuntimeError("network is disabled for catalog execution")


def _install_seccomp_network_block() -> None:
    """Deny network syscalls for this runner process; no Python fallback exists."""

    if sys.platform != "linux":
        raise RuntimeError("Linux seccomp is required for offline execution")
    library_name = ctypes.util.find_library("seccomp")
    if library_name is None:
        raise RuntimeError("libseccomp is required for offline execution")
    library = ctypes.CDLL(library_name, use_errno=True)
    library.seccomp_init.argtypes = [ctypes.c_uint32]
    library.seccomp_init.restype = ctypes.c_void_p
    library.seccomp_release.argtypes = [ctypes.c_void_p]
    library.seccomp_rule_add.argtypes = [
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_int,
        ctypes.c_uint,
    ]
    library.seccomp_rule_add.restype = ctypes.c_int
    library.seccomp_syscall_resolve_name.argtypes = [ctypes.c_char_p]
    library.seccomp_syscall_resolve_name.restype = ctypes.c_int
    library.seccomp_load.argtypes = [ctypes.c_void_p]
    library.seccomp_load.restype = ctypes.c_int

    context = library.seccomp_init(_SECCOMP_RET_ALLOW)
    if not context:
        raise RuntimeError("cannot initialize offline execution")
    try:
        action = _SECCOMP_RET_ERRNO | errno.EPERM
        for name in _NETWORK_SYSCALL_NAMES:
            syscall_number = library.seccomp_syscall_resolve_name(name)
            if (
                syscall_number < 0
                or library.seccomp_rule_add(context, action, syscall_number, 0) != 0
            ):
                raise RuntimeError("cannot configure offline execution")
        if library.seccomp_load(context) != 0:
            raise RuntimeError("cannot enforce offline execution")
    finally:
        library.seccomp_release(context)


def _install_network_block() -> None:
    _install_seccomp_network_block()
    socket.create_connection = _blocked_network
    socket.socket.connect = _blocked_network
    socket.socket.connect_ex = _blocked_network
    socket.socket.sendto = _blocked_network
    socket.getaddrinfo = _blocked_network
    asyncio.open_connection = _blocked_network


async def _execute(source_root: Path, environment_root: Path) -> bytes:
    if Path(sys.prefix).resolve() != environment_root.resolve(strict=True):
        raise RuntimeError("fixed Bot runner is not using its isolated environment")
    sys.path.insert(0, str(source_root))
    sys.path.insert(0, str(source_root / "src"))
    _install_network_block()

    __import__("conftest")
    os.environ.update(PROFILE_ENV)
    with tempfile.TemporaryDirectory(prefix="bot-catalog-profile-") as directory:
        runtime_root = Path(directory)
        os.environ["PHYTOMNI_API_KEYS_DB"] = str(runtime_root / "keys.sqlite")
        os.environ["PHYTOMNI_TASKS_DB"] = str(runtime_root / "tasks.sqlite")
        os.environ["TEMP_DIR"] = str(runtime_root / "temp")
        return await _execute_profile(source_root)


async def _execute_profile(source_root: Path) -> bytes:

    import httpx

    import mcp_server_phytomni
    from mcp_server_phytomni.api.app import create_app
    from mcp_server_phytomni.api.auth import ApiKeyStore
    from mcp_server_phytomni.api import research_input
    from mcp_server_phytomni.config.defaults import ServerConfig
    from mcp_server_phytomni.runtime.outbound import (
        aclose_outbound_runtime,
        init_outbound_runtime,
    )
    from tests.support.outbound_fakes import QueueTransport, RecordingResources

    package_path = Path(mcp_server_phytomni.__file__).resolve()
    package_path.relative_to(source_root.resolve())
    previous_runtime = research_input._RUNTIME_STATE["current"]
    research_input._RUNTIME_STATE["current"] = SimpleNamespace(
        root_worker=lambda *_args: None,
        root_request_factory=lambda *_args: None,
    )
    resources = RecordingResources(transport=QueueTransport())
    await init_outbound_runtime(ServerConfig(), factories=resources.factories())
    try:
        app = create_app()
        matches = [
            route
            for route in app.routes
            if getattr(route, "path", None) == "/v1/agents"
            and "GET" in getattr(route, "methods", set())
        ]
        if len(matches) != 1:
            raise RuntimeError("fixed Bot catalog route is not unique")
        key = (
            ApiKeyStore(os.environ["PHYTOMNI_API_KEYS_DB"])
            .create(user_id="fixture")
            .api_key
        )
        transport = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=transport,
            base_url="http://fixture.invalid",
        ) as client:
            unauthorized = await client.get("/v1/agents")
            if unauthorized.status_code != 401:
                raise RuntimeError("fixed Bot catalog route does not require auth")
            response = await client.get(
                "/v1/agents",
                headers={"Authorization": f"Bearer {key}"},
            )
        if response.status_code != 200:
            raise RuntimeError("fixed Bot catalog route did not succeed")
        value = loads_strict_json(response.content)
        canonical = json.dumps(
            value,
            ensure_ascii=False,
            separators=(",", ":"),
        ).encode("utf-8")
        if response.content != canonical:
            raise RuntimeError("fixed Bot catalog response is not canonical JSON")
        return canonical
    finally:
        research_input._RUNTIME_STATE["current"] = previous_runtime
        await aclose_outbound_runtime()


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-root", type=Path, required=True)
    parser.add_argument("--environment-root", type=Path, required=True)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _parser().parse_args(argv)
    if sys.version_info < MIN_BOT_PYTHON:
        print(
            "fixed Bot source requires Python 3.12 or newer",
            file=sys.stderr,
        )
        return 1
    try:
        raw = asyncio.run(
            _execute(
                args.source_root.resolve(strict=True),
                args.environment_root.resolve(strict=True),
            )
        )
    except (
        ImportError,
        OSError,
        RuntimeError,
        StrictJsonError,
        TypeError,
        ValueError,
    ) as exc:
        print(f"fixed Bot catalog execution failed: {exc}", file=sys.stderr)
        return 1
    print(
        json.dumps(
            {
                "profile": PROFILE,
                "method": "GET",
                "path": "/v1/agents",
                "authenticated": True,
                "network_allowed": False,
                "offline_enforcement": OFFLINE_ENFORCEMENT,
                "body_base64": base64.b64encode(raw).decode("ascii"),
            },
            separators=(",", ":"),
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
