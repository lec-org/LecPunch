pipeline {
  agent {
    kubernetes {
      defaultContainer 'base'
      yaml '''
apiVersion: v1
kind: Pod
spec:
  automountServiceAccountToken: false
  containers:
    - name: jnlp
      image: hub.kubesphere.com.cn/jenkins/inbound-agent@sha256:577e8de85fcbaca5a894bba29d0ae65b56581930918ac16499fee7cddf836677
      volumeMounts:
        - {name: deploy-trust, mountPath: /etc/lec-deploy, readOnly: true}
      resources:
        requests: {cpu: 100m, memory: 256Mi}
        limits: {cpu: '1', memory: 512Mi}
    - name: base
      image: hub.kubesphere.com.cn/kubesphere/builder-base@sha256:87080b1afcce4d8fdc3f281b4c5eb99fdc0f4c200e4f9e849a8036ae590c845b
      command: [cat]
      tty: true
      # Podman 在独立构建虚拟机中运行；此流水线仅加载受信的 main。
      securityContext: {privileged: true}
      resources:
        requests: {cpu: '1', memory: 2Gi}
        limits: {cpu: '4', memory: 5Gi}
      volumeMounts:
        - {name: image-cache, mountPath: /var/lib/containers}
        - {name: registries, mountPath: /etc/containers/registries.conf.d/010-lec.conf, subPath: registries.conf, readOnly: true}
        - {name: deploy-trust, mountPath: /etc/lec-deploy, readOnly: true}
  volumes:
    - name: image-cache
      persistentVolumeClaim: {claimName: lecpunch-image-cache}
    - name: registries
      configMap: {name: lecpunch-build-registries}
    - name: deploy-trust
      configMap: {name: lecpunch-deploy-trust}
'''
    }
  }
  options {
    disableConcurrentBuilds()
    disableRestartFromStage()
    skipDefaultCheckout(true)
    timeout(time: 60, unit: 'MINUTES')
    buildDiscarder(logRotator(numToKeepStr: '20'))
  }
  environment {
    // Web/API 发布与现有检查不启动 Electron 运行时。
    ELECTRON_SKIP_BINARY_DOWNLOAD = '1'
    VITE_LOGTO_ENDPOINT = 'https://sso.lecspace.top'
    VITE_LOGTO_APP_ID = 'lecpunch-web'
    VITE_LOGTO_RESOURCE = 'https://api.lecpunch.lec.org'
    VITE_LOGTO_ORGANIZATION_ID = 'lec-studio'
    DEPLOY_HOST = '192.168.5.7'
    REGISTRY_AUTH_FILE = "${WORKSPACE_TMP}/registry-auth.json"
  }
  stages {
    stage('Checkout main') {
      steps {
        // Git 插件在 jnlp 容器中检出，后续 Git 命令在 base 容器中执行。
        container('jnlp') {
          sh 'git config --global http.https://github.com.proxy socks5h://10.42.0.1:11081'
        }
        sh 'git config --global http.https://github.com.proxy socks5h://10.42.0.1:11081'
        // 多分支任务固定检出加载此 Jenkinsfile 的同一个 main 提交。
        script {
          assert env.BRANCH_NAME == 'main'
          // 保留 SCM 的提交选择器，仅覆盖默认选项，避免拉取全部历史 Tag。
          checkout([$class: 'GitSCM', branches: scm.branches, userRemoteConfigs: scm.userRemoteConfigs,
            extensions: scm.extensions.findAll { !(it instanceof hudson.plugins.git.extensions.impl.CloneOption) } +
              [[$class: 'CloneOption', shallow: true, depth: 1, noTags: true, honorRefspec: true, timeout: 10]]])
        }
        // Git 检出由 jnlp 用户完成，构建容器只信任当前工作目录。
        sh 'git config --global --add safe.directory "$WORKSPACE"'
        script { env.RELEASE_SHA = sh(script: 'git rev-parse HEAD', returnStdout: true).trim() }
      }
    }
    stage('Select services') {
      steps {
        withCredentials([sshUserPrivateKey(credentialsId: 'lecpunch-production', keyFileVariable: 'DEPLOY_KEY')]) {
          // Agent 已包含 SSH，避免构建容器每次临时安装系统软件。
          container('jnlp') {
            sh 'ssh -i "$DEPLOY_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/lec-deploy/known_hosts root@"$DEPLOY_HOST" status > deployment-base.json'
          }
          sh '''
            set -eu
            base=$(python3 -c 'import json,re; s=json.load(open("deployment-base.json"))["sha"]; assert re.fullmatch("[a-f0-9]{40}",s); print(s)')
            git cat-file -e "$base^{commit}" 2>/dev/null || git fetch --depth=1 origin "$base"
            python3 deploy/automation/lecpunch_changes.py "$base" "$RELEASE_SHA" > changed-services.json
            cat changed-services.json
          '''
        }
        script {
          env.DEPLOY_API = sh(script: "python3 -c 'import json; print(str(\"api\" in json.load(open(\"changed-services.json\"))).lower())'", returnStdout: true).trim()
          env.DEPLOY_WEB = sh(script: "python3 -c 'import json; print(str(\"web\" in json.load(open(\"changed-services.json\"))).lower())'", returnStdout: true).trim()
        }
      }
    }
    stage('Verify') {
      steps {
        sh '''
          set -eu
          test "$(node -p 'process.versions.node.split(".")[0]')" = 22
          corepack prepare pnpm@8.15.4 --activate
          test "$(pnpm --version)" = 8.15.4
          pnpm install --store-dir /var/lib/containers/lecpunch-pnpm-store --frozen-lockfile --registry=https://registry.npmjs.org/
          pnpm build
          pnpm typecheck
          pnpm test
          python3 -m unittest discover -s deploy/automation -p 'test_*.py' -v
        '''
      }
    }
    stage('Build api image') {
      when { environment name: 'DEPLOY_API', value: 'true' }
      steps {
        withCredentials([usernamePassword(credentialsId: 'lecpunch-ghcr', usernameVariable: 'GHCR_USER', passwordVariable: 'GHCR_TOKEN')]) {
          sh '''
            set -eu
            set +x
            umask 077
            mkdir -p "$WORKSPACE_TMP"
            printf '%s' "$GHCR_TOKEN" | podman login ghcr.io --username "$GHCR_USER" --password-stdin
            podman build --format docker --label "org.opencontainers.image.revision=$RELEASE_SHA" \
              --label org.opencontainers.image.source=https://github.com/lec-org/LecPunch \
              -f apps/api/Dockerfile -t "ghcr.io/lec-org/lecpunch-api:sha-$RELEASE_SHA" .
            podman push --digestfile api.digest "ghcr.io/lec-org/lecpunch-api:sha-$RELEASE_SHA"
          '''
        }
      }
    }
    stage('Build web image') {
      when { environment name: 'DEPLOY_WEB', value: 'true' }
      steps {
        withCredentials([usernamePassword(credentialsId: 'lecpunch-ghcr', usernameVariable: 'GHCR_USER', passwordVariable: 'GHCR_TOKEN')]) {
          sh '''
            set -eu
            set +x
            umask 077
            printf '%s' "$GHCR_TOKEN" | podman login ghcr.io --username "$GHCR_USER" --password-stdin
            podman build --format docker --label "org.opencontainers.image.revision=$RELEASE_SHA" \
              --label org.opencontainers.image.source=https://github.com/lec-org/LecPunch \
              --build-arg "VITE_LOGTO_ENDPOINT=$VITE_LOGTO_ENDPOINT" \
              --build-arg "VITE_LOGTO_APP_ID=$VITE_LOGTO_APP_ID" \
              --build-arg "VITE_LOGTO_RESOURCE=$VITE_LOGTO_RESOURCE" \
              --build-arg "VITE_LOGTO_ORGANIZATION_ID=$VITE_LOGTO_ORGANIZATION_ID" \
              -f apps/web/Dockerfile -t "ghcr.io/lec-org/lecpunch-web:sha-$RELEASE_SHA" .
            podman push --digestfile web.digest "ghcr.io/lec-org/lecpunch-web:sha-$RELEASE_SHA"
          '''
        }
      }
    }
    stage('Archive release') {
      steps {
        sh '''
          set -eu
          python3 - <<'PY'
import json, os, pathlib, re
sha = os.environ['RELEASE_SHA']
assert re.fullmatch(r'[a-f0-9]{40}', sha)
images = {}
for service in json.loads(pathlib.Path('changed-services.json').read_text()):
    digest = pathlib.Path(service + '.digest').read_text().strip()
    assert re.fullmatch(r'sha256:[a-f0-9]{64}', digest)
    images[service] = f'ghcr.io/lec-org/lecpunch-{service}@{digest}'
pathlib.Path('release.json').write_text(json.dumps({'repository': 'lec-org/LecPunch', 'branch': 'main', 'sha': sha, 'images': images}))
PY
        '''
        archiveArtifacts(artifacts: 'release.json', fingerprint: true)
      }
    }
    stage('Deploy production') {
      when { anyOf { environment name: 'DEPLOY_API', value: 'true'; environment name: 'DEPLOY_WEB', value: 'true' } }
      steps {
        withCredentials([
          usernamePassword(credentialsId: 'lecpunch-ghcr', usernameVariable: 'GHCR_USER', passwordVariable: 'GHCR_TOKEN'),
          sshUserPrivateKey(credentialsId: 'lecpunch-production', keyFileVariable: 'DEPLOY_KEY')
        ]) {
          container('jnlp') {
            sh 'umask 077; : > "$WORKSPACE_TMP/deploy-request.json"'
          }
          sh '''
            set -eu
            test "$(git ls-remote origin refs/heads/main | cut -f1)" = "$RELEASE_SHA"
            set +x
            python3 - <<'PY' > "$WORKSPACE_TMP/deploy-request.json"
import json, os, pathlib
release = json.loads(pathlib.Path('release.json').read_text())
print(json.dumps({'ci': 'jenkins', 'sha': release['sha'], 'images': release['images'], 'run_id': int(os.environ['BUILD_NUMBER']), 'actor': os.environ['GHCR_USER'], 'token': os.environ['GHCR_TOKEN']}))
PY
          '''
          container('jnlp') {
            sh '''
              set -eu
              ssh -i "$DEPLOY_KEY" -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=/etc/lec-deploy/known_hosts -o ServerAliveInterval=30 root@"$DEPLOY_HOST" deploy < "$WORKSPACE_TMP/deploy-request.json"
              rm -f "$WORKSPACE_TMP/deploy-request.json"
            '''
          }
          sh '''
            curl --fail --silent --show-error --retry 3 --output "$WORKSPACE_TMP/public.html" https://47.108.49.103:49283/
            grep -q '<title>LecPunch</title>' "$WORKSPACE_TMP/public.html"
          '''
        }
      }
    }
  }
  post {
    always { sh 'rm -f "$REGISTRY_AUTH_FILE" "$WORKSPACE_TMP/deploy-request.json"' }
  }
}
