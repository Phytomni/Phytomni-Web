# API Documentation

## Base Information

> **API Prefix Change Notice**: The Go business API has been fully migrated to the RESTful `/api/v1` prefix scheme. All protected business endpoint paths begin with `/api/v1`; verb semantics are carried by the HTTP Method. CORS preflight (OPTIONS) is handled automatically by the CORS middleware and is not listed as an explicit route.

*   **Base URL**: `http://localhost:8080`
*   **Content-Type**: `application/x-www-form-urlencoded` (unless otherwise specified)

---

## 1. Authentication Module (Auth)
No Token required to access.

### 1.1 User Registration
*   **URL**: `/api/v1/auth/registrations`
*   **Method**: `POST`
*   **Description**: Self-register as a regular user
*   **Parameters**:
    *   `email` (string, required): Email address
    *   `password` (string, required): Password

### 1.2 User Login
*   **URL**: `/api/v1/auth/sessions`
*   **Method**: `POST`
*   **Description**: Log in and obtain a Token
*   **Parameters**:
    *   `email` (string, required): Email address
    *   `password` (string, required): Password
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

### 1.3 Download OBS File
*   **URL**: `/api/v1/downloads/obs-file`
*   **Method**: `GET`
*   **Description**: Generate and redirect to a download link
*   **Parameters**:
    *   `obs_path` (string, required): OBS path
    *   `username` (string, required): Username

---

## 2. Business Module (V1)
**Note**: All endpoints require `Authorization: Bearer <token>` in the request Header.

### 2.1 Q&A and Conversation Management

#### List Conversations
*   **URL**: `/api/v1/conversations`
*   **Method**: `GET`
*   **Description**: Retrieve all historical Q&A entries for the current user

#### Get Child Messages
*   **URL**: `/api/v1/conversations/{id}/messages`
*   **Method**: `GET`
*   **Description**: Retrieve all child messages by conversation ID
*   **Parameters**:
    *   `id` (int, path, required): Conversation ID (formerly the `dialogue_id` query parameter, now migrated to URL path segment)

#### Delete Conversation
*   **URL**: `/api/v1/conversations/{id}`
*   **Method**: `DELETE`
*   **Description**: Soft-delete the specified conversation
*   **Parameters**:
    *   `id` (int, path, required): Conversation ID (migrated to URL path segment; no request body required)

#### Rename Conversation
*   **URL**: `/api/v1/conversations/{id}`
*   **Method**: `PATCH`
*   **Description**: Rename a conversation list item
*   **Parameters**:
    *   `id` (int, path, required): Conversation ID (migrated to URL path segment)
    *   `rename` (string, body, required): New name

#### Like / Dislike
*   **URL**: `/api/v1/conversations/{id}/reaction`
*   **Method**: `PUT`
*   **Description**: Rate a conversation
*   **Parameters**:
    *   `id` (int, path, required): Record ID (migrated to URL path segment)
    *   `reaction_type` (string, body, required): Type (0: none, 1: like, 2: dislike)

#### Favorite Conversation
*   **URL**: `/api/v1/conversations/{id}/favorite`
*   **Method**: `PUT`
*   **Description**: Favorite or un-favorite a conversation
*   **Parameters**:
    *   `id` (int, path, required): Record ID (migrated to URL path segment)
    *   `collect_type` (string, body, required): Type (0: cancel, 1: favorite)

#### Favorites List
*   **URL**: `/api/v1/conversations?favorite=true`
*   **Method**: `GET`
*   **Description**: Retrieve all conversations favorited by the current user

### 2.2 User and Permission Management

#### Admin Register User

*   **URL**: `/api/v1/users`
*   **Method**: `POST`
*   **Description**: Admin-only; used to register other admins or VIP users
*   **Parameters**:
    *   `email` (string, required): Email address
    *   `password` (string, required): Password
    *   `code` (string, required): Role (admin/vip_user/user)
    *   `id` (int, optional): Operator ID

#### Change Password
*   **URL**: `/api/v1/users/me/password`
*   **Method**: `PUT`
*   **Description**: User changes their own password
*   **Parameters**:
    *   `password` (string, required): Current password
    *   `new_password` (string, required): New password

#### User List
*   **URL**: `/api/v1/users`
*   **Method**: `GET`
*   **Description**: Admin view of the user list
*   **Parameters**:
    *   `current` (int, optional): Current page
    *   `size` (int, optional): Page size

#### Update User Permissions
*   **URL**: `/api/v1/users/{id}/permissions`
*   **Method**: `PUT`
*   **Description**: Admin updates a user's role or password
*   **Parameters**:
    *   `id` (int, path, required): Target user ID (migrated to URL path segment; no longer passed in request body)
    *   `code` (string, body, optional): New role code
    *   `password` (string, body, optional): Reset password

