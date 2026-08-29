# LecPunch Election

LecPunch 的 Electron 桌面端。它使用已有的 API 登录、打卡和积分接口；日报和周报保持在 GitHub 博客及统一报告仓库中，客户端只读取可公开访问的报告清单，不保存文章正文。

## 启动

```bash
pnpm --filter @lecpunch/election dev
```

首次安装 Electron 时，包管理器会下载与当前系统匹配的 Electron 运行时。生产构建使用：

```bash
pnpm --filter @lecpunch/election build
```

生成 Windows 64 位安装程序：

```bash
pnpm --filter @lecpunch/election package:win
```

默认安装文件生成在 `Downloads/LecPunch-Election-Installer/`，可安装到自选目录，并创建桌面和开始菜单快捷方式。可通过 `LECPUNCH_ELECTION_OUTPUT_DIR` 指定其它输出目录。

复制 `.env.example` 为 `.env.local` 后，可配置：

- `VITE_API_BASE_URL`：LecPunch API 根地址，默认为 `http://43.138.244.158/api`。
- `VITE_REPORTS_MANIFEST_URL`：中央报告仓库中 `overview/current.json` 的公开地址。未配置时，报告页会显示接入提示而不会请求服务端。

## 统一报告清单

本地抓取与 AI 总结工具应把最新周报发布为类似下面的 JSON。桌面端可直接拉取该文件；学生博客正文仍只保存于其各自的 GitHub 仓库。

```json
{
  "weekKey": "2026-W35",
  "generatedAt": "2026-08-29T09:00:00.000Z",
  "members": [
    {
      "studentId": "student-001",
      "displayName": "张三",
      "status": "generated",
      "dailyCount": 5,
      "summary": "本周完成了……",
      "url": "https://github.com/your-org/weekly-reports/blob/main/reports/2026-W35/student-001.md"
    }
  ]
}
```

`status` 支持 `generated`、`missing` 和 `pending`。为避免浏览器跨域限制，推荐使用 GitHub Pages、公开对象存储或带 CORS 响应头的静态托管地址。
