#!/usr/bin/env python3
"""复用已安装的平台发布工具，仅替换 LecPunch 的 Web/API 镜像。"""

import copy
import base64
import fcntl
from functools import cache
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from lecpunch_changes import affected_services

REPOSITORY = "lec-org/LecPunch"
DIRECTORY = Path("/opt/1panel/docker/compose/lecpunch-production")
STATE = Path("/var/lib/lecpunch-deploy")
PROJECT = {"name": "lecpunch-production"}
REQUIRED_JOBS = {"Verify", "Build api image", "Build web image"}
JENKINS_CONFIG = STATE / "jenkins.json"


@cache
def helpers():
    # 平台执行器由管理员安装；应用仓库不能通过流水线替换根权限工具。
    loader = importlib.machinery.SourceFileLoader("lec_deploy_shared", "/usr/local/sbin/lec-deploy-production")
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    module.REPOSITORY = REPOSITORY
    return module


def validate_request(value):
    fields = {"sha", "run_id", "images", "actor", "token"}
    if not isinstance(value, dict) or set(value) not in (fields, fields | {"ci"}):
        raise ValueError("发布请求字段不正确")
    if "ci" in value and value["ci"] != "jenkins":
        raise ValueError("CI 来源不正确")
    if not isinstance(value["sha"], str) or not re.fullmatch(r"[a-f0-9]{40}", value["sha"]):
        raise ValueError("提交 SHA 不正确")
    if type(value["run_id"]) is not int or value["run_id"] <= 0:
        raise ValueError("CI 运行编号不正确")
    if not isinstance(value["images"], dict) or not value["images"] or not set(value["images"]) <= {"api", "web"}:
        raise ValueError("只允许指定待发布的 Web/API 镜像")
    for service, image in value["images"].items():
        if not isinstance(image, str) or not re.fullmatch(
            rf"ghcr\.io/lec-org/lecpunch-{service}@sha256:[a-f0-9]{{64}}", image
        ):
            raise ValueError("镜像必须来自指定仓库并使用摘要")
    if not isinstance(value["actor"], str) or not re.fullmatch(r"[A-Za-z0-9\[\]-]{1,100}", value["actor"]):
        raise ValueError("镜像仓库用户名不正确")
    if not isinstance(value["token"], str) or not value["token"] or len(value["token"]) > 10000:
        raise ValueError("镜像仓库临时凭证不正确")
    return value


def jenkins_api(path):
    # 地址与只读凭证由服务器管理员固定，发布请求不能指定任意 CI 地址。
    config = json.loads(JENKINS_CONFIG.read_text())
    authorization = base64.b64encode(f"{config['user']}:{config['token']}".encode()).decode()
    request = urllib.request.Request(config["url"].rstrip("/") + path,
                                     headers={"Authorization": "Basic " + authorization})
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)


def check_jenkins(value):
    prefix = f"/{value['run_id']}"
    run = jenkins_api(prefix + "/api/json")
    if run.get("number") != value["run_id"] or run.get("result") not in (None, "SUCCESS"):
        raise ValueError("Jenkins 构建已失败或取消")
    stages = jenkins_api(prefix + "/wfapi/describe")
    completed = {stage["name"] for stage in stages.get("stages", []) if stage["status"] == "SUCCESS"}
    if not required_jobs(value) <= completed:
        raise ValueError("检查和待发布服务的镜像构建必须全部成功")
    release = jenkins_api(prefix + "/artifact/release.json")
    expected = {"repository": REPOSITORY, "branch": "main", "sha": value["sha"], "images": value["images"]}
    if release != expected:
        raise ValueError("发布请求与 Jenkins 归档的同一提交产物不一致")


def check_ci(value):
    api = helpers().api
    token = value["token"]
    if value.get("ci") == "jenkins":
        check_jenkins(value)
        if api("/commits/main", token)["sha"] != value["sha"]:
            raise ValueError("main 已有更新，跳过过期提交")
        return
    run = api(f"/actions/runs/{value['run_id']}", token)
    if (run["event"] != "push" or run["head_branch"] != "main" or run["head_sha"] != value["sha"]
            or run["head_repository"]["full_name"] != REPOSITORY
            or run["path"] != ".github/workflows/ci.yml"):
        raise ValueError("只允许 main push 对应的本仓库 CI 提交")
    jobs = api(f"/actions/runs/{value['run_id']}/jobs?per_page=100", token)
    completed = {job["name"] for job in jobs["jobs"] if job["conclusion"] == "success"}
    if not required_jobs(value) <= completed:
        raise ValueError("检查和待发布服务的镜像构建必须全部成功")
    if api("/commits/main", token)["sha"] != value["sha"]:
        raise ValueError("main 已有更新，跳过过期提交")


