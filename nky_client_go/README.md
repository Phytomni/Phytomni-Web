# NKY Client Go

一个基于Go语言开发的智能知识管理和分析平台，集成了多种AI代理功能，包括知识问答、文档分析、基因数据处理等核心功能。

## 项目概述

NKY Client Go是一个现代化的Web API服务，提供智能化的知识管理和分析能力。项目采用微服务架构设计，支持多种AI代理工具，包括知识代理、分析代理、聊天代理和数据代理等。

## 核心功能

### 🤖 AI代理系统
- **知识代理 (Knowledge Agent)**: 智能知识问答和文档生成
- **分析代理 (Analysis Agent)**: 数据分析和报告生成
- **聊天代理 (Chat Agent)**: 智能对话和交互
- **数据代理 (Data Agent)**: 数据处理和转换

### 📊 任务管理系统
- 异步任务创建和状态跟踪
- 华为云EIHealth平台集成
- 实时任务状态监控
- 任务日志实时同步

### 📝 文档处理
- 支持多种文档格式：PDF、Word、Markdown
- 智能文档格式转换
- 参考文献自动生成
- 中英文文档支持

### 🧬 基因数据分析
- 基因测试数据管理
- 物种代码和基因ID处理
- 基因示例数据存储
- 生物信息学分析支持

### 👥 用户管理
- 用户注册和认证
- 权限管理系统
- 用户反馈收集
- 工具权限控制

## 技术栈

### 后端框架
- **Go 1.23.0**: 主要开发语言
- **Gin**: Web框架
- **GORM**: ORM数据库操作
- **Viper**: 配置管理

### 数据库
- **MySQL**: 主数据库
- **Redis**: 缓存和会话存储

### 外部服务集成
- **华为云EIHealth**: 生物信息学计算平台
- **华为云OBS**: 对象存储服务
- **Sentry**: 错误监控和日志管理

### 文档处理
- **gofpdf**: PDF生成
- **docx**: Word文档处理
- **excelize**: Excel文件处理

### 其他工具
- **JWT**: 身份认证
- **Cron**: 定时任务
- **Email**: 邮件通知
- **Zap**: 结构化日志

## 项目结构

```
nky_client_go/
├── main.go                    # 应用入口
├── commands/                  # CLI命令
│   ├── serve.go              # 启动服务
│   ├── migrate.go            # 数据库迁移
│   └── test.go               # 测试命令
├── http/                     # HTTP层
│   ├── handler/              # 请求处理器
│   │   └── api_handler/       # API处理器
│   └── router/               # 路由配置
├── service/                  # 业务逻辑层
│   └── api_service/          # API服务
├── model/                    # 数据模型
│   ├── table.go              # 数据库表结构
│   └── base.go               # 基础模型
├── common/                   # 公共组件
│   ├── const.go              # 常量定义
│   ├── response.go           # 响应格式
│   ├── request.go            # 请求格式
│   ├── email/                # 邮件服务
│   └── document_format/      # 文档格式化
│       ├── knowledge_agent/  # 知识代理文档
│       ├── review_agent/     # 审查代理文档
│       ├── chat_agent/       # 聊天代理文档
│       └── data_agent/       # 数据代理文档
├── middleware/               # 中间件
│   ├── middleware.go         # 通用中间件
│   └── jwt.go               # JWT认证
├── utils/                    # 工具函数
│   ├── config.go             # 配置管理
│   ├── validator.go          # 数据验证
│   ├── http.go               # HTTP工具
│   └── ...                   # 其他工具
├── db/                       # 数据库
│   └── mysql.go              # MySQL连接
├── cache/                    # 缓存
│   ├── redis.go              # Redis连接
│   └── client.go             # 缓存客户端
├── cron/                     # 定时任务
│   ├── cron.go               # 定时任务管理
│   ├── ga.go                 # GA任务
│   └── token.go              # Token任务
├── server/                   # 服务器配置
│   ├── http.go               # HTTP服务器
│   ├── option.go             # 服务器选项
│   └── middleware/           # 服务器中间件
├── log/                      # 日志
│   └── log.go                # 日志配置
├── graceful/                 # 优雅关闭
│   └── graceful.go           # 优雅关闭处理
└── core/                     # 核心功能
    ├── signer.go              # 签名
    └── escape.go              # 转义处理
```

## API接口

### 认证相关
- `POST /auth/user/register` - 用户注册
- `POST /auth/login` - 用户登录
- `GET /auth/download/obs_file` - 文件下载

### 用户管理
- `POST /v1/register` - 管理员注册用户
- `POST /v1/modify/password` - 修改密码
- `GET /v1/permission/user/list` - 用户列表
- `POST /v1/modify/permission` - 修改权限
- `GET /v1/permission/user/tool` - 工具权限
- `POST /v1/user/feedback` - 用户反馈

