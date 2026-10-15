import gzip
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


controller = module('controller', 'deploy/server/controller.py')
release = module('release', 'deploy/scripts/release.py')
NEW = 'a' * 40 + '-123-1'
OLD = 'b' * 40 + '-122-1'
IMAGE = 'ghcr.io/international-group/test@sha256:' + 'c' * 64


class FakeController(controller.Controller):
    def __init__(self, config):
        super().__init__(config)
        self.events, self.failure = [], None

    def preflight(self, record):
        self.events.append(('preflight', record['releaseId']))
        if self.failure == 'preflight':
            raise controller.DeploymentError('preflight failed')
        return dict(schemaHash='schema', strapiVersion='version')

    def database_backup(self, record):
        self.events.append(('backup', record['releaseId']))
        if self.failure == 'backup':
            raise controller.DeploymentError('backup failed')

    def start(self, record):
        self.events.append(('start', record['releaseId']))
        if self.failure == 'start' and record['releaseId'] == NEW:
            raise controller.DeploymentError('candidate failed')

    def stop(self, record):
        self.events.append(('stop', record['releaseId']))

    def restore_runtime(self, record):
        self.events.append(('restart', record['releaseId']))

    def public_check(self, record):
        self.events.append(('public', record['releaseId']))
        if self.failure == 'public' and record['releaseId'] == NEW:
            raise controller.DeploymentError('public failed')
        if self.failure == 'rollback' and record['releaseId'] == OLD:
            raise controller.DeploymentError('rollback failed')


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        for name in ['backups', 'releases']:
            (self.root / name).mkdir()
        self.config = dict(runtime=str(self.root), app='test', live_port=1337, domain='cms.example.com', uploads='/uploads')
        self.old = dict(releaseId=OLD, container='test-blue', port=1337, image='old-image')
        self.candidate = dict(releaseId=NEW, container='test-green', port=1337, image=IMAGE, basedOn=OLD)
        controller.save(self.root / 'state.json', self.old)
        controller.save(self.root / 'pending.json', self.candidate)
        self.c = FakeController(self.config)

    def tearDown(self):
        self.temp.cleanup()

    def test_backup_precedes_stop_and_only_one_strapi_instance_is_started(self):
        result = self.c.activate(NEW)
        self.assertLess(self.c.events.index(('backup', NEW)), self.c.events.index(('stop', OLD)))
        self.assertLess(self.c.events.index(('stop', OLD)), self.c.events.index(('start', NEW)))
        self.assertEqual(result['previous']['releaseId'], OLD)
        self.assertFalse(self.c.journal.exists())

    def test_preflight_or_backup_failure_leaves_live_cms_untouched(self):
        for failure in ['preflight', 'backup']:
            with self.subTest(failure=failure):
                self.c.events, self.c.failure = [], failure
                with self.assertRaises(controller.DeploymentError): self.c.activate(NEW)
                self.assertFalse(any(e[0] in ['stop', 'start'] for e in self.c.events))
                self.assertEqual(self.c.status(), self.old)

    def test_candidate_start_failure_stops_candidate_before_restoring_previous(self):
        self.c.failure = 'start'
        with self.assertRaises(controller.DeploymentError): self.c.activate(NEW)
        self.assertLess(self.c.events.index(('stop', NEW)), self.c.events.index(('restart', OLD)))
        self.assertEqual(self.c.status(), self.old)
        self.assertFalse(self.c.journal.exists())

    def test_admin_or_public_health_failure_restores_previous_state(self):
        self.c.failure = 'public'
        with self.assertRaises(controller.DeploymentError): self.c.activate(NEW)
        self.assertIn(('public', OLD), self.c.events)
        self.assertEqual(self.c.status(), self.old)

    def test_rollback_only_restores_recorded_previous_version(self):
        self.c.activate(NEW)
        with self.assertRaises(controller.DeploymentError): self.c.restore(NEW, 'd' * 40 + '-1-1')
        self.assertEqual(self.c.restore(NEW, OLD), self.old)

    def test_failed_rollback_restores_current_release(self):
        current = self.c.activate(NEW)
        self.c.failure = 'rollback'
        with self.assertRaises(controller.DeploymentError): self.c.restore(NEW, OLD)
        self.assertEqual(self.c.status(), current)
        self.assertFalse(self.c.journal.exists())

    def test_stale_candidate_is_rejected_without_side_effects(self):
        controller.save(self.c.pending_file, {**self.candidate, 'basedOn': 'other'})
        with self.assertRaises(controller.DeploymentError): self.c.activate(NEW)
        self.assertEqual(self.c.events, [])

    def test_interrupted_activation_recovers_from_persistent_journal(self):
        transaction = self.c.backup(self.old, self.candidate)
        controller.save(self.c.journal, transaction)
        self.c.recover(transaction)
        self.assertEqual(self.c.status(), self.old)
        self.assertFalse(self.c.journal.exists())

    def test_runtime_mounts_only_uploads_and_has_bounded_logs(self):
        real = controller.Controller(self.config)
        with patch.object(real, 'remove_candidate'), patch.object(real, 'wait_healthy'), patch.object(real, 'run') as run:
            real.start(self.candidate)
            args = run.call_args.args[0]
            self.assertIn('HOST=127.0.0.1', args)
            self.assertIn('APP_HOST=127.0.0.1', args)
            self.assertIn('max-size=20m', args)
            self.assertEqual(args.count('--mount'), 1)
            self.assertIn('target=/app/public/uploads', args[args.index('--mount') + 1])
            self.assertNotIn('--privileged', args)

    def test_preflight_never_starts_strapi_or_mounts_source(self):
        real = controller.Controller(self.config)
        payload = dict(releaseId=NEW, adminBuilt=True, schemaHash='schema', strapiVersion='version')
        with patch.object(real, 'run', return_value=json.dumps(payload).encode()) as run:
            real.preflight(self.candidate)
            args = run.call_args.args[0]
            self.assertIn('--read-only', args)
            self.assertEqual(args[-1], 'deploy/runtime/preflight.cjs')
            self.assertNotIn('--mount', args)

    def test_initial_migration_rejects_different_models_or_framework(self):
        real = controller.Controller(self.config)
        controller.save(real.state_file, {**self.old, 'releaseId': 'legacy-20261015', 'schemaHash': 'original', 'strapiVersion': 'version'})
        for schema, version in [('changed', 'version'), ('original', 'upgraded')]:
            with patch.object(real, 'run', return_value=json.dumps(dict(releaseId=NEW, adminBuilt=True, schemaHash=schema, strapiVersion=version)).encode()):
                with self.assertRaises(controller.DeploymentError): real.preflight(self.candidate)

    def test_stopped_rollback_instance_stays_stopped_after_reboot(self):
        real = controller.Controller(self.config)
        with patch.object(real, 'inspect', return_value={'State': {'Running': True}}), patch.object(real, 'run') as run:
            real.stop(self.old)
            self.assertEqual(run.call_args_list[0].args[0], ['docker', 'update', '--restart', 'unless-stopped', 'test-blue'])

    def test_cold_rollback_recreates_the_recorded_image(self):
        real = controller.Controller(self.config)
        with patch.object(real, 'inspect', return_value=None), patch.object(real, 'start') as start, patch.object(real, 'wait_healthy'):
            real.restore_runtime(self.old)
            start.assert_called_once_with(self.old)

    def test_real_backup_stream_validates_completion_and_cleans_failed_partial(self):
        real = controller.Controller(self.config)
        (self.root / 'app.env').write_text('DATABASE_CLIENT=postgres\nDATABASE_HOST=localhost\nDATABASE_PORT=5432\nDATABASE_USERNAME=test\nDATABASE_PASSWORD=test\nDATABASE_NAME=test\n')
        binary = self.root / 'pg_dump'
        binary.write_text('#!/bin/sh\nprintf "-- test SQL\\n-- PostgreSQL database dump complete\\n"\n')
        # POSIX printf interprets a leading -- as an option on some systems.
        binary.write_text('#!/bin/sh\nprintf "%s\\n" "-- test SQL" "-- PostgreSQL database dump complete"\n')
        binary.chmod(0o755)
        with patch.dict(os.environ, {'PATH': str(self.root) + os.pathsep + os.environ['PATH']}):
            real.database_backup(self.candidate)
            good = self.root / 'database' / (NEW + '.sql.gz')
            self.assertIn(b'PostgreSQL database dump complete', gzip.decompress(good.read_bytes()))
            binary.write_text('#!/bin/sh\nprintf incomplete\nexit 1\n')
            with self.assertRaises(controller.DeploymentError): real.database_backup(self.old)
            self.assertTrue(good.exists())
            self.assertEqual(list((self.root / 'database').glob('*.part')), [])


