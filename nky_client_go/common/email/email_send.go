package email

import (
	"crypto/tls"
	"fmt"
	"io"
	"net/smtp"

	"github.com/jordan-wright/email"
	"github.com/spf13/viper"

	rxLog "nky_client_go/log"
)

// SendEmail mails a task-completion notice to UserEmail. SMTP credentials,
// the sender display string, and the platform link bases all come from
// viper (`email.*`), so the QQ auth code and production IPs stay out of
// source. `Tid` identifies the task, `fDialogueId` is appended to the
// chat link, and `OutputFile` is appended to the OBS download link.
func SendEmail(UserEmail, Tid, fDialogueId, OutputFile string) {
	webBase := viper.GetString("email.web_base_url")
	apiBase := viper.GetString("email.api_base_url")
	agroAi := webBase + "/chat?dialogue_id=" + fDialogueId
	down := apiBase + "/auth/download/obs_file?obs_path=" + OutputFile + "&username=" + UserEmail

	e := email.NewEmail()
	e.From = viper.GetString("email.from_display")
	e.To = []string{UserEmail}
	e.Subject = "任务完成提示-" + Tid
	e.Text = []byte(
		"任务完成通知\n\n" +
			"您访问的任务 " + Tid + " 已完成分析处理。\n\n" +
			"请登录育种助手平台查看结果详情：\n" +
			agroAi + "\n\n" +
			"文件下载链接：\n" +
			down + "\n\n",
	)

	smtpServer := viper.GetString("email.smtp_server")
	smtpPort := viper.GetInt("email.smtp_port")
	emailAddress := viper.GetString("email.from_address")
	authCode := viper.GetString("email.from_auth_code")
	auth := smtp.PlainAuth("", emailAddress, authCode, smtpServer)
	tlsConfig := &tls.Config{
		ServerName:         smtpServer,
		InsecureSkipVerify: false,
	}

	conn, err := smtp.Dial(fmt.Sprintf("%s:%d", smtpServer, smtpPort))
	if err != nil {
		rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
		return
	}
	defer func(conn *smtp.Client) {
		_ = conn.Quit()
	}(conn)

	if err = conn.StartTLS(tlsConfig); err != nil {
		rxLog.Sugar().Info("启用 TLS 失败: %v", err)
		return
	}
	if err = conn.Auth(auth); err != nil {
		rxLog.Sugar().Info("SMTP 认证失败: %v", err)
		return
	}
	if err = conn.Mail(emailAddress); err != nil {
		rxLog.Sugar().Info("设置发件人失败: %v", err)
		return
	}
	for _, to := range e.To {
		if err = conn.Rcpt(to); err != nil {
			rxLog.Sugar().Info("添加收件人失败: %v", err)
			return
		}
	}

	wc, err := conn.Data()
	if err != nil {
		rxLog.Sugar().Info("打开邮件数据流失败: %v", err)
		return
	}
	defer func(wc io.WriteCloser) {
		_ = wc.Close()
	}(wc)

	message, err := e.Bytes()
	if err != nil {
		rxLog.Sugar().Info("序列化邮件失败: %v", err)
		return
	}
	if _, err = wc.Write(message); err != nil {
		rxLog.Sugar().Info("写入邮件失败: %v", err)
		return
	}

	rxLog.Sugar().Info("邮件发送成功！")
}
