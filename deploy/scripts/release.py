#!/usr/bin/env python3
"""Deploy one immutable image through a repository-scoped, forced-command SSH key."""
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PROJECT = json.loads((ROOT / 'deploy/project.json').read_text())
RELEASE = re.compile(r'^[a-f0-9]{40}-[0-9]+-[0-9]+$')


class Remote:
    def __init__(self, directory):
        self.key = Path(directory) / 'key'
        self.known = Path(directory) / 'known_hosts'
        for path, value in [(self.key, os.environ['DEPLOY_KEY']), (self.known, os.environ['DEPLOY_KNOWN_HOSTS'])]:
            path.touch(mode=0o600)
            path.write_text(value.rstrip() + '\n')
        self.target = json.loads(os.environ['DEPLOY_TARGET'])
        if not re.fullmatch(r'[A-Za-z0-9_.-]+', self.target['host']) or not re.fullmatch(r'[a-z_][a-z0-9_-]*', self.target['user']):
            raise ValueError('Invalid deployment target')

    def call(self, command, token=''):
        args = ['ssh', '-i', str(self.key), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
                '-o', 'StrictHostKeyChecking=yes', '-o', f'UserKnownHostsFile={self.known}',
                '-o', 'ConnectTimeout=15', '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=4',
                self.target['user'] + '@' + self.target['host'], command]
        result = subprocess.run(args, input=token + '\n', capture_output=True, text=True, timeout=1500)
        if result.returncode:
            # Never echo remote logs or credentials. Detailed diagnostics stay on the host.
            raise RuntimeError(f'{command.split()[0]} failed (exit {result.returncode}); inspect server deploy.log')
        return json.loads(result.stdout)


def execute(remote, release, image, actor, token, mode):
    before = remote.call('status')
    report = {'releaseId': release, 'state': 'failed', 'before': before}
    attempted = False
    try:
        report['staged'] = remote.call(f'stage {release} {image} {actor}', token)
        if mode == 'stage':
            report['state'] = 'staged'
        else:
            attempted = True
            report['activated'] = remote.call(f'activate {release}')
            report['state'] = 'success'
    except Exception as error:
        report['error'] = str(error)
        if attempted:
            try:
                current = remote.call('status')
                if current['releaseId'] == release and before['releaseId'] != release:
                    report['rollback'] = remote.call(f'restore {release} {before["releaseId"]}')
                elif current['releaseId'] == before['releaseId']:
                    report['rollback'] = {'state': 'previous-version-running'}
                else:
                    report['rollback'] = {'state': 'needs-attention'}
            except Exception:
                report['rollback'] = {'state': 'needs-attention'}
    return report


def main():
    release, digest = os.environ['RELEASE_ID'], os.environ['IMAGE_DIGEST']
    mode = os.environ.get('RELEASE_MODE', 'stage')
    if not RELEASE.fullmatch(release) or not re.fullmatch(r'sha256:[a-f0-9]{64}', digest) or mode not in ['stage', 'deploy']:
        raise SystemExit('Invalid release parameters')
    with tempfile.TemporaryDirectory(prefix='fanruan-release-') as directory:
        report = execute(Remote(directory), release, PROJECT['repository'] + '@' + digest,
                         os.environ['GITHUB_ACTOR'], os.environ['REGISTRY_TOKEN'], mode)
    Path('deployment-result.json').write_text(json.dumps(report, indent=2) + '\n')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
            summary.write(f'Release `{release}`: **{report["state"]}**\n')
    print(report['state'])
    if report['state'] == 'failed':
        raise SystemExit(report.get('error', 'Deployment failed'))


if __name__ == '__main__':
    main()