### 问答系统
- `GET /v1/query/list` - 问答列表
- `GET /v1/answer/check` - 查看对话
- `POST /v1/query/list/delete` - 删除问答
- `POST /v1/query/list/rename` - 重命名
- `POST /v1/query/reaction_type` - 点赞/点踩
- `POST /v1/query/collect` - 收藏
- `GET /v1/query/collect/list` - 收藏列表

### 任务管理
- `GET /v1/async_task/list` - 任务列表
- `GET /v1/async_task/info` - 任务详情
- `GET /v1/analyst/get_log` - 分析日志

### 基因数据
- `GET /v1/gene/list` - 基因列表
- `GET /v1/gene/details` - 基因详情
- `POST /v1/gene/details/storage` - 存储基因数据

### 文件处理
- `GET /v1/download/analyst_agent/obs_file` - 下载分析文件
- `POST /v1/download/rendering_file` - 文件格式转换

### 服务器接口
- `POST /v1/nky/server/create_task` - 创建任务
- `POST /v1/nky/server/update_task` - 更新任务

## 安装和运行

### 环境要求
- Go 1.23.0+
- MySQL 5.7+
- Redis 6.0+

### 安装步骤

1. **克隆项目**
```bash
git clone <repository-url>
cd nky_client_go
```

2. **安装依赖**
```bash
go mod download
```

3. **配置数据库**
```bash
# MySQL本地
root:root@tcp(localhost:3306)/nongke?charset=utf8mb4&parseTime=True&loc=Local
# MySQL服务器
root:mysql_nky@tcp(1.95.48.200:3306)/nongke?charset=utf8mb4&parseTime=True&loc=Local
```

4. **配置环境**
```bash
# 编辑配置文件
vim config/app.yml
```

5. **数据库迁移**
```bash
go run main.go migrate
```

6. **启动服务**
```bash
# Install dependencies
go mod tidy

# Run the application Default port: 8082
go run main.go
```

### 配置文件说明

#### app.yml (基础配置)
```yaml
app:
  name: "nky_client_go"
  version: "1.0.0"
  port: 8082

database:
  host: "localhost"
  port: 3306
  username: "root"
  password: "password"
  database: "nky_client_go"

redis:
  host: "localhost"
  port: 6379
  password: ""
  db: 0

huawei:
  obs:
    endpoint: "obs.cn-east-3.myhuaweicloud.com"
    access_key: "your_access_key"
    secret_key: "your_secret_key"
    bucket: "your_bucket"
  
  eihealth:
    endpoint: "eihealth.cn-east-3.myhuaweicloud.com"
    project_id: "your_project_id"
    username: "your_username"
    password: "your_password"
    domain: "your_domain"

email:
  smtp_host: "smtp.example.com"
  smtp_port: 587
  username: "your_email@example.com"
  password: "your_password"

cron:
  switch: true
  interval: 60
```

## 开发指南

### 添加新的API接口

1. **定义数据模型** (model/)
2. **实现业务逻辑** (service/api_service/)
3. **创建请求处理器** (http/handler/api_handler/)
4. **配置路由** (http/router/)

### 添加新的AI代理

1. **在common/document_format/下创建代理目录**
2. **实现代理特定的文档处理逻辑**
3. **在service层集成代理功能**
4. **添加相应的API接口**

### 数据库操作

项目使用GORM作为ORM，支持：
- 自动迁移
- 软删除
- 关联查询
- 事务处理

### 日志记录

使用Zap进行结构化日志记录：
```go
rxLog.Sugar().Info("操作成功")
rxLog.Sugar().Error("操作失败", err)
```

## 部署

### Docker部署

```dockerfile
FROM golang:1.23-alpine AS builder
WORKDIR /app
COPY . .
RUN go mod download
RUN go build -o main .

FROM alpine:latest
RUN apk --no-cache add ca-certificates
WORKDIR /root/
COPY --from=builder /app/main .
COPY --from=builder /app/config ./config
CMD ["./main", "serve"]
```

### 生产环境配置

1. **使用生产环境配置文件**
2. **配置HTTPS**
3. **设置日志轮转**
4. **配置监控和告警**
5. **设置备份策略**

## 监控和维护

### 健康检查
- 数据库连接状态
- Redis连接状态
- 外部服务可用性

### 性能监控
- API响应时间
- 数据库查询性能
- 内存和CPU使用率

### 错误处理
- Sentry集成错误监控
- 结构化日志记录
- 异常告警机制

## 贡献指南

1. Fork项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建Pull Request

## 许可证

本项目采用MIT许可证 - 查看[LICENSE](LICENSE)文件了解详情

## 联系方式

如有问题或建议，请通过以下方式联系：
- 提交Issue
- 发送邮件至项目维护者

---

**注意**: 本项目涉及生物信息学数据处理，请确保在使用前了解相关法律法规和伦理要求。
