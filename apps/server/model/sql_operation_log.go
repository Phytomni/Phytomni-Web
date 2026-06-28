package model

import "time"

// SqlOperationLog is the SQL operation audit-log table.
type SqlOperationLog struct {
	Id            int64     `gorm:"column:id;primaryKey;autoIncrement;comment:primary key ID" json:"id"`
	UserId        int64     `gorm:"column:user_id;comment:user ID" json:"user_id"`
	UserEmail     string    `gorm:"column:user_email;type:varchar(255);comment:user email" json:"user_email"`
	OperationType string    `gorm:"column:operation_type;type:varchar(20);comment:operation type (SELECT/INSERT/UPDATE/DELETE)" json:"operation_type"`
	Table         string    `gorm:"column:table_name;type:varchar(100);comment:table name" json:"table_name"`
	SqlContent    string    `gorm:"column:sql_content;type:text;comment:SQL statement" json:"sql_content"`
	Duration      int64     `gorm:"column:duration;comment:execution duration (ms)" json:"duration"`
	Status        string    `gorm:"column:status;type:varchar(20);comment:execution status (Success/Error)" json:"status"`
	ErrorMessage  string    `gorm:"column:error_message;type:text;comment:error message" json:"error_message"`
	CreatedAt     time.Time `gorm:"column:created_at;comment:created at" json:"created_at"`
}

func (SqlOperationLog) TableName() string {
	return "sql_operation_logs"
}
