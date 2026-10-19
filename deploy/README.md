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

`main` 的检查、镜像构建和生产发布由 KubeSphere DevOps 的 `lecpunch/main` 负责，配置见 [Jenkins 发布说明](jenkins/README.md)。GitHub Actions 的 `ci.yml` 仅检查 PR，不再自动部署；桌面端 `desktop-release.yml` 仅允许手动选择版本标签创建草稿 Release。

发布范围按上次成功发布的提交到当前 `main` 的完整差异决定：Web 改动只发 Web，API 改动只发 API，`apps/election` 改动不发布。共享契约、根依赖锁文件和公共构建配置影响两个服务，均需重新构建。所有必需检查及选中镜像构建成功后，才允许按摘要发布同一提交。失败或被较新提交取代的构建不会导致改动遗漏，下次仍从上次成功发布的基线判断。

- 内部 PVE：`gateway.py` 安装为 `/usr/local/sbin/lec-deploy-punch-gateway`，专用公钥绑定 `restrict,command="/usr/local/sbin/lec-deploy-punch-gateway pve"`，只允许 `check`、`status` 和 `deploy`。
- CT103：`production.py` 安装为 `/usr/local/sbin/lec-deploy-punch`，`lecpunch_changes.py` 安装到同一目录，由 root 管理。它复用已安装的 `/usr/local/sbin/lec-deploy-production`；`--install` 只用于首次接入现有 1Panel 编排，禁止重复运行。
- 发布器再次核验 Jenkins 必需阶段、归档镜像、最新 `main`、变更范围和镜像提交标签，只更新选中服务。另一服务的镜像和容器身份必须保留。

实际编排位于 `/opt/1panel/docker/compose/lecpunch-production`，生产 `.env`、公网端口、数据卷、资源限制留在服务器。发布前备份 Mongo，发布后检查健康、端口、挂载与未选中容器身份。状态、日志和备份位于 CT103 的 `/var/lib/lecpunch-deploy`。失败时停止，不自动恢复数据库；根权限执行器需管理员审查后手动更新。

本地验证：`python3 -m unittest discover -s deploy/automation -p 'test_*.py' -v`。日常发布结果在 KubeSphere DevOps 的 `lecpunch/main` 中查看。
