# 行动代号

行动代号是一个两队对抗的派对桌游，桌上摆着 25 个词语，两队需要根据线索官给的提示，进行轮流猜词，猜到对方的词会帮倒忙，猜到“特工”直接输掉，先找出己方全部词语的队伍获胜。

本项目是一个在线行动代号游戏，前端使用 **Vue.js** ，后端使用 **Express + Socket.IO**

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
sudo ./deploy/codenames-deploy.sh nginx-install
```

如果存在多个候选 nginx 站点配置，脚本无法安全自动判断时，可以显式指定目标文件：

```bash
sudo NGINX_SERVER_CONF=/etc/nginx/sites-enabled/your-site ./deploy/codenames-deploy.sh nginx-install
```

### 3. 服务器启动服务

```bash
./deploy/codenames-deploy.sh run
./deploy/codenames-deploy.sh stop
./deploy/codenames-deploy.sh restart
./deploy/codenames-deploy.sh status
./deploy/codenames-deploy.sh logs
```

默认服务参数：

- 访问路径：`/codenames`
- Node 端口：`3001`
