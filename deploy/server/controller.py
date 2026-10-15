#!/usr/bin/env python3
"""Restricted, journaled single-instance CMS releases. Production never builds code."""
import fcntl
import gzip
import html
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile
import time
from urllib.parse import urljoin, urlparse

RELEASE = re.compile(r'^[a-f0-9]{40}-[0-9]+-[0-9]+$')
DIGEST = re.compile(r'^sha256:[a-f0-9]{64}$')
PREVIOUS = re.compile(r'^(?:[a-f0-9]{40}-[0-9]+-[0-9]+|legacy-[0-9]+)$')


class DeploymentError(Exception):
    pass


def validate(command, repository):
    if '\n' in command or '\r' in command:
        raise DeploymentError('Multiline commands are forbidden')
    args = command.split()
    if args == ['status']:
        return args
    if len(args) == 2 and args[0] == 'activate' and RELEASE.fullmatch(args[1]):
        return args
    if len(args) == 3 and args[0] == 'restore' and RELEASE.fullmatch(args[1]) and PREVIOUS.fullmatch(args[2]):
        return args
    if (len(args) == 4 and args[0] == 'stage' and RELEASE.fullmatch(args[1])
            and args[2].startswith(repository + '@') and DIGEST.fullmatch(args[2].split('@')[-1])
            and re.fullmatch(r'[A-Za-z0-9_-]+', args[3])):
        return args
    raise DeploymentError('Unsupported command or immutable release metadata')


def read(path):
    return json.loads(Path(path).read_text())


def save(path, value):
    path = Path(path)
    temporary = path.with_suffix(path.suffix + '.tmp')
    with open(temporary, 'w') as file:
        os.chmod(temporary, 0o600)
        json.dump(value, file)
        file.flush()
        os.fsync(file.fileno())
    os.replace(temporary, path)


