# NKY Client Python - Phytomni Web MCP Client

## 项目概述

NKY Client Python 是一个基于 FastAPI 的 MCP (Model Context Protocol) 客户端应用，专门为 Phytomni Web 平台设计。该项目提供了与多个 AI 代理工具集成的接口，支持对话式查询、文件上传、任务管理和数据分析等功能。

## 主要功能

###  AI 代理工具集成
- **ChatAgent**: 基础对话代理
- **KnowledgeAgent**: 知识库查询代理，支持文献引用
- **DataAgent**: 数据库查询代理
- **AnalystAgent**: 数据分析代理，支持任务创建和日志监控
- **ReviewAgent**: 文献审查代理
- **DeepGenomeAgent**: 基因组深度分析代理

### 📁 文件管理
- 支持多种文件格式上传 (PDF, DOC, DOCX, XLS, XLSX, PPT, PPTX, TXT, JPG, PNG)
- 集成华为云 OBS 对象存储服务
- 自动文件类型验证和大小限制 (最大 10GB)

### 🔐 安全认证
- JWT Token 认证机制
- 用户身份验证和授权

### 📊 数据库集成
- SQLAlchemy ORM 支持
- 多平台数据库配置 (Windows/Linux)
- 支持多种数据模型和关系映射

### 📝 日志系统
- 按日期自动分割的日志文件
- 详细的工具调用和执行日志
- 任务状态跟踪和错误处理

## 项目结构

```
nky_client_python/
├── main.py                    # 主程序入口
├── nky_client.py             # 核心 MCP 客户端实现
├── models.py                 # 数据库模型定义
├── client_log.py             # 日志系统配置
├── tool_format_processing.py # 工具结果处理模块
├── pyproject.toml            # 项目依赖配置
├── tool_log/                 # 日志文件目录
└── uploads/                  # 文件上传目录
```

## 核心组件

### 1. MCPClient 类
- 管理与 MCP 服务器的连接
- 处理工具调用和响应
- 支持异步任务轮询和状态同步

### 2. 数据库SQL模型
- `QuestionAgentLog`: 问题代理日志记录
- `BiMapping`: 字段映射关系
- `ServerToolLogs`: 服务器工具日志
- `RagReferenceCitation`: RAG 引用文献
- `GeneExample`: 基因示例数据

### 3. API 端点
- `POST /query`: 主要查询接口
- `POST /query/analyst/update_log`: 分析师任务日志更新

## 环境配置

### 必需的环境变量
```bash
# JWT 密钥
SECRET_KEY_CLIENT=your_secret_key

# 数据库连接 (根据操作系统选择)
DATABASE_URL_CLIENT_WIN=mysql://user:password@host:port/database
DATABASE_URL_CLIENT_LINUX=mysql://user:password@host:port/database

# OpenAI API 配置
OPENAI_API_KEY_CLIENT=your_openai_api_key
BASE_URL_CLIENT=your_base_url
MODEL_CLIENT=your_model_name
```

### 华为云 OBS 配置
```python
# 在代码中配置
ak = "your_access_key"
sk = "your_secret_key"
server = "https://obs.cn-east-3.myhuaweicloud.com"
bucket_name = "phytomni"
```

## 安装和运行

### 1. 安装依赖
```bash
pip install -e .
```

### 2. 配置环境变量
创建 `.env` 文件并设置必要的环境变量。

### 3. 启动服务
```bash
# Navigate to Python client directory
cd nky_client_python

# Place the mcp_server_phytomni directory in the root
# Ensure the directory structure is:
# nky_client_python/
# ├── nky_client.py
# └── mcp_server_phytomni/
#     └── server.py (or relevant server files)

# Run the Python client with MCP server Default port: 8081
uv run nky_client.py mcp_server_phytomni.server
```

## API 使用示例

### 基础查询
```bash
curl -X POST "http://localhost:8081/query" \
  -H "Authorization: Bearer your_jwt_token" \
  -F "query=你的查询内容" \
  -F "id=1" \
  -F "tool=ChatAgent" \
  -F "history=[]"
```

### 文件上传查询
```bash
curl -X POST "http://localhost:8081/query" \
  -H "Authorization: Bearer your_jwt_token" \
  -F "query=分析这个文件" \
  -F "id=1" \
  -F "tool=KnowledgeAgent" \
  -F "files=@your_file.pdf"
```

### 任务日志查询
```bash
curl -X POST "http://localhost:8081/query/analyst/update_log" \
  -H "Authorization: Bearer your_jwt_token" \
  -F "task_id=your_task_id"
```

## 工具处理流程

1. **接收请求**: 验证 JWT Token 和请求参数
2. **文件处理**: 上传文件到华为云 OBS (如果存在)
3. **工具调用**: 根据工具类型调用相应的 MCP 服务器
4. **结果处理**: 使用 `tool_format_processing.py` 处理工具返回结果
5. **数据存储**: 将结果保存到数据库
6. **响应返回**: 返回格式化的 JSON 响应

## 任务轮询机制

系统实现了自动任务轮询功能：
- 每小时检查 `ServerToolLogs` 表中状态为 `finished` 的任务
- 自动同步任务结果到 `QuestionAgentLog` 表
- 生成 `GeneExample` 记录用于后续分析

## 错误处理

- 完善的异常捕获和日志记录
- 超时处理 (10小时请求超时)
- 数据库事务回滚机制
- 详细的错误信息返回

## 开发说明

### 添加新工具
1. 在 `tool_format_processing.py` 中添加结果处理函数
2. 在 `process_query` 方法中添加工具名称匹配
3. 更新数据库模型 (如需要)

### 日志配置
日志系统使用 `client_log.py` 配置，支持：
- 按日期自动分割日志文件
- UTF-8 编码支持
- 详细的执行时间戳

## 技术栈

- **Web 框架**: FastAPI
- **数据库**: SQLAlchemy + MySQL
- **AI 集成**: OpenAI API + MCP Protocol
- **文件存储**: 华为云 OBS
- **认证**: JWT
- **日志**: Python logging
- **异步处理**: asyncio

## 许可证

本项目采用 MIT 许可证。

## 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交更改
4. 推送到分支
5. 创建 Pull Request

## 联系方式

如有问题或建议，请联系开发团队。
EOF