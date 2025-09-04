package email

import (
	"crypto/tls"
	"fmt"
	"github.com/jordan-wright/email"
	"io"
	"net/smtp"
	rxLog "nky_client_go/log"
)

func SendEmail(UserEmail, Tid, fDialogueId, OutputFile string) {
	//	todo：给与任务的拼接查看页面

	agroAi := "http://1.95.48.200/chat?dialogue_id=" + fDialogueId
	down := "http://1.95.48.200:8082/auth/download/obs_file?obs_path=" + OutputFile + "&username=" + UserEmail
	e := email.NewEmail()
	e.From = "nky_email <1016975084@qq.com>"
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
	//e.HTML = []byte("<h1>这是一封测试邮件</h1><p>使用Go语言发送。</p>") //实际内容

	// QQ邮箱SMTP服务器配置 - 使用STARTTLS（端口587）
	smtpServer := "smtp.qq.com" //服务商
	smtpPort := 587
	emailAddress := "1016975084@qq.com"
	authCode := "qhdvvdenyxirbefi" //授权码

	// 创建SMTP客户端
	auth := smtp.PlainAuth("", emailAddress, authCode, smtpServer)

	// 配置TLS
	tlsConfig := &tls.Config{
		ServerName:         smtpServer,
		InsecureSkipVerify: false, // 生产环境不要设置为true
	}

	// 连接SMTP服务器
	conn, err := smtp.Dial(fmt.Sprintf("%s:%d", smtpServer, smtpPort))
	if err != nil {
		rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
		return
	}
	defer func(conn *smtp.Client) {
		err = conn.Quit()
		if err != nil {

		}
	}(conn)

	// 启用TLS加密
	if err = conn.StartTLS(tlsConfig); err != nil {
		rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
		return
	}

	// 认证
	if err = conn.Auth(auth); err != nil {
		rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
		return
	}

	// 设置发件人和收件人
	if err = conn.Mail(emailAddress); err != nil {
		rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
		return
	}
	for _, to := range e.To {
		if err = conn.Rcpt(to); err != nil {
			rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
			return
		}
	}

	// 发送邮件内容
	wc, err := conn.Data()
	if err != nil {
		rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
		return
	}
	defer func(wc io.WriteCloser) {
		err = wc.Close()
		if err != nil {

		}
	}(wc)

	message, err := e.Bytes()
	if err != nil {
		rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
		return
	}

	if _, err = wc.Write(message); err != nil {
		rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
		return
	}

	rxLog.Sugar().Info("邮件发送成功！")
}

//func SendEmail(UserEmail, Tid string) {
//	e := email.NewEmail()
//	e.From = "nky_email <wmxx3333@163.com>"
//	e.To = []string{UserEmail}
//	e.Subject = "任务完成提示"
//	e.Text = []byte("您访问的任务" + Tid + "已完成请登录聊天页面查看!!!")
//
//	smtpServer := "smtp.163.com"
//	smtpPort := 465 // 网易邮箱推荐使用SSL端口465
//	emailAddress := "wmxx3333@163.com"
//	authCode := "SHpB936zgvuSVik5"
//
//	// 使用SSL连接（端口465）而不是STARTTLS
//	err := e.SendWithTLS(
//		fmt.Sprintf("%s:%d", smtpServer, smtpPort),
//		smtp.PlainAuth("", emailAddress, authCode, smtpServer),
//		&tls.Config{
//			ServerName:         smtpServer,
//			InsecureSkipVerify: false,
//		},
//	)
//
//	if err != nil {
//		log.Fatalf("邮件发送失败: %v", err)
//	}
//
//	log.Println("邮件发送成功！")
//}

func SendEmailWmxx(UserEmail, Tid, fDialogueId, OutputFile string) {
	//	todo：给与任务的拼接查看页面

	agroAi := "http://1.95.48.200/chat?dialogue_id=" + fDialogueId
	down := "http://localhost:8082/auth/download/obs_file?obs_path=" + OutputFile + "&username=" + UserEmail
	e := email.NewEmail()
	e.From = "nky_email <1016975084@qq.com>"
	e.To = []string{"wmxx3333@163.com"}
	e.Subject = "任务完成提示-" + Tid
	e.Text = []byte(
		"任务完成通知\n\n" +
			"您访问的任务 " + Tid + " 已完成分析处理。\n\n" +
			"请登录育种助手平台查看结果详情：\n" +
			agroAi + "\n\n" +
			"文件下载链接：\n" +
			down + "\n\n",
	)
	//e.HTML = []byte("<h1>这是一封测试邮件</h1><p>使用Go语言发送。</p>") //实际内容

	// QQ邮箱SMTP服务器配置 - 使用STARTTLS（端口587）
	smtpServer := "smtp.qq.com" //服务商
	smtpPort := 587
	emailAddress := "1016975084@qq.com"
	authCode := "qhdvvdenyxirbefi" //授权码

	// 创建SMTP客户端
	auth := smtp.PlainAuth("", emailAddress, authCode, smtpServer)

	// 配置TLS
	tlsConfig := &tls.Config{
		ServerName:         smtpServer,
		InsecureSkipVerify: false, // 生产环境不要设置为true
	}

	// 连接SMTP服务器
	conn, err := smtp.Dial(fmt.Sprintf("%s:%d", smtpServer, smtpPort))
	if err != nil {
		rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
		return
	}
	defer func(conn *smtp.Client) {
		err = conn.Quit()
		if err != nil {

		}
	}(conn)

	// 启用TLS加密
	if err = conn.StartTLS(tlsConfig); err != nil {
		rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
		return
	}

	// 认证
	if err = conn.Auth(auth); err != nil {
		rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
		return
	}

	// 设置发件人和收件人
	if err = conn.Mail(emailAddress); err != nil {
		rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
		return
	}
	for _, to := range e.To {
		if err = conn.Rcpt(to); err != nil {
			rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
			return
		}
	}

	// 发送邮件内容
	wc, err := conn.Data()
	if err != nil {
		rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
		return
	}
	defer func(wc io.WriteCloser) {
		err = wc.Close()
		if err != nil {

		}
	}(wc)

	message, err := e.Bytes()
	if err != nil {
		rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
		return
	}

	if _, err = wc.Write(message); err != nil {
		rxLog.Sugar().Info("连接SMTP服务器失败: %v", err)
		return
	}

	rxLog.Sugar().Info("邮件发送成功！")
}
