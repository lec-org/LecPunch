"""Check publishing conditions without importing Linux-only deployment helpers."""

from pathlib import Path
import re
from types import SimpleNamespace
import unittest


class WorkflowBoundaryTests(unittest.TestCase):
    def test_publish_jobs_only_allow_upstream_main_push(self):
        workflow = (Path(__file__).resolve().parents[2] / '.github/workflows/ci.yml').read_text(encoding='utf-8')
        for job in ('build-images', 'deploy'):
            block = re.search(rf'^  {job}:\n(.*?)(?=^  [a-z]|\Z)', workflow, re.MULTILINE | re.DOTALL)
            self.assertIsNotNone(block)
            condition = re.search(r'^    if: (.+)$', block.group(1), re.MULTILINE).group(1)
            for repository, event, ref, allowed in (
                ('lec-org/LecPunch', 'push', 'refs/heads/main', True),
                ('17hwliao/LecPunch', 'push', 'refs/heads/main', False),
                ('lec-org/LecPunch', 'pull_request', 'refs/pull/9/merge', False),
                ('lec-org/LecPunch', 'push', 'refs/heads/feature', False),
            ):
                with self.subTest(job=job, repository=repository, event=event, ref=ref):
                    github = SimpleNamespace(repository=repository, event_name=event, ref=ref)
                    self.assertEqual(eval(condition.replace('&&', 'and'), {'__builtins__': {}}, {'github': github}), allowed)


if __name__ == '__main__':
    unittest.main()
