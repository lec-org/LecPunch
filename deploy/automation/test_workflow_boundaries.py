"""防止 Actions 与 KubeSphere 同时自动部署，以及桌面端意外自动发布。"""

from pathlib import Path
import re
import unittest


class WorkflowBoundaryTests(unittest.TestCase):
    def test_actions_only_check_pr_and_desktop_requires_manual_dispatch(self):
        root = Path(__file__).resolve().parents[2]
        for filename, trigger in (("ci.yml", "pull_request"), ("desktop-release.yml", "workflow_dispatch")):
            workflow = (root / ".github/workflows" / filename).read_text()
            events = workflow.split("on:\n", 1)[1].split("\npermissions:", 1)[0]
            self.assertEqual(re.findall(r"^  ([a-z_]+):", events, re.MULTILINE), [trigger])
        self.assertNotIn("LEC_DEPLOY_SSH_KEY", (root / ".github/workflows/ci.yml").read_text())


if __name__ == "__main__":
    unittest.main()
