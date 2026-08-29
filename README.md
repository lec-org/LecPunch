# LecPunch

LecPunch 是一个团队打卡系统 monorepo。当前仓库已经收口到 V1.1 基线，包含成员端打卡闭环、同团队数据查看，以及最小可用的后台管理能力。

## V1.1 范围

当前已纳入范围的能力：

- 用户名 / 密码登录，以及可开关的开放注册
- 以后端为真值的上卡 / 下卡业务规则
- 当前打卡状态、我的记录、成员记录、个人周历史
- 团队本周统计与同团队访问控制
- 个人资料编辑与密码修改
- 后台成员管理
- 后台网络策略管理
- 后台团队记录 CSV 导出
- 有效打卡每满 1 分钟自动获得 1 积分（服务端确认并保存）

当前明确不在 V1.1 范围内：

- 多团队产品化流程
- 请假 / 补卡流程
- Excel 导出
- 推送提醒
- 离线同步
- 当前工作区脚本之外的完整部署自动化

## 积分规则与存储

- 仅服务端已确认的有效打卡时长参与积分；未满一分钟不计分。
- 每次打卡按 `floor(有效秒数 / 60)` 结算积分；心跳暂停期间不累计。
- 超过 5 小时而作废的打卡记录积分会自动归零。
- MongoDB 使用 `point_ledger_entries` 保存积分明细，每个打卡 session 只有一条明细记录并设有唯一索引，避免重复请求重复加分。
- 已登录用户可通过 `GET /points/me` 查询当前总积分，响应形如 `{ "totalPoints": 42 }`。

## 技术栈

- `pnpm` workspace + Turbo
- `apps/api`: NestJS + MongoDB
- `apps/web`: React + Vite + Zustand + Axios + Tailwind
- `packages/shared`: 前后端共享领域契约与常量
- `packages/ui`: 共享展示组件

## 环境要求

- Node.js 20+
- pnpm 8+
- 本地 MongoDB，默认连接串为 `mongodb://localhost:27017/lecpunch`

## 安装依赖

```powershell
pnpm install
```

如果 `packages/shared/dist` 缺失，且 API 启动时报 `@lecpunch/shared` 无法解析，可先执行一次：

```powershell
pnpm --filter @lecpunch/shared build
```

## 环境配置

### API

复制示例文件：

```powershell
Copy-Item apps/api/.env.example apps/api/.env
```

关键变量说明：

- `MONGODB_URI`：MongoDB 连接串
- `AUTH_SECRET`：JWT 密钥，至少 16 位
- `DEFAULT_TEAM_NAME`：注册和 seed 流程使用的默认团队名
- `ALLOW_OPEN_REGISTRATION`：是否允许 `/auth/register`
- `ALLOW_ANY_NETWORK`：设为 `false` 后才真正启用打卡网络白名单
- `ALLOWED_PUBLIC_IPS`：逗号分隔的精确客户端 IP 白名单
- `ALLOWED_CIDRS`：逗号分隔的 CIDR 白名单
- `TRUST_PROXY`：是否信任 `X-Forwarded-For`
- `TRUSTED_PROXY_HOPS`：`TRUST_PROXY=true` 时按代理链右侧计算的可信跳数

本地演示建议保持：

```env
ALLOW_OPEN_REGISTRATION=true
ALLOW_ANY_NETWORK=true
```

重要约束：当 `ALLOW_ANY_NETWORK=false` 时，`ALLOWED_PUBLIC_IPS` 或 `ALLOWED_CIDRS` 至少要配置一个。

### Web

复制示例文件：

```powershell
Copy-Item apps/web/.env.example apps/web/.env
```

本地开发建议把 `VITE_API_BASE_URL` 留空，让 Vite 通过 `/api` 代理到 `http://localhost:4000`：

```env
VITE_API_BASE_URL=
```

只有在前端需要直连已部署 API 时，才填写完整地址。

## 种子数据

API 工作区已经提供可重复执行的演示数据脚本：

```powershell
pnpm --filter @lecpunch/api seed
```

它会确保默认团队存在，并在账号缺失时创建：

- `demo-admin` / `123456`
- `demo-member` / `123456`

可用 `demo-admin` 验证后台入口：

- `/admin/members`
- `/admin/network-policy`
- `/admin/records-export`

## 本地启动

启动 API：

```powershell
pnpm --filter @lecpunch/api dev
```

默认地址：`http://localhost:4000`

在另一个终端启动 Web：

```powershell
pnpm --filter @lecpunch/web dev
```

默认地址：`http://localhost:5173`

## 验证命令

全仓：

```powershell
pnpm typecheck
pnpm test
pnpm build
```

单独执行：

```powershell
pnpm --filter @lecpunch/api test
pnpm --filter @lecpunch/web test
```

定向示例：

```powershell
pnpm --filter @lecpunch/api exec vitest run src/modules/attendance/attendance.service.spec.ts
pnpm --filter @lecpunch/web exec vitest run src/pages/dashboard/DashboardPage.test.tsx
```

## 演示清单

从零开始做一轮本地演示时，按这个顺序：

1. `pnpm install`
2. 配置两份 `.env`
3. 启动 MongoDB
4. 执行 `pnpm --filter @lecpunch/api seed`
5. 启动 API 和 Web
6. 用 `demo-admin` 验证成员管理、网络策略和记录导出
7. 用 `demo-member` 验证成员端打卡主链路

## 参考文档

- 架构设计：`docs/superpowers/specs/2026-03-31-lecpunch-architecture-design.md`
- 当前执行计划：`docs/superpowers/plans/2026-04-09-v1.1-execution-plan.md`
- Agent 协作规则：`AGENTS.md`
