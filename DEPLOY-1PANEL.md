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

## 在线学习单嵌入

学习单的 iframe 应使用学生入口 `http://118.89.94.132:18080/join`，不要使用默认首页（班级大屏）。新版默认允许同源学习单嵌入 `/join`；同源指协议、主机、端口均一致。

如果学习单与中国芯同源，原 Compose 无需修改，更新镜像并重建容器即可。如果学习单使用其他端口或域名，在 1Panel 的 Compose `environment` 下增加 `STUDENT_FRAME_ORIGINS`。本项目的 `compose.1panel.yaml` 已预填计划使用的学习单域名 `https://learn.alumos.cn`：

```yaml
    environment:
      PORT: "18080"
      DATA_FILE: /data/classroom.db
      STUDENT_FRAME_ORIGINS: "https://learn.alumos.cn"
```

这里填写的是**学习单**的来源地址，不是中国芯的地址；不要加路径。多个来源用空格分隔。如果实际使用其他来源，应替换该值。地址格式错误时，程序会在启动日志中说明并退出，修正配置后重建即可。

学习单示例：

```html
<iframe
  src="https://chinacore.alumos.cn/join"
  title="中国芯：表达我的想法"
  style="width:100%;height:80vh;border:0"
></iframe>
```

`/join` 使用 CSP `frame-ancestors` 限定允许的来源；跨源配置时不发送冲突的 `X-Frame-Options`。教师后台和班级大屏继续禁止嵌入。嵌入不需要开启 CORS，学生页内部调用的投稿和实时接口仍是中国芯自身的同源接口。学习单若使用 HTTPS，中国芯也应通过 HTTPS 地址嵌入。

如果反向代理另行添加了 `X-Frame-Options: DENY` 或更严格的 `frame-ancestors`，也需要调整代理的对应 `/join` 规则。浏览器最终使用的是代理返回的响应头。

建议使用以下 HTTPS 域名部署（DNS 解析和证书需要在服务器上配置）：

| 域名 | 用途 | 反向代理目标 |
| --- | --- | --- |
| `learn.alumos.cn` | 学习单与北斗静态网页 | 学习单静态站点目录 |
| `chinacore.alumos.cn` | 中国芯互动 | `http://127.0.0.1:18080` |
| `fxh.alumos.cn` | 高小铁 AI 助手 | `http://127.0.0.1:18081` |

域名、证书和 CDN 由部署者配置。中国芯和高小铁的 `/api/` 路径应绕过 CDN 缓存；实时 SSE 连接需要关闭缓冲并支持长连接。HTML 和运行时配置也不应长期缓存，避免更新后仍加载旧版入口。

学习单底部展示以下备案链接；中国芯的大屏、学生入口和教师工作台也统一展示相同备案号：

```html
<footer>
  <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">
    苏ICP备2021038338号-1
  </a>
</footer>
```

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
