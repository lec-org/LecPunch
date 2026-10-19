"""验证 main/CI 门槛、专用 SSH 权限，以及数据和双应用的发布边界。"""

import copy
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from lecpunch_changes import affected_services

import gateway
import production


class DeploymentTests(unittest.TestCase):
    def test_independent_and_shared_change_scopes(self):
        for paths, expected in (
            (["apps/web/src/app.tsx"], ["web"]),
            (["apps/api/src/main.ts"], ["api"]),
            (["apps/election/package.json", "apps/election/src/app.tsx"], []),
            (["docs/guide.md", "Jenkinsfile", ".github/workflows/ci.yml"], []),
            (["packages/ui/src/button.tsx", "deploy/nginx.conf"], ["web"]),
            (["packages/shared/src/index.ts"], ["api", "web"]),
            (["pnpm-lock.yaml"], ["api", "web"]),
            (["apps/web/a", "apps/api/b"], ["api", "web"]),
        ):
            with self.subTest(paths=paths):
                self.assertEqual(affected_services(paths), expected)

    def test_server_recomputes_scope_from_last_success_and_accounts_for_renames(self):
        request = self.request()
        request["images"].pop("api")
        compare = {"status": "ahead", "files": [{"filename": "apps/web/new.ts"}]}
        api = Mock(return_value=compare)
        with patch("production.helpers", return_value=SimpleNamespace(api=api)):
            production.check_changes(request, {"sha": "c" * 40})
            api.assert_called_with("/compare/" + "c" * 40 + "..." + "a" * 40, request["token"])
            # 若 API 的上次发布失败，下一次发布仍须包含尚未上线的 API 改动。
            compare["files"].append({"filename": "apps/api/pending.ts"})
            with self.assertRaises(ValueError):
                production.check_changes(request, {"sha": "c" * 40})
            compare["files"] = [{"filename": "apps/web/new.ts", "previous_filename": "apps/api/old.ts"}]
            with self.assertRaises(ValueError):
                production.check_changes(request, {"sha": "c" * 40})
            compare["files"] = [{"filename": "apps/election/main.ts"}]
            with self.assertRaises(ValueError):
                production.check_changes(request, {"sha": "c" * 40})
            compare["files"] = [{"filename": "apps/web/file.ts"}] * 300
            with self.assertRaises(ValueError):
                production.check_changes(request, {"sha": "c" * 40})

    def test_single_service_requires_its_build_but_not_the_other_build(self):
        for service in ("api", "web"):
            request, responses = self.jenkins()
            request["images"] = {service: request["images"][service]}
            responses[2]["images"] = request["images"]
            responses[1]["stages"] = [stage for stage in responses[1]["stages"] if stage["name"] in production.required_jobs(request)]
            with patch("production.jenkins_api", side_effect=responses):
                production.check_jenkins(request)
            responses[1]["stages"][-1]["status"] = "NOT_EXECUTED"
            with patch("production.jenkins_api", side_effect=responses):
                with self.assertRaises(ValueError):
                    production.check_jenkins(request)

    def test_unselected_service_image_change_is_rejected(self):
        before = self.model()
        after = copy.deepcopy(before)
        after["services"]["web"]["image"] = "new-web"
        production.check_model(before, after, ["web"])
        after["services"]["api"]["image"] = "new-api"
        with self.assertRaises(ValueError):
            production.check_model(before, after, ["web"])

    def test_unselected_containers_must_keep_their_identity(self):
        before = {name: {"id": name + "-old", "ports": [], "mounts": []} for name in ("api", "web", "mongo")}
        for selected, unexpected in (("web", "api"), ("api", "web"), ("web", "mongo")):
            after = copy.deepcopy(before)
            after[unexpected]["id"] = unexpected + "-new"
            with self.subTest(selected=selected, unexpected=unexpected), \
                    patch("production.helpers", return_value=SimpleNamespace(snapshot_containers=Mock(return_value=after))):
                with self.assertRaises(ValueError):
                    production.verify_containers(before, [selected])

    def test_partial_deployment_preserves_unselected_image_and_does_not_restart_it(self):
        for service in ("api", "web"):
            with self.subTest(service=service), tempfile.TemporaryDirectory() as root:
                state = Path(root)
                (state / "images.json").write_text(json.dumps({"services": {key: {"image": "old-" + key} for key in ("api", "web")}}))
                request = self.request()
                request["images"] = {service: request["images"][service]}
                shared = Mock()
                shared.run.return_value = json.dumps([{"Config": {"Labels": {"org.opencontainers.image.revision": request["sha"]}}}]).encode()
                shared.compose.return_value = json.dumps(self.model()).encode()
                shared.atomic_write.side_effect = lambda path, data: Path(path).write_bytes(data)
                temporary_directory = tempfile.TemporaryDirectory
                with patch("production.STATE", state), patch("production.helpers", return_value=shared), \
                        patch("production.check_ci"), patch("production.check_changes"), patch("production.backup_database"), \
                        patch("production.verify_containers") as verify, \
                        patch("production.tempfile.TemporaryDirectory", side_effect=lambda **kwargs: temporary_directory(dir=root)):
                    production.deploy(request)
                updates = [call.args[-1] for call in shared.compose.call_args_list if "up" in call.args]
                self.assertEqual(updates, [service])
                images = json.loads((state / "images.json").read_text())["services"]
                other = "api" if service == "web" else "web"
                self.assertEqual(images[other]["image"], "old-" + other)
                self.assertEqual(images[service]["image"], request["images"][service])
                self.assertEqual(json.loads((state / "state.json").read_text())["images"][other], "old-" + other)
                self.assertEqual(verify.call_args.args[1], request["images"])

    def request(self):
        return {"sha": "a" * 40, "run_id": 123, "actor": "test-user", "token": "temporary-token",
                "images": {service: f"ghcr.io/lec-org/lecpunch-{service}@sha256:" + "b" * 64
                           for service in ("api", "web")}}

    def ci(self):
        return {"event": "push", "head_branch": "main", "head_sha": "a" * 40,
                "head_repository": {"full_name": production.REPOSITORY}, "path": ".github/workflows/ci.yml"}

    def jobs(self):
        return {"jobs": [{"name": name, "conclusion": "success"} for name in production.REQUIRED_JOBS]}

    def test_only_main_push_for_the_exact_ci_sha_can_deploy(self):
        for field, invalid in (("event", "pull_request"), ("head_branch", "feature"),
                               ("head_sha", "c" * 40), ("head_repository", {"full_name": "other/repo"}),
                               ("path", ".github/workflows/other.yml")):
            run = self.ci()
            run[field] = invalid
            with self.subTest(field=field), patch("production.helpers", return_value=SimpleNamespace(api=Mock(return_value=run))):
                with self.assertRaises(ValueError):
                    production.check_ci(self.request())
        api = Mock(side_effect=[self.ci(), self.jobs(), {"sha": "a" * 40}])
        with patch("production.helpers", return_value=SimpleNamespace(api=api)):
            production.check_ci(self.request())

    def test_any_missing_failed_cancelled_or_skipped_required_job_blocks_deploy(self):
        for job in production.REQUIRED_JOBS:
            for conclusion in (None, "failure", "cancelled", "skipped"):
                jobs = self.jobs()
                next(item for item in jobs["jobs"] if item["name"] == job)["conclusion"] = conclusion
                api = Mock(side_effect=[self.ci(), jobs])
                with self.subTest(job=job, conclusion=conclusion), patch("production.helpers", return_value=SimpleNamespace(api=api)):
                    with self.assertRaises(ValueError):
                        production.check_ci(self.request())
        api = Mock(side_effect=[self.ci(), {"jobs": []}])
        with patch("production.helpers", return_value=SimpleNamespace(api=api)):
            with self.assertRaises(ValueError):
                production.check_ci(self.request())

    def test_newer_main_blocks_an_outdated_build(self):
        api = Mock(side_effect=[self.ci(), self.jobs(), {"sha": "c" * 40}])
        with patch("production.helpers", return_value=SimpleNamespace(api=api)):
            with self.assertRaises(ValueError):
                production.check_ci(self.request())

    def jenkins(self):
        request = {**self.request(), "ci": "jenkins"}
        responses = [{"number": request["run_id"], "result": None},
                     {"stages": [{"name": name, "status": "SUCCESS"} for name in production.REQUIRED_JOBS]},
                     {"repository": production.REPOSITORY, "branch": "main", "sha": request["sha"], "images": request["images"]}]
        return request, responses

    def test_jenkins_requires_successful_stages_and_exact_archived_main_artifacts(self):
        request, responses = self.jenkins()
        production.validate_request(request)
        with patch("production.jenkins_api", side_effect=responses):
            production.check_jenkins(request)
        for status in ("FAILURE", "ABORTED", "UNSTABLE", "NOT_BUILT"):
            _, invalid = self.jenkins()
            invalid[0]["result"] = status
            with self.subTest(status=status), patch("production.jenkins_api", side_effect=invalid):
                with self.assertRaises(ValueError):
                    production.check_jenkins(request)
        for name in production.REQUIRED_JOBS:
            for status in ("FAILED", "ABORTED", "NOT_EXECUTED", "IN_PROGRESS"):
                _, invalid = self.jenkins()
                next(stage for stage in invalid[1]["stages"] if stage["name"] == name)["status"] = status
                with self.subTest(name=name, status=status), patch("production.jenkins_api", side_effect=invalid):
                    with self.assertRaises(ValueError):
                        production.check_jenkins(request)
        for field, value in (("branch", "feature"), ("repository", "other/repo"), ("sha", "c" * 40), ("images", {})):
            _, invalid = self.jenkins()
            invalid[2][field] = value
            with self.subTest(field=field), patch("production.jenkins_api", side_effect=invalid):
                with self.assertRaises(ValueError):
                    production.check_jenkins(request)

    def test_jenkins_also_rejects_stale_main(self):
        request, _ = self.jenkins()
        with patch("production.check_jenkins"), patch("production.helpers", return_value=SimpleNamespace(api=Mock(return_value={"sha": "c" * 40}))):
            with self.assertRaises(ValueError):
                production.check_ci(request)

    def test_only_the_two_fixed_digest_images_are_accepted(self):
        production.validate_request(self.request())
        for service in ("api", "web"):
            for invalid in ("ghcr.io/lec-org/lecpunch-web:latest", "ghcr.io/other/api@sha256:" + "b" * 64, "$(id)"):
                value = self.request()
                value["images"][service] = invalid
                with self.assertRaises(ValueError):
                    production.validate_request(value)
        for field, invalid in (("run_id", True), ("sha", "main"), ("images", {})):
            value = self.request()
            value[field] = invalid
            with self.assertRaises(ValueError):
                production.validate_request(value)

    def model(self):
        return {"services": {
            "mongo": {"image": "mongo", "volumes": ["mongo-data:/data/db"]},
            "api": {"image": "old-api", "environment": {"EXAMPLE": "server-only"}, "volumes": ["images:/data/images"]},
            "web": {"image": "old-web", "ports": ["127.0.0.1:18082:80"]},
        }, "volumes": {"mongo-data": {}, "images": {}}}

    def test_both_images_can_change_but_no_other_runtime_configuration_can(self):
        before = self.model()
        after = copy.deepcopy(before)
        for service in ("api", "web"):
            after["services"][service]["image"] = "new"
        production.check_model(before, after)
        for service, field, invalid in (("web", "ports", []), ("api", "volumes", []),
                                         ("api", "environment", {}), ("mongo", "image", "new-mongo")):
            changed = copy.deepcopy(after)
            changed["services"][service][field] = invalid
            with self.assertRaises(ValueError):
                production.check_model(before, changed)

    def test_compose_include_may_drop_anchor_metadata_but_not_service_logging(self):
        before = self.model()
        before["x-logging"] = {"driver": "local"}
        before["services"]["web"]["logging"] = {"driver": "local"}
        after = copy.deepcopy(before)
        del after["x-logging"]
        production.check_model(before, after)
        after["services"]["web"]["logging"] = {"driver": "json-file"}
        with self.assertRaises(ValueError):
            production.check_model(before, after)

    def test_ssh_keys_cannot_open_shells_or_publish_other_services(self):
        for mode in ("cloud", "pve"):
            for command in ("sh", "scp -t /tmp", "deploy; id", "pct exec 104 -- sh", ""):
                with patch("gateway.sys.argv", ["gateway", mode]), patch.dict("os.environ", {"SSH_ORIGINAL_COMMAND": command}):
                    with self.assertRaises(ValueError):
                        gateway.main()
        with patch("gateway.sys.argv", ["gateway", "pve"]), patch.dict("os.environ", {"SSH_ORIGINAL_COMMAND": "check"}), \
                patch("gateway.subprocess.call", return_value=0) as execute:
            gateway.main()
            self.assertEqual(execute.call_args.args[0], ["pct", "exec", "103", "--", "/usr/local/sbin/lec-deploy-punch", "--check"])

    def test_ci_failure_stops_before_any_docker_or_data_change(self):
        shared = Mock()
        with patch("production.helpers", return_value=shared), patch("production.check_ci", side_effect=ValueError("CI 失败")):
            with self.assertRaises(ValueError):
                production.deploy(self.request())
        shared.run.assert_not_called()
        shared.compose.assert_not_called()

    def test_backup_failure_stops_before_replacing_images_or_containers(self):
        with tempfile.TemporaryDirectory() as root:
            state = Path(root)
            image_file = state / "images.json"
            image_file.write_text(json.dumps({"services": {service: {"image": "old-" + service} for service in ("api", "web")}}))
            shared = Mock()
            shared.run.return_value = json.dumps([{"Config": {"Labels": {"org.opencontainers.image.revision": "a" * 40}}}]).encode()
            shared.compose.return_value = json.dumps(self.model()).encode()
            shared.atomic_write.side_effect = lambda path, data: Path(path).write_bytes(data)
            temporary_directory = tempfile.TemporaryDirectory
            with patch("production.STATE", state), patch("production.helpers", return_value=shared), \
                    patch("production.check_ci"), patch("production.check_changes"), patch("production.backup_database", side_effect=RuntimeError("备份失败")), \
                    patch("production.tempfile.TemporaryDirectory", side_effect=lambda **kwargs: temporary_directory(dir=root)):
                with self.assertRaises(RuntimeError):
                    production.deploy(self.request())
            self.assertEqual(json.loads(image_file.read_text())["services"]["api"]["image"], "old-api")
            self.assertFalse((state / "state.json").exists())
            self.assertFalse(any("up" in call.args for call in shared.compose.call_args_list))

    def test_api_health_failure_stops_web_and_does_not_mark_release_successful(self):
        with tempfile.TemporaryDirectory() as root:
            state = Path(root)
            (state / "images.json").write_text(json.dumps({"services": {service: {"image": "old-" + service} for service in ("api", "web")}}))
            shared = Mock()
            shared.run.return_value = json.dumps([{"Config": {"Labels": {"org.opencontainers.image.revision": "a" * 40}}}]).encode()
            shared.compose.side_effect = [json.dumps(self.model()).encode(), json.dumps(self.model()).encode(), RuntimeError("API 不健康")]
            shared.atomic_write.side_effect = lambda path, data: Path(path).write_bytes(data)
            temporary_directory = tempfile.TemporaryDirectory
            with patch("production.STATE", state), patch("production.helpers", return_value=shared), \
                    patch("production.check_ci"), patch("production.check_changes"), patch("production.backup_database"), \
                    patch("production.tempfile.TemporaryDirectory", side_effect=lambda **kwargs: temporary_directory(dir=root)):
                with self.assertRaises(RuntimeError):
                    production.deploy(self.request())
            self.assertFalse((state / "state.json").exists())
            updates = [call for call in shared.compose.call_args_list if "up" in call.args]
            self.assertEqual(len(updates), 1)
            self.assertEqual(updates[0].args[-1], "api")
            self.assertEqual(json.loads(next((state / "releases").glob("*/previous-images.json")).read_text())["services"]["api"]["image"], "old-api")


if __name__ == "__main__":
    unittest.main()
