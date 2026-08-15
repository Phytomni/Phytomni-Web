"""Tests for the offline Bot HEAD/Web compatibility contract gate."""

from __future__ import annotations

import contextlib
import copy
import hashlib
import io
import json
import shutil
from pathlib import Path
from typing import Any, Callable

import pytest

import check_bot_web_compatibility as checker


RELEASE_SHA = "38349aab1f6e2d65c286723beb3e5a426027e77a"
RELEASE_AGENTS = [
    "chat",
    "knowledge",
    "data",
    "review",
    "brief_gene",
    "analyst",
    "deep_genome",
    "research",
    "design",
    "network",
]
REQUIRED_FIXTURES = [
    "chat_completion_run_id",
    "degraded_tracking",
    "deep_genome_revision",
    "review_input_required",
    "conversation_context_v1",
]
PINNED_ARCHIVE_FIXTURE_HASHES = {
    "analyst": "b82b7809bdea88f023e90132a4a361386a3134f01b2b0766356209bdaf379ad8",
    "research": "9655b1e1b677b36b75a46ced3169456f2ef0db0a457205896803b1a9da5d8d26",
    "network": "ce1cda9d84b7f730715fb9f500c6bc71127ab1fc94aa34b03ed0c36340999f53",
    "design": "43c9628ec27920b52f416c0d6b6056417e28ef0a48910fb810bc18b7c0e1bda2",
}
ADVERSARIAL_PROSE = (
    "Routine assistant prose contains a sensitive finding without provider markers."
    + " x" * 1000
)
MANIFEST_LIMIT_BYTES = 2 * 1024 * 1024


def release_manifest() -> dict[str, object]:
    return {
        "schema_version": 2,
        "bot_commit": RELEASE_SHA,
        "required_agents": RELEASE_AGENTS.copy(),
        "fixtures": REQUIRED_FIXTURES.copy(),
        "result_archive_v1": {
            "protocol_version": 1,
            "fixtures": {
                agent: {
                    "path": f"apps/server/external/bot/testdata/head/{agent}_terminal.json",
                    "sha256": digest,
                }
                for agent, digest in PINNED_ARCHIVE_FIXTURE_HASHES.items()
            },
        },
    }


def test_manifest_has_release_pins_and_required_cases():
    assert checker.validate_manifest(release_manifest()) == []


def test_release_sha_pins_agree():
    manifest_path = checker.ROOT / checker.MANIFEST_REL
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

    assert RELEASE_SHA == checker.RELEASE_BOT_COMMIT == manifest["bot_commit"]
    assert checker.RESULT_ARCHIVE_RELEASE_FIXTURE_SHA256 == {
        RELEASE_SHA: PINNED_ARCHIVE_FIXTURE_HASHES
    }
    for agent, expected_digest in PINNED_ARCHIVE_FIXTURE_HASHES.items():
        fixture_path = checker.ROOT / checker.RESULT_ARCHIVE_FIXTURE_PATHS[agent]
        actual_digest = hashlib.sha256(fixture_path.read_bytes()).hexdigest()
        manifest_digest = manifest["result_archive_v1"]["fixtures"][agent]["sha256"]
        assert actual_digest == manifest_digest == expected_digest


@pytest.mark.parametrize(
    ("field", "value", "marker"),
    [
        ("bot_commit", "not-a-release", "bot_commit"),
        ("required_agents", RELEASE_AGENTS[:-1], "required_agents"),
        ("required_agents", RELEASE_AGENTS + ["extra"], "required_agents"),
        ("fixtures", REQUIRED_FIXTURES[:-1], "fixtures"),
        ("fixtures", REQUIRED_FIXTURES + ["unknown"], "fixtures"),
        ("result_archive_v1", {}, "result_archive_v1"),
    ],
)
def test_manifest_rejects_release_drift(field, value, marker):
    manifest = release_manifest()
    manifest[field] = value
    violations = checker.validate_manifest(manifest)
    assert violations
    assert any(marker in violation for violation in violations)


def test_manifest_rejects_raw_fixture_payloads():
    manifest = release_manifest()
    manifest["fixtures"] = [
        {"id": "chat_completion_run_id", "payload": {"answer": "secret"}},
        *REQUIRED_FIXTURES[1:],
    ]
    violations = checker.validate_manifest(manifest)
    assert any("fixture" in violation and "id" in violation for violation in violations)
    assert all("secret" not in violation for violation in violations)


def test_manifest_rejects_oversized_input_before_unbounded_read(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    manifest_path = tmp_path / checker.MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    with manifest_path.open("wb") as stream:
        stream.seek(MANIFEST_LIMIT_BYTES)
        stream.write(b"}")
    original_read_bytes = Path.read_bytes

    def reject_manifest_read_bytes(path: Path) -> bytes:
        if path == manifest_path:
            raise AssertionError("manifest used an unbounded read")
        return original_read_bytes(path)

    monkeypatch.setattr(Path, "read_bytes", reject_manifest_read_bytes)
    violations: list[str] = []

    assert checker._load_manifest(tmp_path, violations) is None
    assert violations == ["compatibility manifest is oversized"]


def test_current_checkout_passes_without_printing_fixture_payloads():
    violations = checker.check(checker.ROOT)
    assert violations == []

    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        assert checker.main([]) == 0
    assert output.getvalue().strip() == checker.PASS_LINE
    assert "Synthetic" not in output.getvalue()
    assert "secret" not in output.getvalue()


def contract_tree(root: Path) -> Path:
    manifest_path = root / checker.MANIFEST_REL
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(release_manifest()), encoding="utf-8")
    for relative in checker.SCOPED_FILES.values():
        destination = root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(checker.ROOT / relative, destination)
    for paths in checker.FIXTURE_PATHS.values():
        for relative in paths:
            destination = root / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(checker.ROOT / relative, destination)
    for relative in checker.RESULT_ARCHIVE_FIXTURE_PATHS.values():
        destination = root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(checker.ROOT / relative, destination)
    return root


def assert_contract_transition(
    root: Path,
    mutate: Callable[[Path], None],
    expected_violations: list[str],
) -> None:
    assert checker.check(root) == []
    mutate(root)
    assert checker.check(root) == expected_violations