class Controller:
    def __init__(self, config):
        self.c = config
        self.root = Path(config['runtime'])
        self.state_file = self.root / 'state.json'
        self.pending_file = self.root / 'pending.json'
        self.journal = self.root / 'transaction.json'

    def run(self, args, data=None, timeout=180):
        result = subprocess.run(args, input=data, capture_output=True, timeout=timeout)
        if result.returncode:
            raise DeploymentError(f'{args[0]} operation failed (exit {result.returncode}); inspect private server logs')
        return result.stdout

    def inspect(self, name):
        result = subprocess.run(['docker', 'inspect', name], capture_output=True)
        return json.loads(result.stdout)[0] if result.returncode == 0 else None

    def status(self):
        return read(self.state_file)

    def log(self, message):
        with open(self.root / 'deploy.log', 'a') as file:
            file.write(time.strftime('%Y-%m-%dT%H:%M:%SZ ', time.gmtime()) + message + '\n')

    def stop(self, record):
        info = self.inspect(record['container'])
        if info and info['State']['Running']:
            self.run(['docker', 'update', '--restart', 'unless-stopped', record['container']])
            self.run(['docker', 'stop', '--time', '60', record['container']], timeout=90)

    def remove_candidate(self, name):
        info = self.inspect(name)
        if not info:
            return
        if info['Config'].get('Labels', {}).get('com.fanruan.deployment') != self.c['app']:
            raise DeploymentError('Refusing to remove an unmanaged container')
        if name == self.status()['container'] and info['State']['Running']:
            raise DeploymentError('Refusing to replace the live container')
        self.run(['docker', 'rm', '-f', name])

    def start(self, record):
        self.remove_candidate(record['container'])
        args = ['docker', 'run', '-d', '--init', '--name', record['container'], '--restart', 'unless-stopped',
                '--label', 'com.fanruan.deployment=' + self.c['app'],
                '--label', 'com.fanruan.release=' + record['releaseId'],
                '--env-file', str(self.root / 'app.env'), '-e', 'NODE_ENV=production',
                '--log-opt', 'max-size=20m', '--log-opt', 'max-file=5', '--network', 'host',
                '-e', f'PORT={record["port"]}', '-e', f'NODE_PORT={record["port"]}',
                '-e', 'HOST=127.0.0.1', '-e', 'APP_HOST=127.0.0.1',
                '--mount', f'type=bind,source={self.c["uploads"]},target=/app/public/uploads']
        self.run(args + [record['image']])
        self.wait_healthy(record)

    def preflight(self, record):
        result = self.run(['docker', 'run', '--rm', '--read-only', '--tmpfs', '/tmp', '--network', 'host',
                           '--env-file', str(self.root / 'app.env'), '--entrypoint', 'node',
                           record['image'], 'deploy/runtime/preflight.cjs'], timeout=90)
        report = json.loads(result)
        if report.get('releaseId') != record['releaseId'] or not report.get('adminBuilt'):
            raise DeploymentError('Candidate image preflight mismatch')
        current = self.status()
        if current['releaseId'].startswith('legacy-') and (report['schemaHash'] != current['schemaHash'] or report['strapiVersion'] != current['strapiVersion']):
            raise DeploymentError('Initial migration must preserve the deployed CMS schema and Strapi version')
        return report

    def health(self, record, public=False):
        args = ['curl', '-fsS', '--max-time', '8']
        if public:
            args += ['--resolve', f'{self.c["domain"]}:443:127.0.0.1', f'https://{self.c["domain"]}/healthz']
        else:
            args += [f'http://127.0.0.1:{record["port"]}/healthz']
        body = json.loads(self.run(args, timeout=12))
        if body.get('releaseId') != record['releaseId'] or body.get('status') != 'ok':
            raise DeploymentError('Release readiness mismatch')

    def wait_healthy(self, record):
        for _ in range(90):
            try:
                self.health(record)
                return
            except (DeploymentError, ValueError, subprocess.TimeoutExpired):
                time.sleep(2)
        raise DeploymentError('CMS did not become ready')

    def page_check(self, record):
        origin = f'https://{self.c["domain"]}'
        args = ['curl', '-fsS', '--max-time', '20', '--resolve', f'{self.c["domain"]}:443:127.0.0.1']
        body = self.run(args + [origin + '/admin/']).decode()
        assets = set(re.findall(r'(?:src|href)=["\']([^"\']+\.(?:js|css)(?:\?[^"\']*)?)["\']', body))
        if '<html' not in body or not assets:
            raise DeploymentError('CMS admin page or compiled assets missing')
        for asset in assets:
            url = urljoin(origin + '/admin/', html.unescape(asset))
            if urlparse(url).netloc != self.c['domain']:
                raise DeploymentError('Unexpected external admin bundle')
            self.run(args + ['--head', url], timeout=25)
        init = json.loads(self.run(args + [origin + '/admin/init']))
        if not init.get('data', {}).get('hasAdmin'):
            raise DeploymentError('Existing CMS administrator is missing')

    def public_check(self, record):
        if record['releaseId'].startswith('legacy-'):
            self.legacy_check(record, public=True)
        else:
            self.health(record, public=True)
        self.page_check(record)

    def legacy_check(self, record, public=False):
        args = ['curl', '-sS', '--max-time', '8', '-o', '/dev/null', '-w', '%{http_code}']
        if public:
            args += ['--resolve', f'{self.c["domain"]}:443:127.0.0.1', f'https://{self.c["domain"]}/_health']
        else:
            args += [f'http://127.0.0.1:{record["port"]}/_health']
        for _ in range(90):
            try:
                if self.run(args, timeout=12).decode() == '204':
                    return
            except (DeploymentError, subprocess.TimeoutExpired):
                pass
            time.sleep(2)
        raise DeploymentError('Legacy CMS did not become ready')

    def stage(self, release, image, actor, token):
        current = self.status()
        if current['releaseId'] == release:
            if current['image'] != image:
                raise DeploymentError('Release already belongs to another image')
            self.public_check(current)
            return current
        with tempfile.TemporaryDirectory(dir=self.root) as directory:
            self.run(['docker', '--config', directory, 'login', 'ghcr.io', '-u', actor, '--password-stdin'], token.encode())
            self.run(['docker', '--config', directory, 'pull', image], timeout=600)
        info = self.inspect(image)
        labels = info['Config'].get('Labels', {})
        if labels.get('org.opencontainers.image.version') != release or labels.get('org.opencontainers.image.revision') != release[:40]:
            raise DeploymentError('Image provenance labels do not match release')
        if info['Config'].get('User') not in ['node', '1000', '1000:1000']:
            raise DeploymentError('CMS image must run without root privileges')
        slot = 'green' if current['container'] == self.c['app'] + '-blue' else 'blue'
        candidate = dict(releaseId=release, image=image, container=self.c['app'] + '-' + slot,
                         port=self.c['live_port'], basedOn=current['releaseId'])
        report = self.preflight(candidate)
        candidate.update(schemaHash=report['schemaHash'], strapiVersion=report['strapiVersion'])
        save(self.pending_file, candidate)
        save(self.root / 'releases' / (release + '.json'), candidate)
        self.log('staged ' + release + ' without starting Strapi')
        return candidate

    def database_backup(self, record):
        env = dict(line.split('=', 1) for line in (self.root / 'app.env').read_text().splitlines() if line and not line.startswith('#'))
        destination = self.root / 'database' / (record['releaseId'] + '.sql.gz')
        destination.parent.mkdir(mode=0o700, exist_ok=True)
        partial = destination.with_suffix('.gz.part')
        try:
            with tempfile.TemporaryDirectory(dir=self.root) as directory:
                process_env = os.environ.copy()
                if env['DATABASE_CLIENT'] == 'postgres':
                    process_env['PGPASSWORD'] = env['DATABASE_PASSWORD']
                    cmd = ['pg_dump', '-h', env['DATABASE_HOST'], '-p', env['DATABASE_PORT'], '-U', env['DATABASE_USERNAME'], env['DATABASE_NAME']]
                    marker = b'PostgreSQL database dump complete'
                elif env['DATABASE_CLIENT'] in ['mysql', 'mysql2']:
                    options = Path(directory) / 'mysql.cnf'
                    options.write_text('[client]\n' + ''.join(key + '=' + json.dumps(env['DATABASE_' + field]) + '\n' for key, field in [('host','HOST'),('port','PORT'),('user','USERNAME'),('password','PASSWORD')]))
                    options.chmod(0o600)
                    cmd = ['mysqldump', '--defaults-extra-file=' + str(options), '--single-transaction', '--no-tablespaces', env['DATABASE_NAME']]
                    marker = b'Dump completed'
                else:
                    raise DeploymentError('Unsupported production backup database')
                with open(partial, 'wb') as output, tempfile.TemporaryFile() as errors:
                    process = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=errors, env=process_env)
                    compressor = subprocess.Popen(['gzip', '-1'], stdin=process.stdout, stdout=output, stderr=errors)
                    process.stdout.close()
                    try:
                        compressor.wait(timeout=600)
                        process.wait(timeout=30)
                    finally:
                        for child in [compressor, process]:
                            if child.poll() is None:
                                child.kill()
                                child.wait()
                    if process.returncode or compressor.returncode:
                        raise DeploymentError('Pre-release database backup failed; live CMS unchanged')
                tail = b''
                with gzip.open(partial, 'rb') as source:
                    for chunk in iter(lambda: source.read(1024 * 1024), b''):
                        tail = (tail + chunk)[-4096:]
                if marker not in tail:
                    raise DeploymentError('Database backup is incomplete; live CMS unchanged')
                os.replace(partial, destination)
        finally:
            partial.unlink(missing_ok=True)
        self.log('verified database snapshot for ' + record['releaseId'])
        # Keep two deployment snapshots in addition to the independent daily backups.
        for old in sorted(destination.parent.glob('*.sql.gz'), key=lambda p: p.stat().st_mtime, reverse=True)[2:]:
            old.unlink()

    def backup(self, before, candidate):
        return dict(before=before, candidate=candidate)

    def restore_runtime(self, record):
        info = self.inspect(record['container'])
        if info and not record['releaseId'].startswith('legacy-') and info['Config'].get('Labels', {}).get('com.fanruan.release') != record['releaseId']:
            self.start(record)
        elif info:
            if not info['State']['Running']:
                self.run(['docker', 'start', record['container']])
        elif record['releaseId'].startswith('legacy-'):
            raise DeploymentError('Legacy rollback container unavailable')
        else:
            self.start(record)
        if record['releaseId'].startswith('legacy-'):
            self.legacy_check(record)
        else:
            self.wait_healthy(record)

    def recover(self, transaction):
        before, candidate = transaction['before'], transaction['candidate']
        self.stop(candidate)
        self.restore_runtime(before)
        self.public_check(before)
        save(self.state_file, before)
        self.journal.unlink(missing_ok=True)
        self.log('restored ' + before['releaseId'])

    def activate(self, release):
        before = self.status()
        if before['releaseId'] == release:
            self.public_check(before)
            return before
        candidate = read(self.pending_file)
        if candidate['releaseId'] != release or candidate['basedOn'] != before['releaseId']:
            raise DeploymentError('Release is not staged against the current version')
        self.preflight(candidate)
        self.database_backup(candidate)
        transaction = self.backup(before, candidate)
        save(self.journal, transaction)
        try:
            self.stop(before)
            self.start(candidate)
            self.public_check(candidate)
            backup = self.root / 'backups' / (release + '.json')
            save(backup, transaction)
            result = {**candidate, 'previous': before, 'backup': str(backup)}
            save(self.state_file, result)
            self.journal.unlink()
            self.log('activated ' + release)
            return result
        except BaseException:
            self.recover(transaction)
            raise

    def restore(self, release, target):
        current = self.status()
        if current['releaseId'] == target:
            self.public_check(current)
            return current
        if current['releaseId'] != release or current.get('previous', {}).get('releaseId') != target:
            raise DeploymentError('Only the recorded previous release can be restored')
        previous = current['previous']
        undo = self.backup(current, previous)
        save(self.journal, undo)
        try:
            self.stop(current)
            self.restore_runtime(previous)
            self.public_check(previous)
            save(self.state_file, previous)
            self.journal.unlink()
            self.log('rolled back ' + release + ' to ' + target)
            return previous
        except BaseException:
            self.recover(undo)
            raise


