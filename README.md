# Codenames Web

一个轻量级的网页多人版 Codenames，前端使用 Vue 3，后端使用 Node.js + Express + Socket.IO，默认部署路径为 `/codenames`。

## 环境要求

- Node.js 18+
- npm 9+

## 项目结构

- `client/`：Vue 前端
- `server/`：Express + Socket.IO 后端
- `shared/`：前后端共享类型
- `server/data/vocabulary.json`：服务端实际使用的词库
- `deploy/nginx-codenames.conf`：Nginx 反代示例

## 本地开发

1. 安装依赖

```bash
npm install
```

2. 启动前后端开发模式

```bash
npm run dev
```

默认会启动两个进程：

- 前端 Vite 开发服务器
- 后端 Node 服务，默认端口 `3000`

启动后访问：

- 前端开发页：通常是 Vite 输出的本地地址
- 实际联机路径：`http://localhost:3000/codenames`

说明：

- 前端路由基路径固定为 `/codenames/`
- Socket.IO 路径固定为 `/codenames/socket.io`
- Vite 已配置代理 `/codenames/socket.io` 到本地 `3000` 端口

## 生产构建

1. 构建前端和后端

```bash
npm run build
```

2. 启动生产服务

```bash
npm run start
```

默认监听：

- `PORT=3000`
- `BASE_PATH=/codenames`

也可以显式指定：

```bash
PORT=3000 BASE_PATH=/codenames npm run start
```

构建产物：

- 前端静态文件：`dist/client/`
- 后端编译输出：`dist/server/`

## Nginx 部署

Node 服务跑在本机 `3000` 端口时，可以在 Nginx 里挂一个 `/codenames/` 反代。

示例见：

- [deploy/nginx-codenames.conf](/home/leory/codes/CodeNames/deploy/nginx-codenames.conf)

核心配置如下：

```nginx
location /codenames/ {
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_pass http://127.0.0.1:3000;
}
```

## 当前已实现内容

- 公开大厅
- 创建房间、加入房间
- 昵称本地保存
- 红蓝方/旁观切换
- 等待阶段准备与开局
- draft 翻面阶段
- 自动分配红蓝/黑/白词
- 队长提示词与数字
- 队员试选、确认、继续/放弃投票
- 公屏聊天
- 内存房间状态同步
- 服务器日志按房间落盘

## 当前限制

- 房间状态只保存在内存中，服务重启后房间会丢失
- 日志保存在 `server/logs/`
- 当前仓库虽然已经有代码和依赖，但我还没有完成一次最终的 `npm run build` 验证；如果启动时报编译或类型错误，需要继续修一轮

## 常用命令

```bash
npm run dev
npm run build
npm run start
```