@pytest.mark.parametrize(
    ("name", "mutate", "expected_violations"),
    [
        (
            "missing analyst",
            lambda root: (
                root / checker.RESULT_ARCHIVE_FIXTURE_PATHS["analyst"]
            ).unlink(),
            [
                "missing compatibility file: "
                "apps/server/external/bot/testdata/head/analyst_terminal.json",
                "missing result archive fixture",
            ],
        ),
        (
            "wrong protocol",
            lambda root: mutate_delivery(
                root,
                "analyst",
                lambda delivery: delivery.__setitem__("schema_version", 2),
            ),
            [
                "result archive fixture sha256 is not pinned to Bot release",
                "result archive fixture delivery protocol_version must be 1",
            ],
        ),
        (
            "legacy artifacts",
            lambda root: mutate_result(
                root,
                "research",
                lambda result: result.__setitem__("artifacts", []),
            ),
            [
                "result archive fixture sha256 is not pinned to Bot release",
                "result archive fixture contains legacy artifacts",
            ],
        ),
        (
            "empty archive",
            lambda root: mutate_delivery(
                root,
                "design",
                lambda delivery: delivery.__setitem__("archive", None),
            ),
            [
                "result archive fixture sha256 is not pinned to Bot release",
                "result archive fixture delivery archive must be an object",
            ],
        ),
        (
            "second archive",
            lambda root: mutate_execution(root, "network", add_second_archive),
            [
                "result archive fixture sha256 is not pinned to Bot release",
                "result archive fixture must contain exactly one archive",
            ],
        ),
        (
            "unsafe reference",
            lambda root: mutate_archive(
                root,
                "research",
                lambda archive: archive.__setitem__(
                    "download_ref", "obs://private/archive.zip"
                ),
            ),
            [
                "result archive fixture sha256 is not pinned to Bot release",
                "result archive fixture delivery archive download_ref is unsafe",
            ],
        ),
        (
            "changed hash",
            lambda root: mutate_manifest_hash(root, "analyst"),
            ["result archive fixture sha256 does not match manifest"],
        ),
        (
            "private delivery",
            lambda root: mutate_delivery(
                root,
                "network",
                lambda delivery: delivery.__setitem__(
                    "delivery_internal", {"secret": "not-for-output"}
                ),
            ),
            [
                "result archive fixture sha256 is not pinned to Bot release",
                "result archive fixture contains private delivery fields",
                "result archive fixture delivery fields are invalid",
            ],
        ),
        (
            "zero size",
            lambda root: mutate_archive(
                root,
                "analyst",
                lambda archive: archive.__setitem__("size_bytes", 0),
            ),
            [
                "result archive fixture sha256 is not pinned to Bot release",
                "result archive fixture delivery archive size_bytes is invalid",
            ],
        ),
    ],
)
def test_result_archive_contract_rejects_one_mutation_at_a_time(
    tmp_path: Path,
    name: str,
    mutate: Callable[[Path], None],
    expected_violations: list[str],
):
    root = contract_tree(tmp_path)
    assert_contract_transition(root, mutate, expected_violations)
    assert all("not-for-output" not in violation for violation in expected_violations), name
    assert all(
        len(violation) <= checker.MAX_FAILURE_LENGTH
        for violation in expected_violations
    )


def test_research_fixture_byte_drift_fails(tmp_path: Path):
    root = contract_tree(tmp_path)
    fixture = root / checker.RESULT_ARCHIVE_FIXTURE_PATHS["research"]
    assert_contract_transition(
        root,
        lambda _: fixture.write_bytes(fixture.read_bytes() + b" "),
        ["result archive fixture sha256 does not match manifest"],
    )


def archive_fixture(root: Path, agent: str) -> tuple[Path, dict[str, Any]]:
    path = root / checker.RESULT_ARCHIVE_FIXTURE_PATHS[agent]
    return path, json.loads(path.read_text(encoding="utf-8"))


def write_archive_fixture(root: Path, agent: str, payload: dict[str, Any]) -> None:
    path = root / checker.RESULT_ARCHIVE_FIXTURE_PATHS[agent]
    path.write_text(json.dumps(payload), encoding="utf-8")
    sync_archive_manifest_hash(root, agent)


def archive_delivery(payload: dict[str, Any]) -> dict[str, Any]:
    result = payload["result"]
    assert isinstance(result, dict)
    execution = result["execution"]
    assert isinstance(execution, dict)
    delivery = execution["delivery"]
    assert isinstance(delivery, dict)
    return delivery


def mutate_delivery(root: Path, agent: str, mutate) -> None:
    _, payload = archive_fixture(root, agent)
    mutate(archive_delivery(payload))
    write_archive_fixture(root, agent, payload)


def mutate_archive(root: Path, agent: str, mutate) -> None:
    def mutate_delivery_archive(delivery: dict[str, Any]) -> None:
        archive = delivery["archive"]
        assert isinstance(archive, dict)
        mutate(archive)

    mutate_delivery(root, agent, mutate_delivery_archive)


def mutate_result(root: Path, agent: str, mutate) -> None:
    _, payload = archive_fixture(root, agent)
    result = payload["result"]
    assert isinstance(result, dict)
    mutate(result)
    write_archive_fixture(root, agent, payload)


def add_second_archive(execution: dict[str, Any]) -> None:
    delivery = execution["delivery"]
    artifacts = execution["artifacts"]
    assert isinstance(delivery, dict)
    assert isinstance(artifacts, list)
    artifacts.append(copy.deepcopy(delivery["archive"]))


def mutate_execution(root: Path, agent: str, mutate) -> None:
    _, payload = archive_fixture(root, agent)
    result = payload["result"]
    assert isinstance(result, dict)
    execution = result["execution"]
    assert isinstance(execution, dict)
    mutate(execution)
    write_archive_fixture(root, agent, payload)


def mutate_manifest_hash(root: Path, agent: str) -> None:
    path = root / checker.MANIFEST_REL
    manifest = json.loads(path.read_text(encoding="utf-8"))
    manifest["result_archive_v1"]["fixtures"][agent]["sha256"] = "0" * 64
    path.write_text(json.dumps(manifest), encoding="utf-8")


