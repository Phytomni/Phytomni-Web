package db

import (
	"log"

	"github.com/spf13/viper"
	"gorm.io/driver/mysql"
	"gorm.io/gorm"
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
		log.Fatalf("db.Get %s failed: db not init or config not found", name)
	}
	return db
}
