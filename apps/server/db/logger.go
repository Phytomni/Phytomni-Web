package db

import (
	"context"
	rxLog "phytomni-server/log"
	"regexp"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type SqlLogger struct {
	logger.Interface
}

func NewSqlLogger(l logger.Interface) *SqlLogger {
	return &SqlLogger{Interface: l}
}

// ParamsFilter forwards to the underlying logger's ParamsFilter. GORM type-asserts
// db.Logger (this *SqlLogger) to gorm.ParamsFilter in callbacks.go, but the
// embedded logger.Interface method set does not include ParamsFilter, so the
// assertion would fail and parameterization would be a no-op. This explicit
// implementation forwards the call so ParameterizedQueries=true causes the
// underlying logger to return nil vars, storing "?, ?" placeholders in
// sql_content instead of plaintext literal values.
func (l *SqlLogger) ParamsFilter(ctx context.Context, sql string, params ...interface{}) (string, []interface{}) {
	if filter, ok := l.Interface.(gorm.ParamsFilter); ok {
		return filter.ParamsFilter(ctx, sql, params...)
	}
	return sql, params
}

// LogMode implements gorm/logger.Interface. This override is critical: the
// service layer frequently calls .Debug(), which calls LogMode. Without it,
// .Debug() would return the underlying logger instance and our Trace hook
// would be lost.
func (l *SqlLogger) LogMode(level logger.LogLevel) logger.Interface {
	newLogger := l.Interface.LogMode(level)
	return &SqlLogger{Interface: newLogger}
}

func (l *SqlLogger) Trace(ctx context.Context, begin time.Time, fc func() (sql string, rowsAffected int64), err error) {
	l.Interface.Trace(ctx, begin, fc, err)

	sqlStr, _ := fc()
	elapsed := time.Since(begin)

	// Must be async: sync would block the main goroutine and could deadlock
	// inside a transaction. Extract context values now — gin.Context is not
	// safe to access from a different goroutine after the handler returns.
	userId := ctx.Value("user_id")
	userEmail := ctx.Value("username") // JWT middleware stores the email as "username"

	go func(uid, email interface{}, sql string, duration time.Duration, err error) {
		opType, tableName := parseSql(sql)

		// Skip inserts into the audit tables themselves to prevent infinite recursion.
		if tableName == "sql_operation_logs" || tableName == "user_operation_logs" {
			return
		}

		// Skip heartbeat queries (SELECT 1, etc.).
		if tableName == "" && strings.Contains(sql, "SELECT 1") {
			return
		}

		status := "Success"
		errMsg := ""
		if err != nil {
			status = "Error"
			errMsg = err.Error()
		}

		var uidInt int64
		if v, ok := uid.(int64); ok {
			uidInt = v
		} else if v, ok := uid.(float64); ok {
			uidInt = int64(v)
		} else if v, ok := uid.(int); ok {
			uidInt = int64(v)
		}

		emailStr, _ := email.(string)

		// Cannot import model here (model imports db → cycle); use a map instead.
		logEntry := map[string]interface{}{
			"user_id":        uidInt,
			"user_email":     emailStr,
			"operation_type": opType,
			"table_name":     tableName,
			"sql_content":    sql,
			"duration":       duration.Milliseconds(),
			"status":         status,
			"error_message":  errMsg,
			"created_at":     time.Now(),
		}

		// Write the audit row; failures are no longer silently dropped — zap
		// surfaces a missing table or dead DB. Zap produces no SQL, so calling
		// it inside the SQL logger cannot re-enter Trace recursively.
		if werr := writeSQLAuditLog(logEntry); werr != nil {
			rxLog.Sugar().Warnw("sql audit log insert failed",
				"table", tableName, "op", opType, "err", werr)
		}
	}(userId, userEmail, sqlStr, elapsed, err)
}

// writeSQLAuditLog inserts one audit row into sql_operation_logs and returns
// the insert error — previously this error was dropped, so a missing table or
// dead DB silently lost audit rows. The session disables the logger and starts
// a fresh DB so the insert itself never re-enters Trace (infinite recursion).
// A nil registry (e.g. unit tests not exercising the audit path) is a no-op,
// not an error.
func writeSQLAuditLog(logEntry map[string]interface{}) error {
	gdb, ok := Get("phytomni-server")
	if !ok {
		return nil
	}
	return gdb.Session(&gorm.Session{Logger: logger.Discard, NewDB: true}).
		Table("sql_operation_logs").
		Create(logEntry).Error
}

func parseSql(sql string) (opType string, tableName string) {
	sql = strings.TrimSpace(sql)
	upperSql := strings.ToUpper(sql)

	if strings.HasPrefix(upperSql, "SELECT") {
		opType = "SELECT"
		// SELECT * FROM table ...
		re := regexp.MustCompile(`(?i)FROM\s+["` + "`" + `]?([a-zA-Z0-9_]+)["` + "`" + `]?`)
		matches := re.FindStringSubmatch(sql)
		if len(matches) > 1 {
			tableName = matches[1]
		}
	} else if strings.HasPrefix(upperSql, "INSERT") {
		opType = "INSERT"
		// INSERT INTO table ...
		re := regexp.MustCompile(`(?i)INTO\s+["` + "`" + `]?([a-zA-Z0-9_]+)["` + "`" + `]?`)
		matches := re.FindStringSubmatch(sql)
		if len(matches) > 1 {
			tableName = matches[1]
		}
	} else if strings.HasPrefix(upperSql, "UPDATE") {
		opType = "UPDATE"
		// UPDATE table SET ...
		re := regexp.MustCompile(`(?i)UPDATE\s+["` + "`" + `]?([a-zA-Z0-9_]+)["` + "`" + `]?`)
		matches := re.FindStringSubmatch(sql)
		if len(matches) > 1 {
			tableName = matches[1]
		}
	} else if strings.HasPrefix(upperSql, "DELETE") {
		opType = "DELETE"
		// DELETE FROM table ...
		re := regexp.MustCompile(`(?i)FROM\s+["` + "`" + `]?([a-zA-Z0-9_]+)["` + "`" + `]?`)
		matches := re.FindStringSubmatch(sql)
		if len(matches) > 1 {
			tableName = matches[1]
		}
	} else {
		opType = "OTHER"
	}

	tableName = strings.Trim(tableName, "`\"")
	return
}
