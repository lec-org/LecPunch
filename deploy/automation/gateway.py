#!/usr/bin/env python3
"""专用密钥仅允许经公网跳板发布 LecPunch，不能执行任意命令。"""

import os
import subprocess
import sys


def main():
    command = os.environ.get("SSH_ORIGINAL_COMMAND", "")
    if command not in ("deploy", "check", "status"):
        raise ValueError("该密钥只允许 deploy、check 或 status")
    if sys.argv[1:] == ["cloud"]:
        args = ["ssh", "-i", "/var/lib/lecpunch-deploy/pve-key", "-o", "IdentitiesOnly=yes",
                "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
                "-o", "UserKnownHostsFile=/var/lib/lecpunch-deploy/known_hosts",
                "-o", "ServerAliveInterval=30", "-o", "ServerAliveCountMax=10",
                "-p", "46776", "root@127.0.0.1", command]
    elif sys.argv[1:] == ["pve"]:
        args = ["pct", "exec", "103", "--", "/usr/local/sbin/lec-deploy-punch"]
        if command != "deploy":
            args.append("--" + command)
    else:
        raise ValueError("部署入口配置不正确")
    return subprocess.call(args)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ValueError as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
