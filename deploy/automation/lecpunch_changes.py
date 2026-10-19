"""Web/API 共用的发布范围判断；桌面端不自动发布。"""

import argparse
import json
import subprocess


def affected_services(paths):
    services = set()
    common = {"package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "turbo.json", ".npmrc", ".dockerignore"}
    for path in paths:
        if path.startswith("apps/web/") or path == "deploy/nginx.conf" or path.startswith("packages/ui/"):
            services.add("web")
        elif path.startswith("apps/api/") or path == "nest-cli.json":
            services.add("api")
        elif path in common or path.startswith(("packages/shared/", "packages/tsconfig/", "packages/eslint-config/")):
            services.update(("api", "web"))
    return sorted(services)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("base")
    parser.add_argument("head")
    args = parser.parse_args()
    # 禁用重命名折叠，跨应用移动文件时同时考虑原路径和新路径。
    paths = subprocess.check_output(["git", "diff", "--name-only", "--no-renames", "-z", args.base, args.head]).decode().split("\0")
    print(json.dumps(affected_services(paths)))
