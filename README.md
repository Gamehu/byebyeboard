# ByeByeBoard

用键盘整理想法的在线白板。打开画布就能写：输入创建便签，用 Enter 和 Tab 展开层次，再移动或连接相关的想法。适合教学、会议讨论和个人梳理。

线上访问：[产品介绍](https://byebyeboard.com/) · [打开白板](https://byebyeboard.com/board/) · [中文指南](https://byebyeboard.com/zh/guide.html) · [English guide](https://byebyeboard.com/guide.html)

## 本地运行

需要 Node.js 22.12+ 和 npm。

```sh
npm ci
npm run dev
```

打开 `http://localhost:3001/` 看介绍首页，点击「进入白板」或直接打开 `http://localhost:3001/board/`。中文首页在 `/zh/`。

```sh
npm run lint   # TypeScript 类型检查
npm test       # 白板逻辑测试
npm run build  # 构建到 dist/
npm run preview
```

## 怎么用

| 操作 | 快捷键 |
| --- | --- |
| 创建或继续便签 | 直接输入 |
| 写下一条同级便签 | Enter |
| 写一条相连的子级便签 | Tab |
| 返回上一级 | Shift + Tab |
| 在便签内换行 | Shift + Enter |
| 完成编辑 | Esc |
| 查看完整快捷键 | F1 或 Ctrl/⌘ + / |

也可以用鼠标选择和拖动便签、平移或缩放画布。支持连线、颜色、字号、加粗、黑板与白板主题，以及 PNG 和 JSON 导出。完整说明见[中文指南](https://byebyeboard.com/zh/guide.html)。

## 数据与边界

便签、连线、样式和主题保存在**当前浏览器的 localStorage**。没有账号、云同步或实时协作；换浏览器、清理站点数据或切换域名，不会自动带走白板。PNG 用于分享图片。JSON 是导出的记录，当前版本**没有 JSON 导入或恢复功能**，请勿把单独一份 JSON 导出视为已验证的备份方案。

## 页面与技术

| 路径 | 内容 |
| --- | --- |
| `/`、`/zh/` | 可直接抓取的英文、中文产品介绍 |
| `/board/` | React 白板应用 |
| `/guide.html`、`/zh/guide.html` | 可直接抓取的使用指南 |
| `/robots.txt`、`/sitemap.xml`、`/llms.txt` | 搜索与 AI 检索入口 |

前端使用 React、TypeScript 和 Vite；部署时由 Nginx 提供静态文件，Fly.io 托管。项目没有后端或 API key。首页与指南无需 JavaScript 即可阅读；未知路径返回 404。部署命令和域名设置见 [docs/standalone.md](docs/standalone.md)。
