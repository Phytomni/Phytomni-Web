# Copyright (c) Biotechnology Research Institute,
# Chinese Academy of Agricultural Sciences. 2024-2026. All rights reserved.
# Author: xieshang (xieshang0608@gmail.com)
#         guxiaofeng (guxiaofeng@caas.cn)
"""Tests for the i18n hardcoded-copy scanner (scripts/check_i18n.py).

Covers the pure-function surface: CJK detection, ElMessage-literal
detection, gin.H-message-literal detection, permanent-allowlist
suppression (single-language policy + ICP pattern), markdown allowlist
parsing, and the ratchet comparison (both directions). Git/worktree
walking is exercised end-to-end by validate_web_local.sh.
"""

from __future__ import annotations

import pytest

import check_i18n
from check_i18n import (
    Violation,
    is_permanently_allowed,
    parse_allowlist,
    ratchet_diff,
    scan_text_for_violations,
)

pytestmark = pytest.mark.unit


# --- CJK detection (rule A) ---


def test_detects_cjk_in_vue_template():
    v = scan_text_for_violations("apps/web/src/views/x.vue", "  <h4>回复内容</h4>\n")
    assert any(x.literal == "回复内容" and x.rule == "cjk" for x in v)


def test_ignores_ascii_only_vue():
    v = scan_text_for_violations("apps/web/src/views/x.vue", "<h4>Reply</h4>\n")
    assert v == []


def test_skips_spec_files_entirely():
    # zh assertions in test files are governed by the single-language policy.
    v = scan_text_for_violations(
        "apps/web/tests/component/ForgotPassword.spec.ts", 'expect(t).toBe("找回密码");\n'
    )
    assert v == []


def test_skips_agent_case_demo_tapes():
    v = scan_text_for_violations(
        "apps/web/src/views/review-agent/review-case.ts",
        'title: "单细胞转录组测序技术发展及其在甘薯中的应用_赵楠",\n',
    )
    assert v == []


# --- ElMessage literal (rule B) ---


def test_detects_elmessage_string_literal():
    v = scan_text_for_violations(
        "apps/web/src/views/history/HistoryView.vue",
        '    ElMessage.error("Failed to load history");\n',
    )
    assert any(x.rule == "toast" and x.literal == "Failed to load history" for x in v)


def test_ignores_elmessage_with_t_call():
    v = scan_text_for_violations(
        "apps/web/src/views/history/HistoryView.vue",
        "    ElMessage.error(t('history.loadFailed'));\n",
    )
    assert [x for x in v if x.rule == "toast"] == []


# --- gin.H message literal (rule C) ---


def test_detects_ginh_message_literal():
    v = scan_text_for_violations(
        "apps/server/http/handler/api_handler/gene.go",
        '\tctx.JSON(400, gin.H{"code": 400, "message": "missing parameter"})\n',
    )
    assert any(x.rule == "ginh" and x.literal == "missing parameter" for x in v)


def test_ignores_ginh_with_i18n_t():
    v = scan_text_for_violations(
        "apps/server/http/handler/api_handler/auth.go",
        '\tctx.JSON(400, gin.H{"message": i18n.T(ctx, "register.rate_limited")})\n',
    )
    assert [x for x in v if x.rule == "ginh"] == []


def test_ignores_ginh_err_error_passthrough():
    # err.Error() passthrough is handled by TMaybe in Phase C, not a literal.
    v = scan_text_for_violations(
        "apps/server/http/handler/api_handler/agent_task.go",
        '\tctx.JSON(500, gin.H{"message": err.Error()})\n',
    )
    assert [x for x in v if x.rule == "ginh"] == []


# --- permanent allowlist ---


def test_icp_number_permanently_allowed():
    assert is_permanently_allowed("apps/web/src/components/AppFooter.vue", "京ICP备07026971号-9")


def test_langswitch_chinese_toggle_allowed():
    assert is_permanently_allowed("apps/web/src/components/LangSwitch.vue", "中文")


def test_locale_bundle_dir_allowed():
    assert is_permanently_allowed("apps/web/src/locales/langs/zh-CN.ts", "回复内容")


def test_ordinary_cjk_not_permanently_allowed():
    assert not is_permanently_allowed("apps/web/src/views/x.vue", "回复内容")


# --- markdown allowlist parsing ---


def test_parse_allowlist_extracts_entries():
    md = (
        "## A: Vue templates\n"
        "- [ ] `apps/web/src/views/chat/ChatView.vue` | `回复内容`\n"
        "- [x] `apps/web/src/views/error/UnauthorizedView.vue` | `返回`\n"
        "\nsome prose that is not an entry\n"
    )
    entries = parse_allowlist(md)
    assert ("apps/web/src/views/chat/ChatView.vue", "回复内容") in entries
    assert ("apps/web/src/views/error/UnauthorizedView.vue", "返回") in entries
    assert len(entries) == 2


# --- ratchet (both directions) ---


def test_ratchet_flags_new_violation_outside_allowlist():
    found = {("a.vue", "新")}
    allowed = set()
    new, stale = ratchet_diff(found, allowed)
    assert ("a.vue", "新") in new
    assert stale == set()


def test_ratchet_flags_stale_allowlist_entry():
    found = set()
    allowed = {("a.vue", "已迁走")}
    new, stale = ratchet_diff(found, allowed)
    assert new == set()
    assert ("a.vue", "已迁走") in stale


def test_ratchet_all_clear():
    found = {("a.vue", "x")}
    allowed = {("a.vue", "x")}
    new, stale = ratchet_diff(found, allowed)
    assert new == set() and stale == set()
