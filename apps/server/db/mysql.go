package db

import (
	stdLog "log"
	"os"
	"time"

	"github.com/spf13/viper"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

type Config struct {
	Driver string      `json:"driver" yaml:"driver"`
	Dsn    string      `json:"dsn" yaml:"dsn"`
	Config gorm.Config `json:"config" yaml:"config"`
}

var dbs map[string]*gorm.DB

func InitMysqlDB() error {
	dbCfg := make(map[string]Config)
	err := viper.UnmarshalKey("db", &dbCfg)
	if err != nil {
		return err
	}
	dbs = make(map[string]*gorm.DB)
	for name, cfg := range dbCfg {
		var dbGorm gorm.Dialector
		switch cfg.Driver {
		case "mysql":
			dbGorm = mysql.Open(cfg.Dsn)
		default:
			dbGorm = mysql.Open(cfg.Dsn)
		}

		// 设置自定义 Logger
		// 开启 ParameterizedQueries：审计日志 sql_content 落库为 ? 占位符而非明文
		// 字面值（邮箱/聊天内容/密码 hash 等不再随 SQL 入审计表）。
		// ParameterizedQueries 设在底层 logger.Config 上(gorm.Config 无此字段);
		// SqlLogger.ParamsFilter 转发到这个 base logger,使其返回 nil vars。
		baseLogger := logger.New(stdLog.New(os.Stdout, "\r\n", stdLog.LstdFlags), logger.Config{
			SlowThreshold:             200 * time.Millisecond,
			LogLevel:                  logger.Warn,
			IgnoreRecordNotFoundError: false,
			Colorful:                  true,
			ParameterizedQueries:      true,
		})
		cfg.Config.Logger = NewSqlLogger(baseLogger)
		// TranslateError maps driver-level errors (e.g. duplicate-key 1062) to
		// gorm sentinel values such as gorm.ErrDuplicatedKey so callers can use
		// errors.Is instead of parsing raw driver strings.
		cfg.Config.TranslateError = true

		db, err := gorm.Open(dbGorm, &cfg.Config)
		if err != nil {
			return err
		}

		dbs[name] = db
	}
	return nil
}

func Get(name string) (*gorm.DB, bool) {
	db, ok := dbs[name]
	return db, ok
}

func MustGet(name string) *gorm.DB {
	db, ok := Get(name)
	if !ok {
		stdLog.Fatalf("db.Get %s failed: db not init or config not found", name)
	}
	return db
}

// Set 注册一个命名 *gorm.DB 实例。供测试在不走 viper-based InitMysqlDB 的情况下
// 注入 in-memory SQLite;production 仍走 InitMysqlDB。
func Set(name string, gormDB *gorm.DB) {
	if dbs == nil {
		dbs = make(map[string]*gorm.DB)
	}
	dbs[name] = gormDB
}