def main():
    os.umask(0o077)
    app = Path(__file__).name.removesuffix('-deploy')
    if os.geteuid() != 0 or app not in ['fanruan-cloud-cms', 'strapi-cms-old']:
        raise DeploymentError('Use the installed root-owned controller')
    if len(sys.argv) != 3 or sys.argv[1] != '--ssh':
        raise DeploymentError('Only restricted SSH commands are accepted')
    config = read('/etc/' + app + '/deploy.json')
    args = validate(sys.argv[2], config['repository'])
    controller = Controller(config)
    with open(controller.root / 'deployment.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        signal.signal(signal.SIGTERM, lambda *_: sys.exit(130))
        signal.signal(signal.SIGHUP, lambda *_: sys.exit(130))
        if controller.journal.exists():
            transaction = read(controller.journal)
            if controller.status()['releaseId'] == transaction['candidate']['releaseId']:
                controller.journal.unlink()
            else:
                controller.recover(transaction)
        try:
            if args[0] == 'stage':
                token = sys.stdin.readline().strip()
                if not token:
                    raise DeploymentError('Missing short-lived registry credential')
                result = controller.stage(*args[1:], token)
            else:
                result = getattr(controller, args[0])(*args[1:])
        except Exception as error:
            controller.log(args[0] + ' failed: ' + (str(error) if isinstance(error, DeploymentError) else type(error).__name__))
            raise
        print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error) if isinstance(error, DeploymentError) else 'Deployment failed; operator inspection required', file=sys.stderr)
        sys.exit(1)
