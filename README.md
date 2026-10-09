# ChinaCore Classroom · 中国芯，强国梦

自主可控主题课堂实时弹幕平台：学生选词或输入、实时班级大屏、教师管理，以及光点飞升汇聚成“中国芯·强国梦”的鎏金收束动画。

- 学生无需班级码，扫码或打开链接即可参与。
- 教师后台无需登录或口令，可审核、增删改查、暂停、导出、清空全部弹幕与统计。
- React 前端嵌入 Go 程序，一份镜像提供全部页面，无需外部数据库。
- 数据使用 bbolt 持久化，SSE 自动重连，支持 60 个并发投稿的测试验证。

## 成品部署（1Panel / Linux x86_64）

镜像：**ghcr.io/alumos/chinacore-classroom:latest**

在 1Panel「容器 → 编排」中新建编排，粘贴 [compose.1panel.yaml](compose.1panel.yaml) 即可拉取并运行成品镜像。详细步骤见 [DEPLOY-1PANEL.md](DEPLOY-1PANEL.md)。

命令行部署：

```bash
curl -fsSL https://raw.githubusercontent.com/Alumos/chinacore-classroom/main/compose.1panel.yaml -o compose.yaml
docker compose up -d
```

如果已克隆本仓库，执行 `docker compose up -d` 即可。默认端口 **18080**，支持通过 `.env` 的 `HOST_PORT` 修改仓库根目录 `compose.yaml` 的宿主机端口。

| 页面 | 地址 |
| --- | --- |
| 班级大屏 | `http://服务器IP:18080/screen` |
| 学生入口 | `http://服务器IP:18080/join` |
| 教师工作台 | `http://服务器IP:18080/teacher` |
| 健康检查 | `http://服务器IP:18080/api/health` |

学生入口 `/join` 支持在线学习单 iframe 嵌入，默认仅允许同源学习单。学习单若部署在其他端口或域名，可通过环境变量 `STUDENT_FRAME_ORIGINS` 配置允许的 HTTP(S) 来源（多个地址用空格分隔，不含路径）。教师后台和班级大屏仍禁止嵌入。详见 [学习单嵌入配置](DEPLOY-1PANEL.md#在线学习单嵌入)。

数据库位于命名卷 `classroom-data` 的 `/data/classroom.db`，重启和重建容器后保留。不要使用 `docker compose down -v` 做日常更新。

## GitHub Actions

推送 `main` / `master`、版本标签 `v*` 或手动触发 workflow 后，Actions 构建 Linux amd64 镜像并发布到 GHCR。构建期间检查前端 TypeScript、Go 测试和静态检查；发布后实际启动非 root、只读根文件系统的容器，验证网页、学生投稿、重启数据保留和清空弹幕。PR 只构建验证，不发布。

镜像标签为 `latest`、`sha-提交短哈希`，版本标签还会生成对应版本号。

## 从源码构建

```bash
git clone https://github.com/Alumos/chinacore-classroom.git
cd chinacore-classroom
docker compose -f compose.build.yaml up -d --build
```

`Dockerfile` 使用 Node 24 构建前端，Go 1.27 构建服务，最终 scratch 镜像仅包含静态 Go 程序和嵌入的网页。`compose.build.yaml` 用于服务器上从源码构建；`compose.yaml` 和 `compose.1panel.yaml` 用于直接运行成品。

## 本地开发

环境：Node.js 22.12+（或 20.19+），Go 1.24+。

```bash
npm ci
npm run build
go mod download
go run .
```

在另一终端执行 `npm run dev` 使用前端热更新。Go 默认端口 18080，Vite 将 `/api` 代理到该服务。

```bash
npm run build
go test -v ./...
go vet ./...
```

Windows 便携版可通过 `scripts/build.ps1` 构建。`scripts/package-image.py` 可将交叉编译的静态 Linux 程序打包为 `docker load` 兼容的镜像归档。依赖、数据库和构建产物不提交 Git。

## 课堂操作

大屏提供二维码、真实参与统计、领域热度、全屏投影。演示弹幕与收束预览只影响当前屏幕，不写入课堂记录。

教师清空时会删除已上屏和待审核记录，重置统计并同步所有连接的设备，保留课堂名称与审核设置。投稿标识和限流同时清理，原设备可立即重新投稿，弹幕 ID 不复用。

鎏金收束约 14 秒，自动暂停投稿，各大屏使用同一开始时间。点击「返回课堂互动」恢复投稿。

参与人数按已上屏投稿的浏览器设备标识去重，领域票数按弹幕条数统计。每课堂最多 10,000 条记录、1,000 个实时连接，公开快照保留最近 240 条已审核弹幕。

教师后台按需求不设鉴权，访问站点的人也能管理课堂；如需限制教师入口，由反向代理或教学网络控制。
