# 1Panel 部署：中国芯 · 强国梦

代码仓库：https://github.com/Alumos/chinacore-classroom

成品镜像：`ghcr.io/alumos/chinacore-classroom:latest`

架构：**Linux x86_64（linux/amd64）**。默认宿主机端口：**18080**。

## 在 1Panel 中创建编排

1. 打开 1Panel 的「容器 → 编排」，选择创建编排。
2. 名称填写 `chinacore-classroom`，选择输入或编辑 Compose 内容。
3. 将仓库中的 **compose.1panel.yaml** 内容完整粘贴进去。
4. 点击创建/启动。Docker 会下载 GitHub Actions 构建的镜像，无需上传源码，也无需在服务器安装 Go 或 Node。
5. 在 VPS 安全组和实际使用的防火墙中放行 TCP 18080，然后访问下面的入口。

| 页面 | URL |
| --- | --- |
| 大屏 | `http://服务器IP:18080/screen` |
| 学生 | `http://服务器IP:18080/join` |
| 教师后台 | `http://服务器IP:18080/teacher` |

教师直接进入后台，学生扫码直接投稿，无需教师口令或班级码。大屏二维码使用当前 IP / 域名生成。后台可审核、增删改查、清空全部弹幕和统计、播放同步的鎏金收束动画。

## 数据与更新

数据库保存在命名卷 `classroom-data` 中，容器重启或拉取新镜像不会丢失数据。不要在更新时勾选删除数据卷。

更新源码并推送到 `main` 后，GitHub Actions 会构建并推送 `latest`。在 1Panel 中重新拉取镜像并重建编排即可更新。

命令行操作与 1Panel 等价：

```bash
curl -fsSL https://raw.githubusercontent.com/Alumos/chinacore-classroom/main/compose.1panel.yaml -o compose.yaml
docker compose up -d
docker compose ps
```

若 18080 已占用，只需把 Compose 中 `"18080:18080"` 的左侧修改成空闲高位端口，如 `"28080:18080"`。容器内部仍使用 18080。

## 域名和反向代理

可在 1Panel 网站中反向代理到此服务并启用 HTTPS。SSE 需要关闭代理缓冲、缓存并设置较长读取超时；Nginx 示例：

```nginx
location / {
    proxy_pass http://127.0.0.1:18080;
    proxy_http_version 1.1;
    proxy_set_header Host $http_host;
    proxy_set_header Connection "";
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 3600s;
}
```

上面的 `127.0.0.1` 适用于宿主机 Nginx。1Panel 的 OpenResty 若在容器中，应按其网络模式使用能访问宿主机的地址或共享网络中的 `classroom:18080`。

教师后台按需求不设鉴权，访问站点的人也能进行教师操作；需要限制教师入口时，由反向代理或教学网络配置访问控制。

## 镜像访问

公开的 GHCR 镜像可直接拉取，无需登录。若 GitHub 首次发布后将包默认设为私有，仓库所有者需在 GitHub Packages 的包设置中将它改为 Public，或者在 1Panel 配置 GHCR 的登录凭据。