def sync_archive_manifest_hash(root: Path, agent: str) -> None:
    fixture_path = root / checker.RESULT_ARCHIVE_FIXTURE_PATHS[agent]
    manifest_path = root / checker.MANIFEST_REL
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["result_archive_v1"]["fixtures"][agent]["sha256"] = hashlib.sha256(
        fixture_path.read_bytes()
    ).hexdigest()
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")


def mutate_scoped_source(
    root: Path,
    source_name: str,
    old: str,
    new: str,
) -> None:
    path = root / checker.SCOPED_FILES[source_name]
    source = path.read_text(encoding="utf-8")
    assert old in source
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


def scoped_declaration(
    root: Path,
    source_name: str,
    marker: str,
    terminator: str = ";",
) -> str:
    source = (root / checker.SCOPED_FILES[source_name]).read_text(encoding="utf-8")
    marker_index = source.index(marker)
    start = source.rfind("\n", 0, marker_index) + 1
    if terminator == ";":
        end = source.index(terminator, marker_index) + 1
    else:
        opening = source.index("{", marker_index)
        end = source.index("\n}", opening) + 2
    return source[start:end]


def write_scoped_source(root: Path, source_name: str, source: str) -> None:
    (root / checker.SCOPED_FILES[source_name]).write_text(source, encoding="utf-8")


def typescript_string_decoy(kind: str, declaration: str) -> str:
    inline = " ".join(declaration.splitlines())
    if kind == "single":
        value = "escaped ' prefix " + inline
        return "const parserDecoy = '" + value.replace("\\", "\\\\").replace("'", "\\'") + "';"
    if kind == "double":
        return "const parserDecoy = " + json.dumps('escaped " prefix ' + inline) + ";"
    if kind == "template":
        return "const parserDecoy = `escaped \\` prefix\n" + declaration + "\n`;"
    raise AssertionError(f"unsupported TypeScript decoy kind: {kind}")


def typescript_regex_decoy(declaration: str) -> str:
    return (
        "const parserAuthorityDecoy = /"
        + " ".join(declaration.splitlines())
        + "/;"
    )


def typescript_frozen_runtime_drift(tools: list[str]) -> str:
    runtime_tools = [tool for tool in tools if tool != "GeneNetworkAgent"]
    runtime_entries = "\n".join(f'  "{tool}",' for tool in runtime_tools)
    asserted_entries = "\n".join(f'  "{tool}",' for tool in tools)
    return (
        "export const CANONICAL_AGENT_TOOLS = Object.freeze([\n"
        + runtime_entries
        + "\n]) as unknown as readonly [\n"
        + asserted_entries
        + "\n];"
    )


def go_string_decoy(kind: str, declaration: str) -> str:
    if kind == "interpreted":
        return "var parserDecoy = " + json.dumps(" ".join(declaration.splitlines()))
    if kind == "raw":
        return "var parserDecoy = `\n" + declaration + "\n`"
    raise AssertionError(f"unsupported Go decoy kind: {kind}")


@pytest.mark.parametrize("agent", checker.RESULT_ARCHIVE_AGENT_SLUGS)
def test_archive_fixture_and_manifest_cannot_drift_together(
    tmp_path: Path, agent: str
):
    root = contract_tree(tmp_path)

    def drift_fixture_and_manifest(_: Path) -> None:
        fixture = root / checker.RESULT_ARCHIVE_FIXTURE_PATHS[agent]
        fixture.write_bytes(fixture.read_bytes() + b" ")
        sync_archive_manifest_hash(root, agent)

    assert_contract_transition(
        root,
        drift_fixture_and_manifest,
        ["result archive fixture sha256 is not pinned to Bot release"],
    )


@pytest.mark.parametrize(
    "mutate",
    [
        lambda root: mutate_delivery(
            root,
            "analyst",
            lambda delivery: delivery.__setitem__(
                "inventory_digest", "sha256:" + "3" * 64
            ),
        ),
        lambda root: mutate_archive(
            root,
            "analyst",
            lambda archive: archive.__setitem__(
                "download_ref", "result-archive:sha256:" + "4" * 64
            ),
        ),
    ],
)
def test_archive_inventory_and_download_digest_must_match(
    tmp_path: Path, mutate: Callable[[Path], None]
):
    root = contract_tree(tmp_path)
    assert_contract_transition(
        root,
        mutate,
        [
            "result archive fixture sha256 is not pinned to Bot release",
            "result archive fixture inventory_digest and download_ref do not match",
        ],
    )


@pytest.mark.parametrize(
    ("mutate", "field_violation"),
    [
        (
            lambda root: mutate_delivery(
                root,
                "analyst",
                lambda delivery: delivery.__setitem__("revision", True),
            ),
            "result archive fixture delivery revision is invalid",
        ),
        (
            lambda root: mutate_archive(
                root,
                "analyst",
                lambda archive: archive.__setitem__("size_bytes", True),
            ),
            "result archive fixture delivery archive size_bytes is invalid",
        ),
    ],
)
def test_archive_integer_fields_reject_booleans(
    tmp_path: Path,
    mutate: Callable[[Path], None],
    field_violation: str,
):
    root = contract_tree(tmp_path)
    assert_contract_transition(
        root,
        mutate,
        [
            "result archive fixture sha256 is not pinned to Bot release",
            field_violation,
        ],
    )


@pytest.mark.parametrize("kind", ["single", "double", "template"])
@pytest.mark.parametrize("keep_real", [True, False])
def test_typescript_string_declarations_are_opaque_to_full_checker(
    tmp_path: Path, kind: str, keep_real: bool
):
    root = contract_tree(tmp_path)
    declaration = scoped_declaration(
        root, "web_agents", "export const CANONICAL_AGENT_TOOLS"
    )
    decoy = typescript_string_decoy(kind, declaration)
    path = root / checker.SCOPED_FILES["web_agents"]
    source = path.read_text(encoding="utf-8")
    if keep_real:
        write_scoped_source(root, "web_agents", decoy + "\n" + source)
        assert checker.check(root) == []
    else:
        write_scoped_source(root, "web_agents", source.replace(declaration, decoy, 1))
        assert checker.check(root) == [
            "Web canonical agent list is missing or malformed"
        ]


