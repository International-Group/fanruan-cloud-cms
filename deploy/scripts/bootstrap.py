#!/usr/bin/env python3
"""One-time operator setup; effective credentials are captured without being printed."""
import argparse
import io
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parents[2]


def checked(args, data=None):
    result = subprocess.run(args, input=data, capture_output=True, timeout=180)
    if result.returncode:
        raise RuntimeError(f'{args[0]} failed ({result.returncode}); output suppressed to protect credentials')
    return result.stdout


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--operator-key', required=True, type=Path)
    parser.add_argument('--private-directory', required=True, type=Path)
    args = parser.parse_args()
    p = json.loads((ROOT / 'deploy/project.json').read_text())
    private = args.private_directory
    private.mkdir(mode=0o700, parents=True, exist_ok=True)
    private.chmod(0o700)

    def ssh(command, data=None):
        return checked(['ssh', '-i', str(args.operator_key), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
                        '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15',
                        p['user'] + '@' + p['host'], command], data)

    def secret(name, value):
        checked(['gh', 'secret', 'set', name, '--repo', p['github']], value.encode())

    def variable(name, value):
        checked(['gh', 'variable', 'set', name, '--repo', p['github'], '--body', value])

    ssh('sudo -n test ! -e ' + shlex.quote(p['runtime'] + '/state.json'))
    variable('DEPLOY_ENABLED', 'false')
    env_script = r'''
const fs = require('fs');
require('dotenv').config({quiet:true});
const skip = new Set(['PATH','HOME','HOSTNAME','NODE_VERSION','YARN_VERSION','PWD','SHLVL','NODE_ENV','PORT','NODE_PORT','HOST','APP_HOST','RELEASE_ID','SOURCE_REVISION']);
const result = {};
for (const [key, value] of Object.entries(process.env)) if (!skip.has(key)) result[key] = value;
const plugins = require('./config/plugins')({env:(key,fallback)=>process.env[key] === undefined ? fallback : process.env[key]});
if (plugins.email?.config?.providerOptions?.auth?.pass) result.SMTP_PASSWORD = plugins.email.config.providerOptions.auth.pass;
for (const entry of plugins['preview-button']?.config?.contentTypes || []) {
  if (entry.uid === 'api::event.event') result.EVENT_PREVIEW_SECRET = entry.draft.query.secret;
  if (entry.uid === 'api::post.post') result.POST_PREVIEW_SECRET = entry.draft.query.secret;
}
process.stdout.write(JSON.stringify(result));
'''
    capture = json.loads(ssh('docker exec -i ' + p['legacy'] + ' node -', env_script.encode()))
    if any(not re.fullmatch(r'[A-Z_][A-Z0-9_]*', key) or not isinstance(value, str) or '\n' in value or '\r' in value for key, value in capture.items()):
        raise RuntimeError('Runtime configuration needs a multiline adapter')
    environment = ''.join(key + '=' + value + '\n' for key, value in sorted(capture.items()))
    inspection = json.loads(ssh('docker inspect ' + p['legacy']))[0]
    schema_script = (ROOT / 'deploy/runtime/preflight.cjs').read_text().split('async function databaseCheck')[0]
    schema_script += "console.log(JSON.stringify({schemaHash:schemaHash(),strapiVersion:require('@strapi/strapi/package.json').version}));"
    baseline = json.loads(ssh('docker exec -i ' + p['legacy'] + ' node -', schema_script.encode()))
    initial = dict(releaseId='legacy-20261015', image=inspection['Image'], container=p['legacy'], port=p['live_port'], **baseline)
    key = private / (p['app'] + '.key')
    if not key.exists():
        checked(['ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', p['app'] + '-github-actions', '-f', str(key)])
    public_key = key.with_suffix('.key.pub').read_text().strip()
    command = f'sudo -n /usr/local/sbin/{p["app"]}-deploy --ssh "$SSH_ORIGINAL_COMMAND"'
    authorized = 'restrict,command="' + command.replace('"', '\\"') + '" ' + public_key + '\n'
    files = {'controller': (ROOT / 'deploy/server/controller.py').read_bytes(),
             'config.json': json.dumps(p).encode(), 'state.json': json.dumps(initial).encode(),
             'app.env': environment.encode(), 'authorized': authorized.encode(),
             'legacy-inspect.json': json.dumps(inspection).encode()}
    payload = io.BytesIO()
    with tarfile.open(fileobj=payload, mode='w:gz') as archive:
        for name, value in files.items():
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(value), 0o600
            archive.addfile(info, io.BytesIO(value))
    runtime, app = shlex.quote(p['runtime']), p['app']
    install = f'''set -eu
umask 077
test ! -e {runtime}/state.json
directory=$(mktemp -d /tmp/{app}-bootstrap.XXXXXX)
trap 'rm -rf "$directory"' EXIT
tar -xzf - -C "$directory"
mkdir -p {runtime}/releases {runtime}/backups {runtime}/database /etc/{app}
chmod 700 {runtime}
install -m 755 "$directory/controller" /usr/local/sbin/{app}-deploy
install -m 600 "$directory/config.json" /etc/{app}/deploy.json
for file in state.json app.env legacy-inspect.json; do install -m 600 "$directory/$file" {runtime}/$file; done
test -d {shlex.quote(p['uploads'])}
mkdir -p /home/ubuntu/.ssh
if ! grep -Fq {shlex.quote(public_key)} /home/ubuntu/.ssh/authorized_keys; then cat "$directory/authorized" >> /home/ubuntu/.ssh/authorized_keys; fi
chmod 600 /home/ubuntu/.ssh/authorized_keys
'''
    ssh('sudo -n bash -c ' + shlex.quote(install), payload.getvalue())
    host_key = ssh('sudo -n cat /etc/ssh/ssh_host_ed25519_key.pub').decode().split()
    secret('DEPLOY_KEY', key.read_text())
    secret('DEPLOY_KNOWN_HOSTS', p['host'] + ' ' + ' '.join(host_key[:2]) + '\n')
    variable('DEPLOY_TARGET', json.dumps(dict(host=p['host'], user=p['user'])))
    print(app + ': restricted controller and secrets installed; live CMS unchanged; deployment disabled')


if __name__ == '__main__':
    main()
