# 跨设备同步方案

应用现在内置轻量账号和同步服务。未登录时数据仍保存在浏览器 `localStorage`；登录后，时间、饮食、复盘、皮肤、计划和设置会保存到服务器账号，在手机、平板和电脑之间同步。

## 部署同步服务

在服务器上准备 `.env`，至少设置一个随机长密钥：

```bash
cp .env.example .env
openssl rand -hex 32
```

将生成的值填入 `AUTH_SECRET`，然后执行 `./deploy.sh`。默认通过服务器的 `8080` 端口访问，账号数据保存在服务器同目录的 `./data`，升级镜像不会丢失。请给站点配置 HTTPS，不要在公网 HTTP 下输入密码。

首次登录的设备会把本地数据上传到新账号；已有云端数据时，登录设备恢复云端数据。之后保存记录会自动同步，离线时继续使用本地数据。

## 使用 GitHub Actions 构建镜像

每次推送到 `main` 分支都会自动构建并发布镜像到 GitHub Container Registry（GHCR）：

```text
ghcr.io/beatuy-rachel/time:latest
```

工作流文件位于 `.github/workflows/publish-image.yml`。首次使用时，请在 GitHub 仓库的 `Settings > Actions > General` 确认允许 Actions 创建和写入 packages。

服务器登录并拉取镜像：

```bash
echo "$CR_PAT" | docker login ghcr.io -u Beatuy-Rachel --password-stdin
docker pull ghcr.io/beatuy-rachel/time:latest
docker rm -f time-record 2>/dev/null || true
docker run -d --name time-record --restart unless-stopped -p 8080:80 ghcr.io/beatuy-rachel/time:latest
```

然后访问服务器的 `8080` 端口。若镜像设置为公开，服务器拉取时不需要登录；若设置为私有，需要使用具有 `read:packages` 权限的 GitHub Token 登录。

### 使用自动部署脚本

将仓库中的 `deploy.sh` 和 `compose.yaml` 下载到服务器同一个目录并执行：

```bash
cp .env.example .env
# 按需修改 .env 中的端口、镜像标签等配置
chmod +x deploy.sh
./deploy.sh
```

脚本参考 `love-backend` 的部署方式，包含并发锁、镜像拉取、Compose 更新和健康检查，可以重复执行，用于首次部署或更新服务。默认参数如下：

```bash
IMAGE=ghcr.io/beatuy-rachel/time IMAGE_TAG=latest \
HOST_PORT=8080 ./deploy.sh
```

脚本实际使用 Compose，端口和镜像参数通过环境变量传给 `compose.yaml`。推荐按需设置 `HOST_PORT` 和 `IMAGE_TAG`。

脚本会自动读取同目录下的 `.env`。如果 GHCR 镜像是私有的，可以将登录信息写入服务器上的 `.env`，Token 只通过标准输入交给 Docker，不会写入脚本：

```bash
export GHCR_USERNAME=Beatuy-Rachel
export GHCR_TOKEN='具有 read:packages 权限的 Token'
./deploy.sh
```
