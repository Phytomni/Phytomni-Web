package db

import (
	"context"
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

// LogMode 实现 gorm/logger.Interface 的 LogMode 方法
// 这一步非常关键，因为 service 层经常使用 .Debug()，它会调用 LogMode。
// 如果不重写此方法，.Debug() 会返回底层的 logger 实例，导致我们的 Trace 钩子丢失。
func (l *SqlLogger) LogMode(level logger.LogLevel) logger.Interface {
	newLogger := l.Interface.LogMode(level)
	return &SqlLogger{Interface: newLogger}
}

// Trace 实现 gorm/logger.Interface
func (l *SqlLogger) Trace(ctx context.Context, begin time.Time, fc func() (sql string, rowsAffected int64), err error) {
	// 1. 执行原有的日志逻辑 (比如打印到控制台)
	l.Interface.Trace(ctx, begin, fc, err)

	// 2. 获取 SQL 和执行结果
	sqlStr, _ := fc()
	elapsed := time.Since(begin)

	// 3. 异步记录到数据库
	// 注意：必须异步，否则会阻塞主业务，且如果在事务中可能会有问题
	// 但为了确保 Context 中的值还能取到，我们需要提取值
	// 如果 Context 是 gin.Context，在异步中可能不安全，所以要先取值

	userId := ctx.Value("user_id")
	userEmail := ctx.Value("username") // jwt 中设置的是 "username"

	// 如果没有用户信息，且不是特定操作，可能不记录？
	// 用户要求记录数据库操作记录且要正确记录是哪个用户
	// 如果无法获取用户，也应该记录，只是 user_id 为空

	go func(uid, email interface{}, sql string, duration time.Duration, err error) {
		// 简单的 SQL 解析
		opType, tableName := parseSql(sql)

		// 过滤掉日志表本身的操作，防止死循环
		if tableName == "s_sql_operation_logs" || tableName == "s_user_operation_logs" {
			return
		}

		// 过滤掉 SELECT 1 等心跳包
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

		// 构造日志对象 (这里不能引用 model 包，因为 model 引用了 db 包，会导致循环依赖)
		// 所以使用 map 或者定义局部结构体
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

		// 获取数据库连接
		// 注意：这里硬编码了 "nky_client_go"，实际应该从配置获取或者传递进来
		if db, ok := Get("nky_client_go"); ok {
			// 使用一个新的 Session，并且禁用 Logger，防止无限递归
			db.Session(&gorm.Session{Logger: logger.Discard, NewDB: true}).
				Table("s_sql_operation_logs").
				Create(logEntry)
		}
	}(userId, userEmail, sqlStr, elapsed, err)
}

// parseSql 简单的 SQL 解析
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

	// 去除可能存在的反引号
	tableName = strings.Trim(tableName, "`\"")
	return
}
