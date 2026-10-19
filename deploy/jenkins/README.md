# KubeSphere DevOps 发布

## 流程与边界

流水线位于企业空间 `lec-platform`、DevOps 项目 `lec-platform-lecpunch`，名称为 `lecpunch`。它读取本仓库的 `Jenkinsfile`，只发现 `main`，约每两分钟检查一次变化；GitHub 不需要接收入站 Webhook。

流程为：检出同一提交 → 读取上次成功发布基线并判断范围 → 构建、类型检查、测试 → 只构建并推送受影响服务的镜像 → 归档 `release.json` → 生产发布与健康检查。

- 构建在 VM104 的临时 Pod 中串行执行，镜像缓存使用独立 40Gi PVC。
- 选中服务的镜像带有提交 SHA 标签，部署使用固定 `sha256` 摘要。未选中的服务不构建、不重启。
- 生产应用和 Mongo 继续运行于 PVE CT103，编排目录为 `/opt/1panel/docker/compose/lecpunch-production`。
- 发布执行器再次核验 Jenkins 阶段、归档产物、最新 `main` 和镜像的提交标签。必需阶段失败、取消、跳过，或提交过期、摘要不一致均停止发布。未选中的镜像构建可正常跳过。
- 发布前备份 Mongo，更新范围限制为 API/Web 的镜像，不改动 Mongo、端口、卷和环境变量。

当前接入的是 `main` 发布流水线，其他分支和 PR 不触发这条生产流水线。

## 发布范围

| 变更 | 自动发布 |
| --- | --- |
| `apps/web/**`、`deploy/nginx.conf`、`packages/ui/**` | Web |
| `apps/api/**`、`nest-cli.json` | API |
| `packages/shared/**`、`packages/tsconfig/**`、`packages/eslint-config/**` | Web + API |
| 根 `package.json`、`pnpm-lock.yaml`、`pnpm-workspace.yaml`、`turbo.json`、`.npmrc`、`.dockerignore` | Web + API |
| 仅 `apps/election/**`、文档、流水线定义和部署工具 | 不发布 |

根依赖锁文件属于公共构建输入，变更时会重建两个服务，包括桌面依赖更新同时修改根锁文件的情况。桌面应用自身的版本、代码、资源变更不触发服务发布；桌面安装包只允许手动运行 `Desktop release (manual)`。

旧 `electron-release.yml` 在 GitHub 保持停用，避免给历史提交补 Tag 时触发旧版本的自动发包定义；新 `desktop-release.yml` 仅接受手动触发。

范围从服务器保存的上次成功发布 SHA 到本次 SHA 计算，覆盖多提交合并、删除和跨应用移动。上次失败留下的改动也会继续进入下一次发布。无服务变更时仍执行检查并归档空镜像清单，跳过构建与部署。生产端独立通过 GitHub compare 再次核对范围，文件数达到其 [300 项上限](https://docs.github.com/en/rest/commits/commits#compare-two-commits) 时停止，要求管理员检查。

## 配置文件

在 VM104 执行：

```sh
sudo k3s kubectl apply -f build-resources.yaml
sudo k3s kubectl apply -f pipeline.yaml
```

DevOps 项目、扩展配置以及 1.2.4 的控制器参数修复在平台仓库的 `deploy/kubesphere/devops/`。`pipeline.yaml` 的 `timer_trigger.interval` 单位是毫秒。

构建镜像与 Jenkins Agent 均固定摘要。Podman 构建容器需要特权模式，因此此流水线仅从受信的本仓库 `main` 读取定义。Agent 不挂载 Kubernetes ServiceAccount Token，不挂载宿主机 Docker socket。

## 凭证与生产校验

DevOps 项目中配置以下凭证：

| ID | 用途 |
| --- | --- |
| `lecpunch-ghcr` | 用户名为 GitHub 登录名，密码为仅含 `write:packages` 的 classic PAT。对应账号需有 `lec-org` 镜像包写权限。 |
| `lecpunch-production` | 专用 SSH 私钥，仅可在 PVE 调用 LecPunch 的 `check`、只读 `status` 和 `deploy`，不能打开 Shell。 |

凭证由 KubeSphere Secret 同步至项目的 Jenkins 凭证存储。后续在 KubeSphere 的 DevOps 凭证页面更新，避免两边数据不一致。Token 有效期以 GitHub 设置为准。

`kubesphere-devops-worker/lecpunch-deploy-trust` ConfigMap 保存 PVE 的已核验 SSH 主机公钥。PVE root 的有效授权文件由 `/etc/ssh/sshd_config.d/00-lec-recovery.conf` 指向 `/root/.ssh/lec-recovery-authorized_keys`，专用密钥使用以下限制：

```text
restrict,command="/usr/local/sbin/lec-deploy-punch-gateway pve"
```

CT103 的 `/var/lib/lecpunch-deploy/jenkins.json` 仅 root 可读，固定 Jenkins 任务地址及只读校验凭证。生产校验身份为 `lecpunch-release-reader`，只授予该项目的读取权限；实测可读取构建记录，读取任务配置返回 403。

Jenkins 审计入口为 VM104 内网 `31480`，未配置公网 FRP 转发。操作员访问控制台继续走 SSH 隧道。

## 故障与回退

失败构建不会执行后续发布阶段。部署过程失败时，查看 CT103 的 `/var/lib/lecpunch-deploy/releases/`，其中保存发布日志、Mongo 备份和 `previous-images.json`。恢复旧镜像不会自动恢复数据库。

恢复旧流水线前，先停用 KubeSphere 的生产流水线，避免两个发布入口并行。迁移前 GitHub Actions 定义位于提交 `c3aa48da69f759f43af7275e1f3cca90d1ac35af`，CT103 的原始执行器备份为 `/var/lib/lecpunch-deploy/automation-before-jenkins.py`。恢复这些旧版本会恢复双服务发布规则，需管理员核实后操作。
