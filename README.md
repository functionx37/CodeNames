# Codenames Web

## 环境要求

- 本地构建机
  - Node.js 18+
  - npm 9+
  - rsync
  - ssh
- 服务器
  - Node.js 18+
  - nginx
  - rsync
  - sudo

## 项目架构

- `client/`
  - Vue 3 前端工程，生产构建后输出到 `dist/client/`
- `server/`
  - Express + Socket.IO 服务端
  - 词库文件位于 `server/data/vocabulary.json`
  - 运行日志写入 `server/logs/`
- `shared/`
  - 前后端共享类型
- `dist/`
  - 本地构建产物
  - `dist/client/` 为前端静态资源
  - `dist/server/` 为服务端编译输出
- `deploy/`
  - `codenames-publish.sh`：本地构建并上传到服务器
  - `codenames-deploy.sh`：服务器启动、停止和 nginx 配置安装
  - `nginx-codenames.conf`：`/codenames` 路径的 nginx 片段

部署模式：

- 本地机器负责构建前端和后端
- 本地机器将发布包上传到服务器 `/var/www/codenames`
- nginx 直接托管 `/var/www/codenames/dist/client`
- Node 服务运行在 `3001` 端口
- nginx 将 `/codenames/api/` 和 `/codenames/socket.io/` 反代到 `127.0.0.1:3001`

## 部署方法

### 1. 本地打包并上传

仅打包到本地发布目录：

```bash
./deploy/codenames-publish.sh stage
```

打包并上传到服务器：

```bash
./deploy/codenames-publish.sh push <user@host>
```

打包、上传并在服务器重启服务：

```bash
./deploy/codenames-publish.sh push-and-restart <user@host>
```

默认上传目录：

```bash
/var/www/codenames
```

### 2. 服务器安装 nginx 配置

进入发布目录：

```bash
cd /var/www/codenames
```

安装 nginx 片段：

```bash
./deploy/codenames-deploy.sh nginx-install
```

然后把下面这行加到你现有 nginx 的 `server` 块中：

```nginx
include /etc/nginx/snippets/codenames.conf;
```

最后检查并重载 nginx：

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### 3. 服务器启动服务

启动：

```bash
./deploy/codenames-deploy.sh run
```

停止：

```bash
./deploy/codenames-deploy.sh stop
```

重启：

```bash
./deploy/codenames-deploy.sh restart
```

查看状态：

```bash
./deploy/codenames-deploy.sh status
```

查看日志：

```bash
./deploy/codenames-deploy.sh logs
```

默认服务参数：

- 访问路径：`/codenames`
- Node 端口：`3001`