#### Admin Manually Unlock User
*   **URL**: `/api/v1/users/{id}/unlock`
*   **Method**: `POST`
*   **Description**: Admin manually removes the lock on a user account (including resetting the failed-login counter to zero)
*   **Parameters**:
    *   `id` (int, path, required): Target user ID (formerly request body field `user_id`, now migrated to URL path segment)

#### User Tool Permissions
*   **URL**: `/api/v1/users/me/tool-permissions`
*   **Method**: `GET`
*   **Description**: Retrieve the tool permissions available to the current user

#### User Feedback
*   **URL**: `/api/v1/user-feedback`
*   **Method**: `POST`
*   **Description**: Submit user feedback
*   **Parameters**:
    *   `feedback_type` (string, required): Feedback type
    *   `feedback_content` (string, required): Content

### 2.3 Tasks and Logs (Agent)

#### Task List
*   **URL**: `/api/v1/async-tasks`
*   **Method**: `GET`
*   **Parameters**:
    *   `current` (int, optional): Current page
    *   `size` (int, optional): Page size

#### Task Status
*   **URL**: `/api/v1/async-tasks/{id}`
*   **Method**: `GET`
*   **Parameters**:
    *   `id` (int, path, required): Task ID (migrated to URL path segment; formerly query parameter `id`)

#### Get Analyst Log
*   **URL**: `/api/v1/async-tasks/{id}/analyst-log`
*   **Method**: `GET`
*   **Parameters**:
    *   `id` (int, path, required): Log ID (migrated to URL path segment; formerly query parameter `id`)

#### Update Analyst Log (Bot Write-back Endpoint)
*   **URL**: `/api/v1/async-tasks/analyst-log`
*   **Method**: `PATCH`
*   **Description**: Cross-repo Bot write-back endpoint. **Note: The legacy path `POST /query/analyst/update_log` continues to be served as a temporary alias until the Bot side completes migration.**

#### Query Operation Logs
*   **URL**: `/api/v1/operation-logs`
*   **Method**: `GET`
*   **Description**: Query user operation logs with filtering by user ID and time range. Accessible to admins only (admin/super_admin).
*   **Parameters**:
    *   `user_ids` (string, query, optional): Comma-separated list of user IDs, e.g. "1,2,3" (formerly request body field, now migrated to query string)
    *   `start_time` (string, query, optional): Start time, format "2006-01-02 15:04:05" (formerly request body field, now migrated to query string)
    *   `end_time` (string, query, optional): End time, format "2006-01-02 15:04:05" (formerly request body field, now migrated to query string)

### 2.4 Gene Data and File Downloads

#### Gene List
*   **URL**: `/api/v1/genes`
*   **Method**: `GET`
*   **Parameters**:
    *   `current` (int, optional): Current page
    *   `size` (int, optional): Page size
    *   `title` (string, optional): Search title

#### Gene Details
*   **URL**: `/api/v1/genes/{id}`
*   **Method**: `GET`
*   **Parameters**:
    *   `id` (string, path, required): Gene file name (formerly query parameter `file_name`, now migrated to URL path segment)

#### Store Gene Data
*   **URL**: `/api/v1/gene-examples`
*   **Method**: `POST`
*   **Content-Type**: `multipart/form-data`
*   **Parameters**:
    *   `species_code` (string, required): Species code
    *   `gene_id` (string, required): Gene ID
    *   `doc_list` (file, required): JSON file
    *   `files` (file[], required): File list
    *   `images` (file[], required): Image list

#### Download Analyst File
*   **URL**: `/api/v1/downloads/analyst-agent/obs-file`
*   **Method**: `GET`
*   **Parameters**:
    *   `obs_path` (string, required): OBS path

#### Download File with Format Conversion
*   **URL**: `/api/v1/downloads/rendering-file`
*   **Method**: `POST`
*   **Parameters**:
    *   `id` (int, required): Record ID
    *   `document_format` (string, required): Target format

---

## 3. Server-Internal Endpoints (Server)
Path prefix `/api/v1/server`.

#### Create Task
*   **URL**: `/api/v1/server/tasks`
*   **Method**: `POST`
*   **Description**: **Note: The legacy path `POST /v1/nky/server/create_task` continues to be served as a temporary alias until external callers complete migration.**
*   **Parameters**:
    *   `server_id` (string, required): Service ID
    *   `server_status` (string, required): Status
    *   `tool_name` (string, required): Tool name

#### Update Task
*   **URL**: `/api/v1/server/tasks/{id}`
*   **Method**: `PATCH`
*   **Description**: **Note: The legacy path `POST /v1/nky/server/update_task` continues to be served as a temporary alias until external callers complete migration.**
*   **Parameters**:
    *   `id` (string, path, required): Service ID (formerly request body field `server_id`, now migrated to URL path segment)
    *   `tool_result` (string, required): Result
    *   `server_file_path` (string, required): File path
    *   `server_status` (string, required): Status
