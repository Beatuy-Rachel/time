# 跨设备同步方案

当前原型的数据保存在浏览器 `localStorage`，适合单设备试用，但不会自动同步到手机、平板或其他浏览器。

推荐使用 Supabase：

1. 创建 Supabase 项目并启用邮箱登录。
2. 建立 `user_data` 表：`user_id uuid primary key`、`payload jsonb not null`、`updated_at timestamptz not null`。
3. 开启 RLS，只允许用户读写 `user_id = auth.uid()` 的数据。
4. 将项目 URL、匿名 key 和登录入口接入应用的同步层。

真正接入前还需要确定登录方式和冲突策略。建议默认使用“最后一次更新时间较新的设备覆盖旧版本”，并保留手动导出 JSON 作为备份。

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
chmod +x deploy.sh
./deploy.sh
```

脚本参考 `love-backend` 的部署方式，包含并发锁、镜像拉取、Compose 更新和健康检查，可以重复执行，用于首次部署或更新服务。默认参数如下：

```bash
IMAGE=ghcr.io/beatuy-rachel/time IMAGE_TAG=latest \
HOST_PORT=8080 ./deploy.sh
```

脚本实际使用 Compose，端口和镜像参数通过环境变量传给 `compose.yaml`。推荐按需设置 `HOST_PORT` 和 `IMAGE_TAG`。

如果 GHCR 镜像是私有的，先设置登录信息再执行，Token 只通过标准输入交给 Docker，不会写入脚本：

```bash
export GHCR_USERNAME=Beatuy-Rachel
export GHCR_TOKEN='具有 read:packages 权限的 Token'
./deploy.sh
```
