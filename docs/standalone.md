# ByeByeBoard

独立运行的键盘白板应用。

## 本地运行

需要 Node.js 22.12 或更高版本以及 npm。

```sh
npm install
npm run dev
```

打开 http://localhost:3001 。构建与检查：

```sh
npm run lint
npm test
npm run build
npm run preview
```

构建产物为 dist/，可以部署到静态站点托管服务。无需后端、账号、API key 或 Mermaid。

## GEO 与站点地址

`public/guide.html` 和 `public/zh/guide.html` 是可直接抓取的英文、中文使用指南；白板仍在网站根路径，打开即可书写。`public/robots.txt`、`public/sitemap.xml` 和 `public/llms.txt` 使用正式域名 `https://byebyeboard.com`。上线时应确保根路径、指南和这三个文件都返回实际内容，且未知路径返回 404，而不是一律回退到白板首页。上线后再在搜索站长工具提交 sitemap 并检查抓取结果。

## Fly.io 部署

本站是纯静态应用。`Dockerfile` 在 Node 22 中构建，再由 Nginx 提供 `dist/`；`nginx.conf` 对未知路径返回 404，并提供 `/healthz`。Fly.io 使用 `sin` 区域的 256 MB 共享 CPU Machine，空闲时可自动停止，请求到来时自动启动。

首次部署：

```sh
fly apps create byebyeboard
fly deploy --app byebyeboard
fly certs add byebyeboard.com --app byebyeboard
fly certs add www.byebyeboard.com --app byebyeboard
fly ips list --app byebyeboard
```

根据 `fly certs setup` 的实际输出在域名 DNS 管理处设置根域名与 `www` 的 A/AAAA 记录。不要照搬其他 Fly 应用的 IP。之后用 `fly certs check` 确认两张证书已签发，并访问根路径、两篇指南、`robots.txt`、`sitemap.xml`、`llms.txt` 与 `/healthz`；不存在的路径应返回 404。以后在仓库根目录运行 `fly deploy --app byebyeboard` 更新。回滚时可用 Fly.io 的上一版镜像重新部署，并重新检查这些路径。

## 功能

直接输入创建便签，Enter 写同级，Tab 写子级，Shift+Enter 换行，Esc 完成。支持连线、拖动、缩放、撤销重做、颜色、字号、加粗、黑白主题、PNG / JSON 导出和中英文帮助。完整快捷键见页面帮助面板。默认使用本机字体，无外部字体服务依赖。

## 数据边界

便签、连线、加粗和主题保存在当前站点 localStorage；语言单独保存。存储键为 byebyeboard.board、byebyeboard.theme、byebyeboard.language。相机与撤销历史不持久化。浏览器存储被清理或不可用时，不保证恢复。

localStorage 按 origin（协议、域名、端口）隔离，新域名或新端口无法自动读取原站点数据。本次只复制代码，不复制浏览器内容；即使同域部署，也不会读取原应用 sm_board 键。原页面可以导出 JSON 备份，但当前白板没有 JSON 导入入口，因此导出文件不代表已经完成数据迁移；需要后续增加经过校验的导入功能，或由用户明确授权后进行一次性迁移。