def test_multiline_template_decoy_exposes_typed_runtime_drift(tmp_path: Path):
    root = contract_tree(tmp_path)
    declaration = scoped_declaration(
        root, "web_agents", "export const CANONICAL_AGENT_TOOLS"
    )
    path = root / checker.SCOPED_FILES["web_agents"]
    source = path.read_text(encoding="utf-8")
    source = source.replace(
        "export const CANONICAL_AGENT_TOOLS = [",
        "export const CANONICAL_AGENT_TOOLS: readonly string[] = [",
        1,
    ).replace('  "GeneNetworkAgent",\n', "", 1)
    write_scoped_source(
        root,
        "web_agents",
        typescript_string_decoy("template", declaration) + "\n" + source,
    )

    violations = checker.check(root)
    assert violations[0] == "Web canonical agent tools missing: GeneNetworkAgent"
    assert "Web canonical agent list is missing or malformed" not in violations


def test_interpolated_nested_template_decoy_is_opaque(tmp_path: Path):
    root = contract_tree(tmp_path)
    declaration = scoped_declaration(
        root, "web_agents", "export const CANONICAL_AGENT_TOOLS"
    )
    path = root / checker.SCOPED_FILES["web_agents"]
    source = path.read_text(encoding="utf-8")
    decoy = (
        "const parserDecoy = `prefix ${(() => `nested ${value}`)()}\n"
        + declaration
        + "\nsuffix`;\n"
    )
    path.write_text(decoy + source, encoding="utf-8")
    assert checker.check(root) == []


def test_typescript_regex_declaration_decoy_does_not_duplicate_real_authority(
    tmp_path: Path,
):
    root = contract_tree(tmp_path)
    declaration = scoped_declaration(
        root, "web_agents", "export const CANONICAL_AGENT_TOOLS"
    )
    path = root / checker.SCOPED_FILES["web_agents"]
    source = path.read_text(encoding="utf-8")
    path.write_text(
        typescript_regex_decoy(declaration) + "\n" + source,
        encoding="utf-8",
    )
    assert checker.check(root) == []


def test_typescript_export_default_regex_decoy_is_opaque(tmp_path: Path):
    root = contract_tree(tmp_path)
    declaration = scoped_declaration(
        root, "web_agents", "export const CANONICAL_AGENT_TOOLS"
    )
    path = root / checker.SCOPED_FILES["web_agents"]
    source = path.read_text(encoding="utf-8")
    path.write_text(
        "export default /" + " ".join(declaration.splitlines()) + "/;\n" + source,
        encoding="utf-8",
    )
    assert checker.check(root) == []


def test_typescript_regex_only_declaration_decoy_fails_closed(tmp_path: Path):
    root = contract_tree(tmp_path)
    declaration = scoped_declaration(
        root, "web_agents", "export const CANONICAL_AGENT_TOOLS"
    )
    path = root / checker.SCOPED_FILES["web_agents"]
    source = path.read_text(encoding="utf-8")
    path.write_text(
        source.replace(declaration, typescript_regex_decoy(declaration), 1),
        encoding="utf-8",
    )
    assert checker.check(root) == [
        "Web canonical agent list is missing or malformed"
    ]


def test_typescript_regex_decoy_cannot_hide_frozen_runtime_drift(tmp_path: Path):
    root = contract_tree(tmp_path)
    declaration = scoped_declaration(
        root, "web_agents", "export const CANONICAL_AGENT_TOOLS"
    )
    path = root / checker.SCOPED_FILES["web_agents"]
    source = path.read_text(encoding="utf-8")
    tools = checker._parse_web_tools(source)
    assert tools is not None
    drifted = source.replace(
        declaration, typescript_frozen_runtime_drift(tools), 1
    )
    path.write_text(
        typescript_regex_decoy(declaration) + "\n" + drifted,
        encoding="utf-8",
    )
    assert checker.check(root) == [
        "Web canonical agent list is missing or malformed"
    ]


def test_typescript_regex_body_classes_escapes_flags_and_comments_are_opaque(
    tmp_path: Path,
):
    root = contract_tree(tmp_path)
    path = root / checker.SCOPED_FILES["web_agents"]
    source = path.read_text(encoding="utf-8")
    regexes = (
        "const closingBrace = /}/;\n"
        r"const characterClass = /[{}\[\]/*]+\/tail/gi;" "\n"
        r"const commentMarkers = /\/\*not-comment\*\/|\/\/not-comment/m;" "\n"
    )
    path.write_text(regexes + source, encoding="utf-8")
    assert checker.check(root) == []


def test_typescript_regex_inside_template_expression_is_opaque(tmp_path: Path):
    root = contract_tree(tmp_path)
    path = root / checker.SCOPED_FILES["web_agents"]
    source = path.read_text(encoding="utf-8")
    template = (
        r"const templateRegex = `${/[}\]]+\/\/marker/gi.test(value)}`;" "\n"
    )
    path.write_text(template + source, encoding="utf-8")
    assert checker.check(root) == []


@pytest.mark.parametrize(
    "malformed",
    [
        "const malformed = /unterminated",
        "const malformed = /[unterminated/;",
        "const malformed = /trailing\\",
        "const malformed = /line\nbreak/;",
        "const malformed = /duplicate/gg;",
        "const malformed = /unsupported/z;",
        "const malformed = /unicode/uv;",
    ],
)
def test_malformed_typescript_regex_fails_closed(
    tmp_path: Path, malformed: str
):
    root = contract_tree(tmp_path)
    path = root / checker.SCOPED_FILES["web_agents"]
    path.write_text(
        malformed + "\n" + path.read_text(encoding="utf-8"),
        encoding="utf-8",
    )
    assert checker.check(root) == [
        "Web canonical agent list is missing or malformed"
    ]


