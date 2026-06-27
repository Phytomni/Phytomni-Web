package log

import (
	"context"
	"os"
	"path/filepath"

	"github.com/spf13/viper"
	"go.uber.org/zap"
	"go.uber.org/zap/zapcore"
	"gopkg.in/natefinch/lumberjack.v2"
)

type Config struct {
	Development bool `json:"development" mapstructure:"development"`

	Level string `json:"level" mapstructure:"level"`

	Outputs []string `json:"outputs" mapstructure:"outputs"`

	MaxSize int `json:"max_size" mapstructure:"max_size"`

	MaxAge int `json:"max_age" mapstructure:"max_age"`

	MaxBackups int `json:"max_backups" mapstructure:"max_backups"`
}

var (
	logger *zap.Logger

	config Config

	stdout = filepath.Base(os.Stdout.Name())

	stderr = filepath.Base(os.Stderr.Name())

	defaultMaxSize = 1 << 9

	enableLevel zapcore.Level
)

func init() {
	logger, _ = zap.NewDevelopment()
}

func InitFromViper() error {

	if err := viper.UnmarshalKey("log", &config); err != nil {
		return err
	}

	maxSize := config.MaxSize
	if maxSize == 0 {
		maxSize = defaultMaxSize
	}

	switch config.Level {

	case "debug":
		enableLevel = zap.DebugLevel

	case "info":
		enableLevel = zap.InfoLevel

	case "warn":
		enableLevel = zap.WarnLevel

	case "error":
		enableLevel = zap.ErrorLevel
	}

	levelEnabler := zap.LevelEnablerFunc(func(level zapcore.Level) bool {
		return level >= enableLevel
	})

	encoderConfig := zap.NewProductionEncoderConfig()
	encoderConfig.EncodeTime = zapcore.TimeEncoderOfLayout("2006-01-02 15:04:05")

	cores := make([]zapcore.Core, 0)
	for _, outPath := range config.Outputs {
		switch outPath {

		case stdout:
			stdoutEncoder := zapcore.NewConsoleEncoder(encoderConfig)
			cores = append(cores, zapcore.NewCore(stdoutEncoder, zapcore.Lock(os.Stdout), levelEnabler))

		case stderr:
			stderrEncoder := zapcore.NewConsoleEncoder(encoderConfig)
			cores = append(cores, zapcore.NewCore(stderrEncoder, zapcore.Lock(os.Stdout), levelEnabler))

		default:

			lumberjackWriter := &lumberjack.Logger{
				Filename:   outPath,
				MaxSize:    maxSize,
				MaxAge:     config.MaxAge,
				MaxBackups: config.MaxBackups,
				LocalTime:  true,
				Compress:   true,
			}

			fileEncoder := zapcore.NewJSONEncoder(encoderConfig)
			cores = append(cores, zapcore.NewCore(fileEncoder, zapcore.AddSync(lumberjackWriter), levelEnabler))
		}
	}

	options := make([]zap.Option, 0)
	options = append(options, zap.AddCaller())

	logger = zap.New(zapcore.NewTee(cores...), options...)
	return nil
}

func Logger() *zap.Logger {
	return logger
}

func Flush() {
	_ = logger.Sync()
}

func Sugar() *zap.SugaredLogger {
	return logger.Sugar()
}

func SugarContext(ctx context.Context) *zap.SugaredLogger {
	return logger.Sugar().With("request_id", ctx.Value("x-request-id"))
}
