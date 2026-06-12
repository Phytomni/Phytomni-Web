package commands

import (
	"testing"

	"github.com/glebarez/sqlite"
	"gorm.io/gorm"

	"nky_client_go/db"
	"nky_client_go/model"
)

// TestAddBotRunID_Idempotent 钉死 add-bot-run-id 的幂等守卫:当 bot_run_id 列已存在时,
// HasColumn 返回 true,命令应短路、不再执行 ALTER。
//
// 直接测命令 Action 闭包不可达(未导出),因此复刻命令体内的同一守卫
// db.Migrator().HasColumn(&model.SQuestionAgentLog{}, "bot_run_id"):该守卫为真即代表
// 命令会走 "skip" 分支。建表时即带 bot_run_id 列。
func TestAddBotRunID_Idempotent(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE s_question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		server_id TEXT,
		bot_run_id TEXT
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("nky_client_go", gdb)

	if !model.Default().Migrator().HasColumn(&model.SQuestionAgentLog{}, "bot_run_id") {
		t.Fatal("guard should report bot_run_id present; idempotent re-run would otherwise re-ALTER")
	}
}

// TestAddBotRunID_AddsWhenAbsent 钉死守卫的另一半:列不存在时 HasColumn 返回 false,
// 加列后再查应为 true。生产 DDL 带 `AFTER server_id`(MySQL 专有),SQLite 不支持该子句,
// 故此处用等价的无 AFTER 形式验证守卫语义,而非复刻生产 SQL 文本。
func TestAddBotRunID_AddsWhenAbsent(t *testing.T) {
	gdb, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := gdb.Exec(`CREATE TABLE s_question_agent_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		server_id TEXT
	)`).Error; err != nil {
		t.Fatalf("create table: %v", err)
	}
	db.Set("nky_client_go", gdb)

	m := model.Default().Migrator()
	if m.HasColumn(&model.SQuestionAgentLog{}, "bot_run_id") {
		t.Fatal("bot_run_id should be absent before add")
	}
	if err := model.Default().Exec(
		"ALTER TABLE s_question_agent_logs ADD COLUMN bot_run_id VARCHAR(64)",
	).Error; err != nil {
		t.Fatalf("add column: %v", err)
	}
	if !m.HasColumn(&model.SQuestionAgentLog{}, "bot_run_id") {
		t.Error("bot_run_id should be present after add")
	}
}