def test_typescript_regex_and_division_contexts_remain_distinct(tmp_path: Path):
    root = contract_tree(tmp_path)
    path = root / checker.SCOPED_FILES["web_agents"]
    source = path.read_text(encoding="utf-8")
    ambiguous = (
        "const quotient = numerator / denominator / scale;\n"
        "const fractional = 10 / 2;\n"
        "let assigned = numerator;\n"
        "assigned /= denominator;\n"
        "const post = counter++ / denominator;\n"
        "const grouped = (numerator + 1) / denominator;\n"
        "const indexed = values[0] / denominator;\n"
        "const keywordProperty = holder.return / denominator;\n"
        "const functionValue = function () {} / denominator;\n"
        "const arrowValue = (() => {}) / denominator;\n"
        "const regexThenDivision = /value/.source.length / denominator;\n"
        "const divisionByRegex = numerator / /[}]/.test(value);\n"
        "if (enabled) /[}]/.test(value);\n"
        "else /[}]/.test(fallback);\n"
        "do /[}]/.test(value); while (enabled);\n"
        "function noOp() {}\n"
        "/[}]/.test(afterFunction);\n"
        "export function exportedNoOp() {}\n"
        "/[}]/.test(afterExportedFunction);\n"
        "const regexFactory = () => /value/;\n"
        "{ const blockValue = 1; }\n"
        "/[}]/.test(afterArrowAndBlock);\n"
        "function matches(value: string) {\n"
        "  return /[}\\]]+/.test(value);\n"
        "}\n"
    )
    path.write_text(ambiguous + source, encoding="utf-8")
    assert checker.check(root) == []


@pytest.mark.parametrize("quote", ["'", '"'])
@pytest.mark.parametrize("line_ending", ["\n", "\r\n"])
def test_typescript_escaped_string_line_continuation_is_opaque(
    tmp_path: Path, quote: str, line_ending: str
):
    root = contract_tree(tmp_path)
    path = root / checker.SCOPED_FILES["web_agents"]
    source = path.read_text(encoding="utf-8")
    continued = (
        "const continued = "
        + quote
        + "prefix\\"
        + line_ending
        + "suffix"
        + quote
        + ";\n"
    )
    path.write_text(continued + source, encoding="utf-8")
    assert checker.check(root) == []


@pytest.mark.parametrize("kind", ["interpreted", "raw"])
@pytest.mark.parametrize("keep_real", [True, False])
def test_go_string_declarations_are_opaque_to_full_checker(
    tmp_path: Path, kind: str, keep_real: bool
):
    root = contract_tree(tmp_path)
    declaration = scoped_declaration(
        root, "go_agents", "var CanonicalAgentTool", "\n}"
    )
    decoy = go_string_decoy(kind, declaration)
    path = root / checker.SCOPED_FILES["go_agents"]
    source = path.read_text(encoding="utf-8")
    if keep_real:
        source = source.replace("package bot\n", "package bot\n\n" + decoy + "\n", 1)
        write_scoped_source(root, "go_agents", source)
        assert checker.check(root) == []
    else:
        write_scoped_source(root, "go_agents", source.replace(declaration, decoy, 1))
        assert checker.check(root) == [
            "Go canonical agent map is missing or malformed"
        ]


@pytest.mark.parametrize("keep_real", [True, False])
def test_go_rune_literals_are_opaque_to_full_checker(
    tmp_path: Path, keep_real: bool
):
    root = contract_tree(tmp_path)
    declaration = scoped_declaration(
        root, "go_agents", "var CanonicalAgentTool", "\n}"
    )
    rune_decoy = "var parserRuneDecoys = []rune{'}', '\\'', '\\\\'}"
    path = root / checker.SCOPED_FILES["go_agents"]
    source = path.read_text(encoding="utf-8")
    if keep_real:
        source = source.replace(
            "package bot\n", "package bot\n\n" + rune_decoy + "\n", 1
        )
        write_scoped_source(root, "go_agents", source)
        assert checker.check(root) == []
    else:
        write_scoped_source(
            root, "go_agents", source.replace(declaration, "var parserDecoy = 'C'", 1)
        )
        assert checker.check(root) == [
            "Go canonical agent map is missing or malformed"
        ]


@pytest.mark.parametrize("kind", ["interpreted", "raw"])
@pytest.mark.parametrize("keep_real", [True, False])
def test_go_record_list_string_declarations_are_opaque_to_full_checker(
    tmp_path: Path, kind: str, keep_real: bool
):
    root = contract_tree(tmp_path)
    declaration = scoped_declaration(
        root, "go_aliases", "var WebAgentDefinitions", "\n}"
    )
    decoy = go_string_decoy(kind, declaration)
    path = root / checker.SCOPED_FILES["go_aliases"]
    source = path.read_text(encoding="utf-8")
    if keep_real:
        source = source.replace("package bot\n", "package bot\n\n" + decoy + "\n", 1)
        write_scoped_source(root, "go_aliases", source)
        assert checker.check(root) == []
    else:
        write_scoped_source(root, "go_aliases", source.replace(declaration, decoy, 1))
        assert "Web agent definitions are missing or malformed" in checker.check(root)


def test_function_local_go_decoy_cannot_hide_global_runtime_drift(tmp_path: Path):
    root = contract_tree(tmp_path)
    declaration = scoped_declaration(
        root, "go_agents", "var CanonicalAgentTool", "\n}"
    )
    local_decoy = (
        "func parserDecoy() {\n"
        + "\n".join("\t" + line for line in declaration.splitlines())
        + "\n\t_ = CanonicalAgentTool\n}\n"
    )
    path = root / checker.SCOPED_FILES["go_agents"]
    source = path.read_text(encoding="utf-8")
    source = source.replace('\t"network":     "GeneNetworkAgent",\n', "", 1)
    source = source.replace("package bot\n", "package bot\n\n" + local_decoy, 1)
    write_scoped_source(root, "go_agents", source)

    violations = checker.check(root)
    assert violations[0] == "Go canonical agent slugs missing: network"
    assert "Go canonical agent map is missing or malformed" not in violations