class ContractTests(unittest.TestCase):
    def test_command_injection_mutable_tags_and_other_repositories_are_rejected(self):
        repository = IMAGE.split('@')[0]
        for command in ['status\nactivate ' + NEW, 'activate ' + NEW + ';echo x',
                        f'stage {NEW} evil/image@sha256:' + 'c' * 64 + ' actor',
                        f'stage {NEW} {repository}:latest actor', 'status extra']:
            with self.assertRaises(controller.DeploymentError): controller.validate(command, repository)
        self.assertEqual(controller.validate(f'stage {NEW} {IMAGE} actor', repository)[0], 'stage')

    def test_context_excludes_credentials_uploads_and_operator_files(self):
        rules = (ROOT / '.dockerignore').read_text().splitlines()
        for rule in ['.env*', '**/.env*', '**/*.pem', '**/*.key', 'runtime', 'logs', '.git', 'public/uploads/*']:
            self.assertIn(rule, rules)

    def test_release_and_rollback_share_concurrency_and_main_guard(self):
        project = json.loads((ROOT / 'deploy/project.json').read_text())
        for name in ['release', 'rollback']:
            workflow = (ROOT / '.github/workflows' / (name + '.yml')).read_text()
            self.assertIn('group: ' + project['app'] + '-production', workflow)
            self.assertIn("github.ref == 'refs/heads/main'", workflow)
            self.assertIn('cancel-in-progress: false', workflow)

    def test_connection_loss_after_switch_requests_rollback(self):
        class Remote:
            def __init__(self): self.switched = False; self.calls = []
            def call(self, command, token=''):
                self.calls.append(command)
                if command == 'status': return {'releaseId': NEW if self.switched else OLD}
                if command.startswith('activate'):
                    self.switched = True
                    raise RuntimeError('connection dropped')
                return {'releaseId': OLD}
        remote = Remote()
        report = release.execute(remote, NEW, IMAGE, 'actor', 'temporary-token', 'deploy')
        self.assertEqual(report['state'], 'failed')
        self.assertIn(f'restore {NEW} {OLD}', remote.calls)

    def test_stage_only_does_not_activate(self):
        calls = []
        class Remote:
            def call(self, command, token=''):
                calls.append(command)
                return {'releaseId': OLD}
        self.assertEqual(release.execute(Remote(), NEW, IMAGE, 'actor', 'token', 'stage')['state'], 'staged')
        self.assertFalse(any(command.startswith('activate') for command in calls))


if __name__ == '__main__':
    unittest.main()