def runtime_model(model):
    # include 不继承锚点元数据，展开后的 services.logging 仍必须完全一致。
    return {key: value for key, value in model.items() if not key.startswith("x-")}


def required_jobs(value):
    return {"Verify"} | {f"Build {service} image" for service in value["images"]}


def check_changes(value, previous):
    base = previous.get("sha")
    if not base:
        raise ValueError("缺少上次成功发布的提交基线，需管理员先初始化")
    comparison = helpers().api(f"/compare/{base}...{value['sha']}", value["token"])
    if comparison["status"] not in ("ahead", "identical"):
        raise ValueError("拒绝倒退已发布版本")
    files = comparison.get("files", [])
    # GitHub compare 最多返回 300 个文件，不能用截断的文件列表决定发布范围。
    if len(files) >= 300:
        raise ValueError("变更文件过多，需人工核实发布范围")
    paths = [path for item in files for path in (item["filename"], item.get("previous_filename", ""))]
    if set(value["images"]) != set(affected_services(paths)):
        raise ValueError("待发布服务与上次成功发布以来的实际变更不一致，请重新构建")


def check_model(before, after, services=("api", "web")):
    # 只允许选中服务的镜像变化；其余服务、凭证、端口和卷沿用线上。
    normalized = copy.deepcopy(after)
    for service in services:
        normalized["services"][service]["image"] = before["services"][service]["image"]
    if runtime_model(before) != runtime_model(normalized):
        raise ValueError("镜像之外的生产配置发生变化，需先人工迁移")


def wrapper():
    return json.dumps({"name": PROJECT["name"], "include": [{
        "path": [str(DIRECTORY / "compose.base.yml"), str(STATE / "images.json")],
        "project_directory": str(DIRECTORY),
    }]}).encode()