@pytest.mark.parametrize(
    ("source_name", "marker", "terminator", "expected"),
    [
        (
            "web_agents",
            "export const CANONICAL_AGENT_TOOLS",
            ";",
            "Web canonical agent list is missing or malformed",
        ),
        (
            "go_agents",
            "var CanonicalAgentTool",
            "\n}",
            "Go canonical agent map is missing or malformed",
        ),
        (
            "go_aliases",
            "var WebAgentDefinitions",
            "\n}",
            "Web agent definitions are missing or malformed",
        ),
        (
            "go_aliases",
            "var aliasToSlug",
            "\n}",
            "Go alias-to-slug map is missing or malformed",
        ),
        (
            "go_query_map",
            "var slugToToolName",
            "\n}",
            "Go query slug-to-tool map is missing or malformed",
        ),
    ],
)
def test_duplicate_top_level_declarations_fail_closed(
    tmp_path: Path,
    source_name: str,
    marker: str,
    terminator: str,
    expected: str,
):
    root = contract_tree(tmp_path)
    declaration = scoped_declaration(root, source_name, marker, terminator)
    path = root / checker.SCOPED_FILES[source_name]
    path.write_text(
        path.read_text(encoding="utf-8") + "\n" + declaration + "\n",
        encoding="utf-8",
    )
    assert expected in checker.check(root)


def test_duplicate_go_map_key_fails_closed_in_full_checker(tmp_path: Path):
    root = contract_tree(tmp_path)
    mutate_scoped_source(
        root,
        "go_agents",
        '\t"network":     "GeneNetworkAgent",',
        (
            '\t"network":     "GeneNetworkAgent",\n'
            '\t"network":     "GeneNetworkAgent",'
        ),
    )
    assert checker.check(root)[0] == "Go canonical agent map is missing or malformed"


def test_duplicate_go_record_field_fails_closed_in_full_checker(tmp_path: Path):
    root = contract_tree(tmp_path)
    mutate_scoped_source(
        root,
        "go_aliases",
        'Tool: "InSilicoResearchAgent", Slug: "research"',
        (
            'Tool: "InSilicoResearchAgent", Tool: "InSilicoResearchAgent", '
            'Slug: "research"'
        ),
    )
    assert "Web agent definitions are missing or malformed" in checker.check(root)


@pytest.mark.parametrize(
    ("source_name", "suffix", "expected"),
    [
        ("web_agents", "\nconst broken = 'unterminated", "Web canonical agent list"),
        ("web_agents", '\nconst broken = "unterminated', "Web canonical agent list"),
        ("web_agents", "\nconst broken = `unterminated", "Web canonical agent list"),
        ("web_agents", "\n/* unterminated", "Web canonical agent list"),
        ("go_agents", '\nvar broken = "unterminated', "Go canonical agent map"),
        ("go_agents", "\nvar broken = `unterminated", "Go canonical agent map"),
        ("go_agents", "\nvar broken = 'x", "Go canonical agent map"),
        ("go_agents", "\n/* unterminated", "Go canonical agent map"),
    ],
)
def test_unclosed_lexical_context_fails_closed(
    tmp_path: Path, source_name: str, suffix: str, expected: str
):
    root = contract_tree(tmp_path)
    path = root / checker.SCOPED_FILES[source_name]
    path.write_text(path.read_text(encoding="utf-8") + suffix, encoding="utf-8")
    violations = checker.check(root)
    assert any(expected in violation and "malformed" in violation for violation in violations)


def test_string_comment_and_rune_braces_do_not_change_nesting(tmp_path: Path):
    root = contract_tree(tmp_path)
    web_path = root / checker.SCOPED_FILES["web_agents"]
    web = web_path.read_text(encoding="utf-8")
    web_path.write_text(
        "const single = '} ] {';\n"
        'const double = "} ] { // not a comment";\n'
        "const template = `} ] { /* not a comment */`;\n"
        + web,
        encoding="utf-8",
    )
    go_path = root / checker.SCOPED_FILES["go_agents"]
    go = go_path.read_text(encoding="utf-8")
    go_path.write_text(
        go.replace(
            "package bot\n",
            "package bot\n\n"
            "var interpreted = \"} { /* not a comment */\"\n"
            "var raw = `} { // not a comment`\n"
            "var rune = '}'\n",
            1,
        ),
        encoding="utf-8",
    )
    assert checker.check(root) == []


def test_commented_declaration_is_opaque_but_real_declaration_still_counts(
    tmp_path: Path,
):
    root = contract_tree(tmp_path)
    declaration = scoped_declaration(
        root, "web_agents", "export const CANONICAL_AGENT_TOOLS"
    )
    path = root / checker.SCOPED_FILES["web_agents"]
    source = path.read_text(encoding="utf-8")
    path.write_text("/*\n" + declaration + "\n*/\n" + source, encoding="utf-8")
    assert checker.check(root) == []


@pytest.mark.parametrize("comment_kind", ["line", "block"])
def test_declaration_only_in_comment_fails_closed(
    tmp_path: Path, comment_kind: str
):
    root = contract_tree(tmp_path)
    declaration = scoped_declaration(
        root, "web_agents", "export const CANONICAL_AGENT_TOOLS"
    )
    if comment_kind == "line":
        decoy = "\n".join("// " + line for line in declaration.splitlines())
    else:
        decoy = "/*\n" + declaration + "\n*/"
    path = root / checker.SCOPED_FILES["web_agents"]
    source = path.read_text(encoding="utf-8")
    path.write_text(source.replace(declaration, decoy, 1), encoding="utf-8")
    assert checker.check(root) == [
        "Web canonical agent list is missing or malformed"
    ]


def test_typescript_declaration_suffix_is_required(tmp_path: Path):
    root = contract_tree(tmp_path)
    mutate_scoped_source(root, "web_agents", "] as const;", "];")
    assert checker.check(root) == [
        "Web canonical agent list is missing or malformed"
    ]


