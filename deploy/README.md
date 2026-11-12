# LecPunch production deployment

This first-pass deployment is designed for a Tencent Cloud Ubuntu server without a domain.
It uses:

- Docker Compose
- a MongoDB container with a persistent volume
- the API container on the internal Docker network only
- the web container serving the Vite build through nginx and proxying `/api` to the API

The Docker build defaults to `https://registry.npmjs.org/`.
If your server cannot access that reliably, you can override it per build with:

```bash
export NPM_REGISTRY=https://registry.npmmirror.com
```

## 1. Limitations

- Access is over `http://<server-public-ip>/`, not HTTPS.
- This is acceptable for a short internal test, not for a long-term public deployment.
- Network allowlists must use the client network's public egress IP or CIDR, not a LAN address like `192.168.x.x`.

## 2. Prepare the server

Clone the repository on the server and enter the project directory:

```bash
git clone <your-repo-url>
cd LecPunch
```

Copy the env templates:

```bash
cp deploy/api.env.example deploy/api.env
cp deploy/mongo.env.example deploy/mongo.env
```

Edit both files before the first boot.

## 3. Network gateway and LAN-only check-in

The public site can remain accessible at `http://<server-public-ip>/`, while
the API independently decides whether a user is allowed to **check in**. This
is deliberately not an nginx IP block: administrators must still be able to
log in and repair a network rule if an office network changes.

Use these settings before the first production boot:

- keep `ALLOW_OPEN_REGISTRATION=true` only if you want regular users to self-register
- set `AUTH_SECRET` to a long random secret
- keep `TRUST_PROXY=true`
- leave `ALLOW_ANY_NETWORK=false` (the template default), then replace its placeholder `127.0.0.1` allowlist entry with your actual campus/router/VPN egress IP before inviting members

After logging in as an admin, open:

- `http://<server-public-ip>/admin/network-policy`

The page shows the IP recognized by the server. Add that value under “允许的公网 IP”, or add a real LAN/VPN CIDR only when the server can directly see those private addresses. For a public Tencent Cloud server, every client normally appears as the router/campus **public egress IP**, so `192.168.x.x` is not sufficient.

Save the policy with “允许任意网络” disabled. It is stored in MongoDB and overrides the environment fallback immediately. The nginx gateway overwrites any browser-supplied forwarding header with its real client address and preserves the notification SSE stream; do not expose the API or MongoDB ports directly.

## 4. Build and start

Run:

```bash
docker compose -f docker-compose.prod.yml up -d --build
```

If you previously had a broken local npm source configured on the server, this compose file still forces the registry passed by `NPM_REGISTRY`, so you do not need to modify global npm config first.

Check logs if needed:

```bash
docker compose -f docker-compose.prod.yml logs -f web
docker compose -f docker-compose.prod.yml logs -f api
```

## 5. Bootstrap the first admin

Open an interactive shell on the server and run the bootstrap command once.
The username is normalized to lowercase, so `LecPunch` becomes `lecpunch`.

```bash
docker compose -f docker-compose.prod.yml exec \
  -e BOOTSTRAP_ADMIN_USERNAME=LecPunch \
  -e BOOTSTRAP_ADMIN_PASSWORD=replace-with-a-strong-password \
  -e BOOTSTRAP_ADMIN_DISPLAY_NAME=admin \
  api node dist/scripts/bootstrap-admin.js
```

Optional values:

- `BOOTSTRAP_ADMIN_REAL_NAME`
- `BOOTSTRAP_ADMIN_STUDENT_ID`
- `BOOTSTRAP_ADMIN_ENROLL_YEAR`
- `BOOTSTRAP_ADMIN_RESET_PASSWORD=true` when promoting an existing user and you also want to reset the password

## 6. Access the app

Open:

```txt
http://<server-public-ip>/
```

Then log in with the bootstrapped admin account and finish the network policy setup. Administrators land on `/admin`, which is a dedicated control page for account migration, gateway policy, eligibility, activities, ledger, and exports.

## 7. Restore the server backup safely

The backup archive is sensitive: it includes account password hashes, real-name/student data, source IPs, attendance records, and the admin role. Do not add it to Git or copy it into the repository.

On the server, copy the archive to a protected path, stop the API while keeping Mongo running, then run the restore helper. The helper creates a rollback archive in `./backups/` before it replaces only `lecpunch.*` collections.

```bash
docker compose -f docker-compose.prod.yml stop api
bash deploy/restore-mongo-archive.sh /protected/lecpunch-mongo-20260831.archive.gz --apply
docker compose -f docker-compose.prod.yml run --rm api node dist/scripts/reconcile-active-attendance-sessions.js --apply
docker compose -f docker-compose.prod.yml up -d api web
```

The reconciliation command keeps the newest active session for each user, invalidates only older duplicate active sessions, and creates the database unique index that prevents concurrent browser tabs from creating two active check-ins. Run it without `--apply` first if you want a read-only duplicate report.

Because the archived `users` collection already contains role and password-hash data, existing administrators migrate with the snapshot. Use the bootstrap command only if you need to promote or recover a separate admin account.

## 8. 团队服务器自动部署

BoxPro 使用 [Devtron 发布平台](https://10.37.218.3:35480/dashboard/)，通过 LecSSO 登录。`lec-platform` 项目中的 `lecpunch-web-pilot` 和 `lecpunch-api-pilot` 分别管理 Web、API；名称保留了接入阶段的标识，已经承接原访问入口。

只监听 `lec-org/LecPunch` 的 `main`：Web 目录变动只构建、发布 Web，API 目录变动只构建、发布 API；共享契约、根依赖和公共构建配置影响两者。Desktop 不触发自动部署。GitHub Actions 的 `ci.yml` 继续检查 PR，`desktop-release.yml` 仅提供手动桌面打包，不参与服务器发布。

镜像必须经过本次提交的类型检查、测试和构建，推送 GHCR 成功后才能进入原生 Helm 发布。服务端校验提交属于配置分支，并阻止已经被同一应用新改动取代的旧构建自动上线。Web/API 独立判断，不因另一应用的新提交互相阻塞。检查失败不产出部署制品；不健康的新 Pod 不接流量，历史版本可在发布历史中回滚。

公网校园服务本次没有切换。BoxPro 保留原地址 `https://10.37.218.3:35183`、SSO issuer、MongoDB、报表目录和签到网络规则，`ALLOW_ANY_NETWORK=false`。原 Compose API 容器停用，数据卷与恢复备份保留。发布配置、迁移及验证记录统一在平台仓库 `deploy/devtron/` 维护，不再使用独立 SSH 发布器。
