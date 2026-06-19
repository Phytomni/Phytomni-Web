# API 接口文档

## 基础信息
*   **Base URL**: `http://localhost:8082`
*   **Content-Type**: `application/x-www-form-urlencoded` (除非特别说明)

---

## 1. 认证模块 (Auth)
无需 Token 即可访问。

### 1.1 用户注册
*   **URL**: `/auth/user/register`
*   **Method**: `POST`
*   **Description**: 自主注册普通用户
*   **Parameters**:
    *   `email` (string, required): 邮箱
    *   `password` (string, required): 密码

### 1.2 用户登录
*   **URL**: `/auth/login`
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
*   **URL**: `/auth/download/obs_file`
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
*   **URL**: `/v1/query/list`
*   **Method**: `GET`
*   **Description**: 查看用户所有历史问答列表

#### 查询子级对话
*   **URL**: `/v1/answer/check`
*   **Method**: `GET`
*   **Description**: 根据对话ID查找全部子级对话
*   **Parameters**:
    *   `dialogue_id` (string, required): 对话ID

#### 删除问题
*   **URL**: `/v1/query/list/delete`
*   **Method**: `POST`
*   **Description**: 软删除指定问题
*   **Parameters**:
    *   `id` (int, required): 问题ID

#### 重命名问题
*   **URL**: `/v1/query/list/rename`
*   **Method**: `POST`
*   **Description**: 重命名问题列表项
*   **Parameters**:
    *   `id` (int, required): 问题ID
    *   `rename` (string, required): 新名称

#### 点赞/点踩
*   **URL**: `/v1/query/reaction_type`
*   **Method**: `POST`
*   **Description**: 对对话进行评价
*   **Parameters**:
    *   `id` (int, required): 记录ID
    *   `reaction_type` (string, required): 类型 (0:无, 1:赞, 2:踩)

#### 收藏对话
*   **URL**: `/v1/query/collect`
*   **Method**: `POST`
*   **Description**: 收藏或取消收藏对话
*   **Parameters**:
    *   `id` (int, required): 记录ID
    *   `collect_type` (string, required): 类型 (0:取消, 1:收藏)

#### 收藏列表
*   **URL**: `/v1/query/collect/list`
*   **Method**: `GET`
*   **Description**: 获取用户收藏的所有对话

### 2.2 用户与权限管理

#### 管理员注册用户

*   **URL**: `/v1/register`
*   **Method**: `POST`
*   **Description**: 仅管理员可用，用于注册其他管理员或VIP用户
*   **Parameters**:
    *   `email` (string, required): 邮箱
    *   `password` (string, required): 密码
    *   `code` (string, required): 角色 (admin/vip_user/user)
    *   `id` (int, optional): 操作人ID

#### 修改密码
*   **URL**: `/v1/modify/password`
*   **Method**: `POST`
*   **Description**: 用户自行修改密码
*   **Parameters**:
    *   `password` (string, required): 旧密码
    *   `new_password` (string, required): 新密码

#### 用户列表
*   **URL**: `/v1/permission/user/list`
*   **Method**: `GET`
*   **Description**: 管理员查看用户列表
*   **Parameters**:
    *   `current` (int, optional): 当前页
    *   `size` (int, optional): 页大小

#### 修改用户权限
*   **URL**: `/v1/modify/permission`
*   **Method**: `POST`
*   **Description**: 管理员修改用户权限或密码
*   **Parameters**:
    *   `id` (int, required): 目标用户ID
    *   `code` (string, optional): 新角色代码
    *   `password` (string, optional): 重置密码

#### 管理员手动解锁用户
*   **URL**: `/v1/user/unlock`
*   **Method**: `POST`
*   **Description**: 管理员手动解除用户账户的锁定状态（包括登录失败计数清零）
*   **Parameters**:
    *   `user_id` (int, required): 目标用户ID

#### 用户工具权限
*   **URL**: `/v1/permission/user/tool`
*   **Method**: `GET`
*   **Description**: 获取当前用户可用的工具权限

#### 用户反馈
*   **URL**: `/v1/user/feedback`
*   **Method**: `POST`
*   **Description**: 提交用户反馈
*   **Parameters**:
    *   `feedback_type` (string, required): 反馈类型
    *   `feedback_content` (string, required): 内容

### 2.3 任务与日志 (Agent)

#### 任务列表
*   **URL**: `/v1/async_task/list`
*   **Method**: `GET`
*   **Parameters**:
    *   `current` (int, optional): 当前页
    *   `size` (int, optional): 页大小

#### 任务状态
*   **URL**: `/v1/async_task/info`
*   **Method**: `GET`
*   **Parameters**:
    *   `id` (int, required): 任务ID

#### 获取分析日志
*   **URL**: `/v1/analyst/get_log`
*   **Method**: `GET`
*   **Parameters**:
    *   `id` (int, required): 日志ID

#### 查询操作日志
*   **URL**: `/v1/operation/logs`
*   **Method**: `POST`
*   **Description**: 查询用户操作日志，支持按用户ID和时间范围筛选。
*   **Parameters**:
    *   `user_ids` (string, optional): 用户ID列表，逗号分隔，例如 "1,2,3"
    *   `start_time` (string, optional): 开始时间，格式 "2006-01-02 15:04:05"
    *   `end_time` (string, optional): 结束时间，格式 "2006-01-02 15:04:05"

### 2.4 基因数据与文件下载

#### 基因列表
*   **URL**: `/v1/gene/list`
*   **Method**: `GET`
*   **Parameters**:
    *   `current` (int, optional): 当前页
    *   `size` (int, optional): 页大小
    *   `title` (string, optional): 搜索标题

#### 基因详情
*   **URL**: `/v1/gene/details`
*   **Method**: `GET`
*   **Parameters**:
    *   `id` (int, required): 基因ID

#### 基因数据存储
*   **URL**: `/v1/gene/details/storage`
*   **Method**: `POST`
*   **Content-Type**: `multipart/form-data`
*   **Parameters**:
    *   `species_code` (string, required): 物种代码
    *   `gene_id` (string, required): 基因ID
    *   `doc_list` (file, required): JSON文件
    *   `files` (file[], required): 文件列表
    *   `images` (file[], required): 图片列表

#### 下载Analyst文件
*   **URL**: `/v1/download/analyst_agent/obs_file`
*   **Method**: `GET`
*   **Parameters**:
    *   `obs_path` (string, required): OBS路径

#### 文件格式转换下载
*   **URL**: `/v1/download/rendering_file`
*   **Method**: `POST`
*   **Parameters**:
    *   `id` (int, required): 记录ID
    *   `document_format` (string, required): 目标格式

---

## 3. 服务端内部接口 (Server)
路径前缀 `/v1/nky/server`。

#### 创建任务
*   **URL**: `/v1/nky/server/create_task`
*   **Method**: `POST`
*   **Parameters**:
    *   `server_id` (string, required): 服务ID
    *   `server_status` (string, required): 状态
    *   `tool_name` (string, required): 工具名

#### 更新任务
*   **URL**: `/v1/nky/server/update_task`
*   **Method**: `POST`
*   **Parameters**:
    *   `server_id` (string, required): 服务ID
    *   `tool_result` (string, required): 结果
    *   `server_file_path` (string, required): 文件路径
    *   `server_status` (string, required): 状态
