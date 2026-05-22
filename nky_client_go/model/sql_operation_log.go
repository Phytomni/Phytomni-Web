package model

import "time"

// SSqlOperationLog SQL操作日志表
type SSqlOperationLog struct {
	Id            int64     `gorm:"column:id;primaryKey;autoIncrement;comment:主键ID" json:"id"`
	UserId        int64     `gorm:"column:user_id;comment:用户ID" json:"user_id"`
	UserEmail     string    `gorm:"column:user_email;type:varchar(255);comment:用户邮箱" json:"user_email"`
	OperationType string    `gorm:"column:operation_type;type:varchar(20);comment:操作类型(SELECT/INSERT/UPDATE/DELETE)" json:"operation_type"`
	Table         string    `gorm:"column:table_name;type:varchar(100);comment:操作表名" json:"table_name"`
	SqlContent    string    `gorm:"column:sql_content;type:text;comment:SQL语句" json:"sql_content"`
	Duration      int64     `gorm:"column:duration;comment:执行时长(ms)" json:"duration"`
	Status        string    `gorm:"column:status;type:varchar(20);comment:执行状态(Success/Error)" json:"status"`
	ErrorMessage  string    `gorm:"column:error_message;type:text;comment:错误信息" json:"error_message"`
	CreatedAt     time.Time `gorm:"column:created_at;comment:创建时间" json:"created_at"`
}

func (SSqlOperationLog) TableName() string {
	return "s_sql_operation_logs"
}
