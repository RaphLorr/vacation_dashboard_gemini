# 请假记录看板系统 (Leave Record Board)

员工请假记录可视化看板，支持企业微信自动同步、实时回调通知、动态日期范围与节假日检测。

## 功能特点

- **企业微信同步**: 自动从企业微信审批 API 拉取请假数据，支持增量同步与状态检查
- **实时回调通知**: 接收企业微信消息回调，秒级响应审批变更（新建/通过/驳回/撤销）
- **可视化看板**: 日历视图展示请假、加班、休假情况，支持半天假显示
- **动态日期范围**: 自定义起止日期，自动获取中国法定节假日与调休数据
- **部门筛选**: 按部门筛选查看，支持全选/清空
- **OAuth 登录**: 企业微信扫码登录，基于 session 的身份认证
- **数据持久化**: 服务端 JSON 文件存储，重启不丢失

## 快速开始

### 前置要求

- [Node.js](https://nodejs.org/) v16+
- 企业微信管理后台应用配置（用于 API 同步和 OAuth 登录）

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
```

编辑 `.env.local` 填入企业微信凭证和相关配置，参考 `.env.example` 中的注释说明。

### 3. 启动服务器

```bash
npm start
```

### 4. 访问应用

```
http://localhost:10890
```

## 架构

### 技术栈

- **Frontend**: HTML, Vanilla JS, Tailwind CSS (CDN), XLSX/SheetJS (CDN)
- **Backend**: Node.js, Express
- **Storage**: JSON 文件 (`leave_data.json`)
- **API**: 企业微信审批 API、节假日 API (阿里云万维易源)

### 数据同步机制

系统通过三种互补机制保持数据实时：

| 机制 | 频率 | 作用 |
|------|------|------|
| **回调通知** | 实时 | 企业微信推送审批变更事件，秒级处理 |
| **增量同步** | 每 5 分钟 | 轮询新提交的审批记录（回调的安全网） |
| **状态检查** | 每 5 分钟 | 复查待审批记录的状态变更 |

回调通知处理审批的完整生命周期：
- **新建** (status=1): 获取详情 -> 合并到看板 -> 加入活跃审批跟踪
- **通过** (status=2): 更新日期状态为"已通过" -> 移出活跃列表
- **驳回/撤销** (status=3/4/6): 更新日期状态 -> 移出活跃列表

并发保护：所有写入操作共享同一把锁（`sync-lock`），回调与定时任务不会冲突。遇到锁冲突时回调事件自动排队，2 秒后重试。

### 合并策略

- 企业微信数据优先（source of truth）
- "已通过" 优先于 "审批中"
- 同一审批重复处理是幂等的

### 项目结构

```
server.js                  # Express 服务器 + API 路由
leave-board.html           # 前端 SPA (独立 HTML)
services/
  wecom-service.js         # 企业微信 API 集成
  wecom-crypto.js          # 消息回调 AES-256-CBC 加解密
  callback-handler.js      # 回调事件处理 + 队列
  sync-scheduler.js        # 定时增量同步 + 状态检查
  sync-lock.js             # 全局同步锁
  active-approvals.js      # 待审批活跃列表管理
  holiday-service.js       # 节假日 API 集成
  auth-service.js          # OAuth + Session 管理
  user-service.js          # 用户数据管理
middleware/
  auth-middleware.js        # 认证中间件
```

### API 端点

#### 回调 (无需认证，签名验证)

| Method | Path | 说明 |
|--------|------|------|
| GET | `/callback` | 企业微信 URL 验证 |
| POST | `/callback` | 接收加密事件通知 |

#### 认证

| Method | Path | 说明 |
|--------|------|------|
| GET | `/auth/callback` | OAuth 回调 |
| POST | `/auth/logout` | 登出 |
| GET | `/api/auth/config` | 前端登录配置 |
| GET | `/api/auth/jssdk-signature` | JS-SDK 签名 |
| GET | `/api/user/me` | 当前用户信息 |

#### 请假数据 (需认证)

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/leave-records` | 获取所有请假记录 |
| POST | `/api/leave-records` | 保存请假记录 |
| POST | `/api/wecom/sync` | 手动触发企业微信同步 |

#### 节假日

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/holidays/dateconfig` | 获取日期配置（含节假日） |
| GET | `/api/holidays/default-range` | 获取默认日期范围 |

#### 同步管理

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/sync/status` | 同步状态 |
| POST | `/api/sync/start` | 启动定时同步 |
| POST | `/api/sync/stop` | 停止定时同步 |
| POST | `/api/sync/reset` | 重置同步状态 |
| POST | `/api/sync/trigger` | 手动触发增量同步 |
| POST | `/api/status-check/trigger` | 手动触发状态检查 |
| GET | `/api/active-approvals` | 查看活跃审批列表 |

## 配置

### 企业微信回调设置

在企业微信管理后台配置消息接收：

1. 进入 **应用管理 > 自建应用 > 接收消息**
2. URL: `https://your-domain.com/callback`
3. Token 和 EncodingAESKey 填入 `.env.local`
4. 勾选 **审批状态变化通知 (sys_approval_change)**

### PM2 部署 (生产环境)

```bash
pm2 start ecosystem.config.js
```

配置文件 `ecosystem.config.js` 已包含日志、内存限制和自动重启策略。

### Nginx 反向代理

参考 `nginx.conf` 进行配置。

## License

MIT