def test_root_confinement_output_is_deterministic_and_bounded(tmp_path: Path):
    root = contract_tree(tmp_path / "root")
    scoped = root / checker.SCOPED_FILES["web_agents"]
    outside = tmp_path / "outside-agents.ts"
    outside.write_bytes(scoped.read_bytes())
    scoped.unlink()
    scoped.symlink_to(outside)

    first = checker.check(root)
    assert first[0].startswith("refusing to read out-of-scope path:")
    assert all(checker.check(root) == first for _ in range(20))
    assert len(first) <= checker.MAX_FAILURE_LINES
    assert all(len(violation) <= checker.MAX_FAILURE_LENGTH for violation in first)


@pytest.mark.parametrize(
    "replacement",
    [
        '// "GeneNetworkAgent",',
        '/* "GeneNetworkAgent", */',
    ],
)
def test_typescript_agent_parser_ignores_commented_entries(
    tmp_path: Path, replacement: str
):
    root = contract_tree(tmp_path)
    assert_contract_transition(
        root,
        lambda candidate: mutate_scoped_source(
            candidate,
            "web_agents",
            '  "GeneNetworkAgent",',
            f"  {replacement}",
        ),
        ["Web canonical agent tools missing: GeneNetworkAgent"],
    )


def test_typescript_agent_parser_ignores_delimiters_in_comments(tmp_path: Path):
    root = contract_tree(tmp_path)
    assert checker.check(root) == []
    mutate_scoped_source(
        root,
        "web_agents",
        '  "GeneNetworkAgent",',
        '  /* ] } ignored */\n  "GeneNetworkAgent", // ] ignored',
    )
    assert checker.check(root) == []


def test_typescript_agent_parser_rejects_unsupported_expressions(tmp_path: Path):
    root = contract_tree(tmp_path)
    assert_contract_transition(
        root,
        lambda candidate: mutate_scoped_source(
            candidate,
            "web_agents",
            '  "GeneNetworkAgent",',
            '  resolveAgent("GeneNetworkAgent"),',
        ),
        ["Web canonical agent list is missing or malformed"],
    )


def test_go_map_parser_accepts_trailing_comments_and_braces_in_comments(
    tmp_path: Path,
):
    root = contract_tree(tmp_path)
    assert checker.check(root) == []
    mutate_scoped_source(
        root,
        "go_agents",
        '\t"network":     "GeneNetworkAgent",',
        (
            '\t/* } "ignored": "IgnoredAgent", */\n'
            '\t"network":     "GeneNetworkAgent", // } ignored'
        ),
    )
    assert checker.check(root) == []


def test_go_map_parser_rejects_unsupported_expressions(tmp_path: Path):
    root = contract_tree(tmp_path)
    assert_contract_transition(
        root,
        lambda candidate: mutate_scoped_source(
            candidate,
            "go_agents",
            '\t"network":     "GeneNetworkAgent",',
            '\t"network": canonicalTool("GeneNetworkAgent"),',
        ),
        ["Go canonical agent map is missing or malformed"],
    )


def test_web_agent_definitions_are_required(tmp_path: Path):
    root = contract_tree(tmp_path)
    assert_contract_transition(
        root,
        lambda candidate: mutate_scoped_source(
            candidate,
            "go_aliases",
            (
                '\t{Tool: "InSilicoResearchAgent", Slug: "research", '
                'Execution: "agent_run"},\n'
            ),
            "",
        ),
        ["Web agent definition slugs missing: research"],
    )


def test_web_agent_definition_parser_accepts_comments_with_braces(tmp_path: Path):
    root = contract_tree(tmp_path)
    assert checker.check(root) == []
    mutate_scoped_source(
        root,
        "go_aliases",
        (
            '\t{Tool: "InSilicoResearchAgent", Slug: "research", '
            'Execution: "agent_run"},'
        ),
        (
            '\t/* } {Tool: "Ignored", Slug: "ignored", Execution: "chat"}, */\n'
            '\t{Tool: "InSilicoResearchAgent", Slug: "research", '
            'Execution: "agent_run"}, // } ignored'
        ),
    )
    assert checker.check(root) == []


def test_web_agent_definition_parser_rejects_unsupported_expressions(
    tmp_path: Path,
):
    root = contract_tree(tmp_path)
    assert_contract_transition(
        root,
        lambda candidate: mutate_scoped_source(
            candidate,
            "go_aliases",
            'Tool: "InSilicoResearchAgent", Slug: "research"',
            'Tool: canonicalTool("InSilicoResearchAgent"), Slug: "research"',
        ),
        ["Web agent definitions are missing or malformed"],
    )


def test_web_agent_definition_execution_is_release_pinned(tmp_path: Path):
    root = contract_tree(tmp_path)
    assert_contract_transition(
        root,
        lambda candidate: mutate_scoped_source(
            candidate,
            "go_aliases",
            (
                'Tool: "InSilicoResearchAgent", Slug: "research", '
                'Execution: "agent_run"'
            ),
            (
                'Tool: "InSilicoResearchAgent", Slug: "research", '
                'Execution: "chat"'
            ),
        ),
        ["Web agent definition executions drift from the release contract"],
    )


def test_conversation_context_fixture_rejects_raw_context_fields(tmp_path: Path):
    source = checker.ROOT / checker.FIXTURE_PATHS["conversation_context_v1"][0]
    payload = json.loads(source.read_text(encoding="utf-8"))
    payload["requests"]["expert_unforced_envelope"]["history_delta"][0][
        "assistant_summary"
    ] = "private"
    fixture_path = tmp_path / checker.FIXTURE_PATHS["conversation_context_v1"][0]
    fixture_path.parent.mkdir(parents=True)
    fixture_path.write_text(json.dumps(payload), encoding="utf-8")

    violations: list[str] = []
    checker._check_fixture(
        tmp_path,
        "conversation_context_v1",
        checker.FIXTURE_PATHS["conversation_context_v1"][0],
        violations,
    )
    assert any("conversation_context_v1" in violation for violation in violations)
    assert all("private" not in violation for violation in violations)


