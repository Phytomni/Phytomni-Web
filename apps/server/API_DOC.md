# API 接口文档

## 基础信息

> **API 前缀变更说明**: Go 业务 API 现已统一迁移至 `/api/v1` 前缀的 RESTful 方案。所有受保护业务接口的路径均以 `/api/v1` 开头，动词语义由 HTTP Method 承载。CORS 预检（OPTIONS）由 CORS 中间件自动处理，不作为显式路由列出。

*   **Base URL**: `http://localhost:8080`
*   **Content-Type**: `application/x-www-form-urlencoded` (除非特别说明)

---

## 1. 认证模块 (Auth)
无需 Token 即可访问。

### 1.1 用户注册
*   **URL**: `/api/v1/auth/registrations`
*   **Method**: `POST`
*   **Description**: 自主注册普通用户
*   **Parameters**:
    *   `email` (string, required): 邮箱
    *   `password` (string, required): 密码

### 1.2 用户登录
*   **URL**: `/api/v1/auth/sessions`
*   **Method**: `POST`
*   **Description**: 登录并获取 Token
*   **Parameters**:
    *   `email` (string, required): 邮箱
    *   `password` (string, required): 密码
*   **Response**:
    ```json
    {
        "code": 200,
        "data": {
            "token": "eyJhbGciOiJIUzI1Ni...",
            "user_name": "admin@admin.com",
            "login_status": "1"
        },
        "msg": "success"
    }
    ```

### 1.3 下载OBS文件
*   **URL**: `/api/v1/downloads/obs-file`
*   **Method**: `GET`
*   **Description**: 生成并重定向到下载链接
*   **Parameters**:
    *   `obs_path` (string, required): OBS路径
    *   `username` (string, required): 用户名

---

## 2. 业务模块 (V1)
**注意**: 所有接口需要在 Header 中携带 `Authorization: Bearer <token>`

### 2.1 问答与对话管理

#### 查询问答列表
*   **URL**: `/api/v1/conversations`
*   **Method**: `GET`
*   **Description**: 查看用户所有历史问答列表

#### 查询子级对话
*   **URL**: `/api/v1/conversations/{id}/messages`
*   **Method**: `GET`
*   **Description**: 根据对话ID查找全部子级对话
*   **Parameters**:
    *   `id` (int, path, required): 对话ID（原 `dialogue_id` 查询参数，已迁移至 URL 路径段）

#### 删除问题
*   **URL**: `/api/v1/conversations/{id}`
*   **Method**: `DELETE`
*   **Description**: 软删除指定问题
*   **Parameters**:
    *   `id` (int, path, required): 问题ID（已迁移至 URL 路径段，无需请求体）

#### 重命名问题
*   **URL**: `/api/v1/conversations/{id}`
*   **Method**: `PATCH`
*   **Description**: 重命名问题列表项
*   **Parameters**:
    *   `id` (int, path, required): 问题ID（已迁移至 URL 路径段）
    *   `rename` (string, body, required): 新名称

#### 点赞/点踩
*   **URL**: `/api/v1/conversations/{id}/reaction`
*   **Method**: `PUT`
*   **Description**: 对对话进行评价
*   **Parameters**:
    *   `id` (int, path, required): 记录ID（已迁移至 URL 路径段）
    *   `reaction_type` (string, body, required): 类型 (0:无, 1:赞, 2:踩)

#### 收藏对话
*   **URL**: `/api/v1/conversations/{id}/favorite`
*   **Method**: `PUT`
*   **Description**: 收藏或取消收藏对话
*   **Parameters**:
    *   `id` (int, path, required): 记录ID（已迁移至 URL 路径段）
    *   `collect_type` (string, body, required): 类型 (0:取消, 1:收藏)

#### 收藏列表
*   **URL**: `/api/v1/conversations?favorite=true`
*   **Method**: `GET`
*   **Description**: 获取用户收藏的所有对话

### 2.2 用户与权限管理

#### 管理员注册用户

*   **URL**: `/api/v1/users`
*   **Method**: `POST`
*   **Description**: 仅管理员可用，用于注册其他管理员或VIP用户
*   **Parameters**:
    *   `email` (string, required): 邮箱
    *   `password` (string, required): 密码
    *   `code` (string, required): 角色 (admin/vip_user/user)
    *   `id` (int, optional): 操作人ID

#### 修改密码
*   **URL**: `/api/v1/users/me/password`
*   **Method**: `PUT`
*   **Description**: 用户自行修改密码
*   **Parameters**:
    *   `password` (string, required): 旧密码
    *   `new_password` (string, required): 新密码

#### 用户列表
*   **URL**: `/api/v1/users`
*   **Method**: `GET`
*   **Description**: 管理员查看用户列表
*   **Parameters**:
    *   `current` (int, optional): 当前页
    *   `size` (int, optional): 页大小

#### 修改用户权限
*   **URL**: `/api/v1/users/{id}/permissions`
*   **Method**: `PUT`
*   **Description**: 管理员修改用户权限或密码
*   **Parameters**:
    *   `id` (int, path, required): 目标用户ID（已迁移至 URL 路径段，不再通过请求体传递）
    *   `code` (string, body, optional): 新角色代码
    *   `password` (string, body, optional): 重置密码

