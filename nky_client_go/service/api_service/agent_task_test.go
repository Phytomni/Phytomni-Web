package api_service

import (
	"context"
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"nky_client_go/db"
)

// setupTestDB 建一个空的 in-memory SQLite,创建 s_question_agent_logs 最小列集,
// 注册到全局 db registry,返回 *gorm.DB 供测试 seed 数据。
//
// 之所以手写 CREATE TABLE 而不是 AutoMigrate `SQuestionAgentLog`:
// 该 model 多个 `type:enum` GORM tag(MySQL 专有),SQLite AutoMigrate 不识别;
// 手写 CREATE TABLE 只列 ApiAnswerCheck 实际查的列(id/user_name/dialogue_id/f_id/delete_at),
// 其余字段 GORM Scan 时按零值填,不影响本测试。
func setupTestDB(t *testing.T) *gorm.DB {
	t.Helper()
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	ddl := `CREATE TABLE s_question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		dialogue_id TEXT,
		f_id INTEGER DEFAULT 0,
		user_name TEXT,
		query TEXT,
		answer TEXT,
		tool_name TEXT,
		created_at DATETIME,
		updated_at DATETIME,
		delete_at DATETIME
	)`
	if err := gdb.Exec(ddl).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("nky_client_go", gdb)
	return gdb
}

// TestApiAnswerCheck_NoHistory 验证 F-001 fix 的核心场景:
// 无 parent 行时,函数返回空 list 而不是 [empty_struct] 单元素 list。
// 没 fix 时:First() ErrRecordNotFound,但 QuestionAgentLog=&{Id:0} 被 prepend,len(got)=1。
func TestApiAnswerCheck_NoHistory(t *testing.T) {
	setupTestDB(t)
	ps := NewApiService()

	got, err := ps.ApiAnswerCheck(context.Background(), "alice", "dlg-nonexistent")

	if err != nil {
		t.Fatalf("expected nil err for missing dialogue, got %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected empty list for missing dialogue, got %d items: %+v", len(got), got)
	}
}

// TestApiAnswerCheck_HappyPath 验证正常路径:1 parent + 2 children 返回 3 行,parent 在 index 0。
func TestApiAnswerCheck_HappyPath(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO s_question_agent_logs
		(id, dialogue_id, f_id, user_name, query, answer, created_at) VALUES
		(10, 'dlg-1',  0, 'alice', 'q1', 'a1', '2026-01-01 00:00:00'),
		(11, 'dlg-1', 10, 'alice', 'q2', 'a2', '2026-01-01 00:01:00'),
		(12, 'dlg-1', 10, 'alice', 'q3', 'a3', '2026-01-01 00:02:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewApiService()
	got, err := ps.ApiAnswerCheck(context.Background(), "alice", "dlg-1")

	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 3 {
		t.Fatalf("expected 3 items (1 parent + 2 children), got %d", len(got))
	}
	if got[0].Id != 10 {
		t.Errorf("expected parent first (id=10), got id=%d", got[0].Id)
	}
	childIDs := map[int64]bool{got[1].Id: true, got[2].Id: true}
	if !childIDs[11] || !childIDs[12] {
		t.Errorf("expected children {11, 12}, got %v", childIDs)
	}
}

// TestApiAnswerCheck_DoesNotLeakParentsAcrossUsers 把 F-001 的"f_id=0 误匹配"语义钉死:
// alice 查 bob 的 dialogue,应该一行不返,而不是把 bob 的 parent 通过 f_id=0 走漏过去。
// 没 fix 时:alice/dlg-bob 查无 parent → First() ErrRecordNotFound → QuestionAgentLog.Id=0
//
//	→ second query WHERE f_id=0 命中 bob 的 parent(id=21, f_id=0)→ 返回 2 行(空 parent + bob 行)。
func TestApiAnswerCheck_DoesNotLeakParentsAcrossUsers(t *testing.T) {
	gdb := setupTestDB(t)
	if err := gdb.Exec(`INSERT INTO s_question_agent_logs
		(id, dialogue_id, f_id, user_name, created_at) VALUES
		(20, 'dlg-alice', 0, 'alice', '2026-01-01 00:00:00'),
		(21, 'dlg-bob',   0, 'bob',   '2026-01-01 00:00:00')`).Error; err != nil {
		t.Fatalf("seed: %v", err)
	}

	ps := NewApiService()
	// alice 试图打开 bob 的 dialogue (越权场景 + missing parent 场景共一)
	got, err := ps.ApiAnswerCheck(context.Background(), "alice", "dlg-bob")

	if err != nil {
		t.Fatalf("unexpected err: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("expected 0 items (alice has no parent in dlg-bob), got %d: %+v", len(got), got)
	}
}