@pytest.mark.parametrize(
    "mutate",
    [
        lambda payload: payload["requests"]["expert_unforced_envelope"]["history_delta"].append(
            {
                "turn_id": "3",
                "role": "assistant",
                "content": ADVERSARIAL_PROSE,
            }
        ),
        lambda payload: payload["requests"]["expert_unforced_envelope"]["history_delta"].append(
            {
                "turn_id": "3",
                "role": "assistant",
                "summary": ADVERSARIAL_PROSE,
            }
        ),
        lambda payload: payload["requests"]["expert_explicit_envelope"].update(
            {"assistant_summary": ADVERSARIAL_PROSE}
        ),
        lambda payload: payload["requests"]["expert_explicit_envelope"].update(
            {"assistant_summaries": [ADVERSARIAL_PROSE]}
        ),
        lambda payload: payload["responses"]["staged_metadata_response"].update(
            {"full_output": ADVERSARIAL_PROSE}
        ),
        lambda payload: payload["responses"]["staged_metadata_response"].update(
            {"answer": ADVERSARIAL_PROSE}
        ),
        lambda payload: payload["responses"]["staged_metadata_response"].update(
            {"final_report": ADVERSARIAL_PROSE}
        ),
        lambda payload: payload["requests"]["expert_unforced_envelope"]["artifact_refs"][0].update(
            {"metadata": {"content": ADVERSARIAL_PROSE}}
        ),
        lambda payload: payload["responses"]["staged_metadata_response"].update(
            {"summary": ADVERSARIAL_PROSE}
        ),
    ],
)
def test_conversation_context_fixture_rejects_valid_shaped_ordinary_raw_text(
    tmp_path: Path, mutate
):
    source = checker.ROOT / checker.FIXTURE_PATHS["conversation_context_v1"][0]
    payload = copy.deepcopy(json.loads(source.read_text(encoding="utf-8")))
    mutate(payload)
    fixture_path = tmp_path / checker.FIXTURE_PATHS["conversation_context_v1"][0]
    fixture_path.parent.mkdir(parents=True)
    fixture_path.write_text(json.dumps(payload), encoding="utf-8")

    violations: list[str] = []
    checker._check_fixture(
        tmp_path,
        "conversation_context_v1",
        checker.FIXTURE_PATHS["conversation_context_v1"][0],
        violations,
    )
    assert violations
    assert all(ADVERSARIAL_PROSE not in violation for violation in violations)
    assert len(violations) <= checker.MAX_FAILURE_LINES
    assert all(len(violation) <= checker.MAX_FAILURE_LENGTH for violation in violations)

    manifest_path = tmp_path / checker.MANIFEST_REL
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(release_manifest()), encoding="utf-8")
    for relative in checker.SCOPED_FILES.values():
        destination = tmp_path / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes((checker.ROOT / relative).read_bytes())
    gate_violations = checker.check(tmp_path)
    assert gate_violations
    assert len(gate_violations) <= checker.MAX_FAILURE_LINES
    assert all(len(violation) <= checker.MAX_FAILURE_LENGTH for violation in gate_violations)
    assert all(ADVERSARIAL_PROSE not in violation for violation in gate_violations)


@pytest.mark.parametrize("fixture_id", ["chat_completion_run_id", "deep_genome_revision"])
def test_legacy_response_fixtures_allow_documented_output_fields(fixture_id: str):
    for relative in checker.FIXTURE_PATHS[fixture_id]:
        violations: list[str] = []
        checker._check_fixture(checker.ROOT, fixture_id, relative, violations)
        assert violations == []


def test_default_off_gate_is_required(tmp_path: Path):
    root = tmp_path
    manifest_path = root / checker.MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    manifest_path.write_text(json.dumps(release_manifest()), encoding="utf-8")

    for relative in checker.SCOPED_FILES.values():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        if relative == checker.SCOPED_FILES["web_agents"]:
            path.write_text(
                'export const CANONICAL_AGENT_TOOLS = ["ChatAgent"] as const;\n',
                encoding="utf-8",
            )
        elif relative == checker.SCOPED_FILES["go_agents"]:
            path.write_text('var CanonicalAgentTool = map[string]string{}\n', encoding="utf-8")
        else:
            path.write_text("stream_enabled: true\n", encoding="utf-8")

    violations = checker.check(root)
    assert any("default" in violation and "false" in violation for violation in violations)


def test_multiturn_v1_default_off_gate_rejects_enabled(tmp_path: Path):
    root = tmp_path
    manifest_path = root / checker.MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    manifest_path.write_text(json.dumps(release_manifest()), encoding="utf-8")

    for name, relative in checker.SCOPED_FILES.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        source = (checker.ROOT / relative).read_text(encoding="utf-8")
        if name == "feature_config":
            source = source.replace(
                "multiturn_v1_enabled: false", "multiturn_v1_enabled: true"
            )
        path.write_text(source, encoding="utf-8")

    violations = checker.check(root)
    assert any("multiturn_v1_enabled" in violation for violation in violations)


def test_current_go_alias_and_query_maps_are_checked(tmp_path: Path):
    root = tmp_path
    manifest_path = root / checker.MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    manifest_path.write_text(json.dumps(release_manifest()), encoding="utf-8")

    for name, relative in checker.SCOPED_FILES.items():
        path = root / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        source = (checker.ROOT / relative).read_text(encoding="utf-8")
        if name == "go_aliases":
            source = source.replace('"ChatAgent":             "chat"', '"ChatAgent":             "knowledge"')
        elif name == "go_query_map":
            source = source.replace('"chat":        "ChatAgent"', '"chat":        "KnowledgeAgent"')
        path.write_text(source, encoding="utf-8")

    violations = checker.check(root)
    assert any("alias-to-slug" in violation for violation in violations)
    assert any("slug-to-tool" in violation for violation in violations)


def test_main_bounds_each_failure_to_one_line(tmp_path: Path):
    root = tmp_path
    manifest_path = root / checker.MANIFEST_REL
    manifest_path.parent.mkdir(parents=True)
    manifest_path.write_text("{}", encoding="utf-8")
    output = io.StringIO()
    with contextlib.redirect_stdout(output):
        assert checker.main(["--root", str(root)]) != 0
    lines = output.getvalue().splitlines()
    assert lines[0] == "Bot/Web compatibility contract: FAIL"
    assert all("\n" not in line for line in lines)
    assert len(lines) <= checker.MAX_FAILURE_LINES + 1