#### 管理员手动解锁用户
*   **URL**: `/api/v1/users/{id}/unlock`
*   **Method**: `POST`
*   **Description**: 管理员手动解除用户账户的锁定状态（包括登录失败计数清零）
*   **Parameters**:
    *   `id` (int, path, required): 目标用户ID（原请求体字段 `user_id`，已迁移至 URL 路径段）

#### 用户工具权限
*   **URL**: `/api/v1/users/me/tool-permissions`
*   **Method**: `GET`
*   **Description**: 获取当前用户可用的工具权限

#### 用户反馈
*   **URL**: `/api/v1/user-feedback`
*   **Method**: `POST`
*   **Description**: 提交用户反馈
*   **Parameters**:
    *   `feedback_type` (string, required): 反馈类型
    *   `feedback_content` (string, required): 内容

### 2.3 任务与日志 (Agent)

#### 任务列表
*   **URL**: `/api/v1/async-tasks`
*   **Method**: `GET`
*   **Parameters**:
    *   `current` (int, optional): 当前页
    *   `size` (int, optional): 页大小

#### 任务状态
*   **URL**: `/api/v1/async-tasks/{id}`
*   **Method**: `GET`
*   **Parameters**:
    *   `id` (int, path, required): 任务ID（已迁移至 URL 路径段，原为查询参数 `id`）

#### 获取分析日志
*   **URL**: `/api/v1/async-tasks/{id}/analyst-log`
*   **Method**: `GET`
*   **Parameters**:
    *   `id` (int, path, required): 日志ID（已迁移至 URL 路径段，原为查询参数 `id`）

#### 更新分析日志（Bot 回写接口）
*   **URL**: `/api/v1/async-tasks/analyst-log`
*   **Method**: `PATCH`
*   **Description**: 跨仓 Bot 回写接口。**注意：旧路径 `POST /query/analyst/update_log` 作为临时别名继续提供服务，直至 Bot 侧完成迁移。**

#### 查询操作日志
*   **URL**: `/api/v1/operation-logs`
*   **Method**: `GET`
*   **Description**: 查询用户操作日志，支持按用户ID和时间范围筛选。仅管理员可访问（admin/super_admin）。
*   **Parameters**:
    *   `user_ids` (string, query, optional): 用户ID列表，逗号分隔，例如 "1,2,3"（原请求体字段，已迁移至查询字符串）
    *   `start_time` (string, query, optional): 开始时间，格式 "2006-01-02 15:04:05"（原请求体字段，已迁移至查询字符串）
    *   `end_time` (string, query, optional): 结束时间，格式 "2006-01-02 15:04:05"（原请求体字段，已迁移至查询字符串）

### 2.4 基因数据与文件下载

#### 基因列表
*   **URL**: `/api/v1/genes`
*   **Method**: `GET`
*   **Parameters**:
    *   `current` (int, optional): 当前页
    *   `size` (int, optional): 页大小
    *   `title` (string, optional): 搜索标题

#### 基因详情
*   **URL**: `/api/v1/genes/{id}`
*   **Method**: `GET`
*   **Parameters**:
    *   `id` (string, path, required): 基因文件名（原查询参数 `file_name`，已迁移至 URL 路径段）

#### 基因数据存储
*   **URL**: `/api/v1/gene-examples`
*   **Method**: `POST`
*   **Content-Type**: `multipart/form-data`
*   **Parameters**:
    *   `species_code` (string, required): 物种代码
    *   `gene_id` (string, required): 基因ID
    *   `doc_list` (file, required): JSON文件
    *   `files` (file[], required): 文件列表
    *   `images` (file[], required): 图片列表

#### 下载Analyst文件
*   **URL**: `/api/v1/downloads/analyst-agent/obs-file`
*   **Method**: `GET`
*   **Parameters**:
    *   `obs_path` (string, required): OBS路径

#### 文件格式转换下载
*   **URL**: `/api/v1/downloads/rendering-file`
*   **Method**: `POST`
*   **Parameters**:
    *   `id` (int, required): 记录ID
    *   `document_format` (string, required): 目标格式

---

## 3. 服务端内部接口 (Server)
路径前缀 `/api/v1/server`。

#### 创建任务
*   **URL**: `/api/v1/server/tasks`
*   **Method**: `POST`
*   **Description**: **注意：旧路径 `POST /v1/nky/server/create_task` 作为临时别名继续提供服务，直至外部调用方完成迁移。**
*   **Parameters**:
    *   `server_id` (string, required): 服务ID
    *   `server_status` (string, required): 状态
    *   `tool_name` (string, required): 工具名

#### 更新任务
*   **URL**: `/api/v1/server/tasks/{id}`
*   **Method**: `PATCH`
*   **Description**: **注意：旧路径 `POST /v1/nky/server/update_task` 作为临时别名继续提供服务，直至外部调用方完成迁移。**
*   **Parameters**:
    *   `id` (string, path, required): 服务ID（原请求体字段 `server_id`，已迁移至 URL 路径段）
    *   `tool_result` (string, required): 结果
    *   `server_file_path` (string, required): 文件路径
    *   `server_status` (string, required): 状态