def backup_database(destination):
    # 凭证仅在容器内展开，不进入宿主机命令和发布日志。
    command = ['docker', 'exec', PROJECT['name'] + '-mongo-1', 'sh', '-c',
               'exec mongodump --archive --gzip --username "$MONGO_INITDB_ROOT_USERNAME" '
               '--password "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin']
    with open(destination, "xb") as output:
        result = subprocess.run(command, stdout=output, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError("Mongo 备份失败，停止发布")
    if destination.stat().st_size == 0:
        raise RuntimeError("Mongo 备份为空，停止发布")


def verify_containers(before, services=("api", "web")):
    after = helpers().snapshot_containers(PROJECT)
    if before.keys() != after.keys():
        raise ValueError("运行中的服务集合发生变化")
    for service, old in before.items():
        if old["ports"] != after[service]["ports"] or old["mounts"] != after[service]["mounts"]:
            raise ValueError("实际端口或数据卷与发布前不一致")
        if service not in services and old["id"] != after[service]["id"]:
            raise ValueError(f"发布意外重建了未选中的服务：{service}")
    with urllib.request.urlopen("http://127.0.0.1:18082/", timeout=10) as response:
        if response.status != 200 or b"<title>LecPunch</title>" not in response.read(65536):
            raise ValueError("Web 健康检查失败")
    try:
        urllib.request.urlopen("http://127.0.0.1:18082/api/auth/me", timeout=10).close()
    except urllib.error.HTTPError as error:
        if error.code == 401:
            return
    raise ValueError("API 代理健康检查失败")


def install():
    shared = helpers()
    STATE.mkdir(mode=0o700, exist_ok=True)
    base_file = DIRECTORY / "compose.base.yml"
    if base_file.exists() or (STATE / "images.json").exists():
        raise ValueError("部署基线已存在，禁止重复安装")
    model = json.loads(shared.compose(PROJECT, "config", "--format", "json"))
    before = shared.snapshot_containers(PROJECT)
    original = (DIRECTORY / "docker-compose.yml").read_bytes()
    shared.atomic_write(base_file, original)
    shared.atomic_write(STATE / "images.json", json.dumps({"services": {
        service: {"image": model["services"][service]["image"]} for service in ("api", "web")
    }}).encode())
    shared.atomic_write(DIRECTORY / "docker-compose.yml", wrapper())
    try:
        assert runtime_model(model) == runtime_model(json.loads(shared.compose(PROJECT, "config", "--format", "json"))), "安装改变了编排模型"
        assert before == shared.snapshot_containers(PROJECT), "安装改变了运行容器"
    except Exception:
        shared.atomic_write(DIRECTORY / "docker-compose.yml", original)
        base_file.unlink()
        (STATE / "images.json").unlink()
        raise
    shared.atomic_write(STATE / "initial.json", json.dumps({"containers": before}).encode())
    print("已接入原有 1Panel 编排，运行模型和容器均未变化")


def deploy(value):
    shared = helpers()
    check_ci(value)
    state_file = STATE / "state.json"
    previous = json.loads(state_file.read_text()) if state_file.exists() else {}
    if previous.get("sha") == value["sha"] and all(previous.get("images", {}).get(service) == image for service, image in value["images"].items()):
        print("已发布该版本，跳过")
        return
    check_changes(value, previous)
    release = STATE / "releases" / (str(time.time_ns()) + "-" + value["sha"][:12])
    release.mkdir(parents=True, mode=0o700)
    log = release / "deploy.log"
    log.touch(mode=0o600)
    with tempfile.TemporaryDirectory(prefix="lecpunch-registry-", dir="/run") as credentials:
        docker = ["docker", "--config", credentials]
        shared.run([*docker, "login", "ghcr.io", "--username", value["actor"], "--password-stdin"],
                   input=value["token"].encode(), log=log)
        for image in value["images"].values():
            shared.run([*docker, "pull", image], log=log)
            labels = json.loads(shared.run(["docker", "image", "inspect", image]))[0]["Config"].get("Labels", {})
            if labels.get("org.opencontainers.image.revision") != value["sha"]:
                raise ValueError("镜像标签与通过 CI 的提交不一致")
    check_ci(value)
    before = shared.snapshot_containers(PROJECT)
    model = json.loads(shared.compose(PROJECT, "config", "--format", "json"))
    override = release / "images.json"
    # 合并当前覆盖文件，避免只发 Web 时把 API 恢复为 compose.base 中的旧镜像。
    images = json.loads((STATE / "images.json").read_text())
    for service, image in value["images"].items():
        images["services"][service]["image"] = image
    shared.atomic_write(override, json.dumps(images).encode())
    candidate = release / "candidate.json"
    shared.atomic_write(candidate, json.dumps({"include": [{
        "path": [str(DIRECTORY / "compose.base.yml"), str(override)],
        "project_directory": str(DIRECTORY),
    }], "name": PROJECT["name"]}).encode())
    check_model(model, json.loads(shared.compose(PROJECT, "config", "--format", "json", file=candidate)), value["images"])
    print("备份 Mongo", flush=True)
    backup_database(release / "mongo.archive.gz")
    shutil.copy2(STATE / "images.json", release / "previous-images.json")
    shared.atomic_write(STATE / "images.json", override.read_bytes())
    for service in ("api", "web"):
        if service not in value["images"]:
            continue
        print(f"更新 {service} 并等待健康检查", flush=True)
        shared.compose(PROJECT, "up", "-d", "--no-deps", "--no-build", "--pull", "never", "--wait",
                       "--wait-timeout", "180", service, log=log)
    verify_containers(before, value["images"])
    shared.atomic_write(state_file, json.dumps({"sha": value["sha"], "images": {key: entry["image"] for key, entry in images["services"].items()},
                                             "run_id": value["run_id"]}, indent=2).encode())
    print(f"LecPunch 发布成功：{value['sha']}", flush=True)


def main():
    os.umask(0o077)
    if sys.argv[1:] == ["--install"]:
        install()
        return
    if sys.argv[1:] == ["--check"]:
        helpers().compose(PROJECT, "config", "--quiet")
        print("LecPunch 部署入口与现有 1Panel 编排可用")
        return
    if sys.argv[1:] == ["--status"]:
        print(json.dumps({"sha": json.loads((STATE / "state.json").read_text())["sha"]}))
        return
    if sys.argv[1:]:
        raise ValueError("参数不正确")
    value = validate_request(json.loads(sys.stdin.buffer.read(65537)))
    with open("/run/lock/lec-deploy.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        deploy(value)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"发布停止：{error}；请检查 /var/lib/lecpunch-deploy/releases，未自动回退数据库", file=sys.stderr)
        sys.exit(1)
