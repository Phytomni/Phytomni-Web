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

		// Custom logger with ParameterizedQueries enabled: the audit-log
		// sql_content is stored as ? placeholders rather than plaintext literal
		// values (emails / chat content / password hashes no longer enter the
		// audit table inside the SQL). ParameterizedQueries is set on the base
		// logger.Config (gorm.Config has no such field); SqlLogger.ParamsFilter
		// forwards to this base logger so it returns nil vars.
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

// Set registers a named *gorm.DB instance. Lets tests inject in-memory SQLite
// without going through the viper-based InitMysqlDB; production still uses InitMysqlDB.
func Set(name string, gormDB *gorm.DB) {
	if dbs == nil {
		dbs = make(map[string]*gorm.DB)
	}
	dbs[name] = gormDB
}
