#!/usr/bin/env python3
"""Operator-only controller upgrade and append-only admin asset route installation."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]


def nginx_config(original, config):
    marker = '# CMS retained admin assets: ' + config['app']
    if marker in original:
        return original
    if re.search(r'location[^\n{]*/admin', original):
        raise RuntimeError('Review existing admin locations before installation')
    fallback = config['app'].replace('-', '_') + '_admin_asset'
    block = '\n' + rf'''
    {marker}
    location ~ ^/admin/.*\.(?:js|css|woff2?|ttf)$ {{
        root {Path(config['assets']).parent};
        try_files $uri @{fallback};
        expires 1y;
        add_header Cache-Control "public, immutable";
    }}
    location @{fallback} {{
        proxy_pass http://127.0.0.1:{config['live_port']};
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }}
'''
    pattern = r'(server_name\s+' + re.escape(config['domain']) + r'\s*;)'
    result, count = re.subn(pattern, lambda match: match[0] + block, original)
    if count == 0:
        raise RuntimeError('Expected CMS server_name not found')
    return result


def atomic(path, content, mode):
    path = Path(path)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as file:
        temporary = Path(file.name)
        try:
            file.write(content)
            file.flush()
            os.fsync(file.fileno())
            temporary.chmod(mode)
            os.replace(temporary, path)
        finally:
            temporary.unlink(missing_ok=True)


def install(payload):
    os.umask(0o077)
    config = payload['config']
    app = config['app']
    if os.geteuid() != 0 or app not in ['fanruan-cloud-cms', 'strapi-cms-old']:
        raise RuntimeError('Use the root operator installer')
    root = Path(config['runtime'])
    current_config = json.loads(Path('/etc/' + app + '/deploy.json').read_text())
    for key, value in current_config.items():
        if key not in ['assets', 'site'] and config.get(key) != value:
            raise RuntimeError('Refusing unrelated deployment configuration changes')
    namespace = {'__name__': 'controller_asset_install'}
    exec(compile(payload['controller'], '<reviewed-controller>', 'exec'), namespace)
    controller = namespace['Controller'](config)
    with open(root / 'deployment.lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if controller.journal.exists():
            raise RuntimeError('Recover pending deployment before installation')
        state = controller.status()
        records = [state]
        if state.get('previous'):
            records.append(state['previous'])
        legacy_path = root / 'legacy-inspect.json'
        if legacy_path.exists():
            records.append({'image': json.loads(legacy_path.read_text())['Image']})
        seen = set()
        for record in records:
            if record['image'] not in seen:
                controller.publish_assets(record)
                seen.add(record['image'])
        site = Path(config['site']).resolve(strict=True)
        with open('/run/lock/fanruan-release-nginx.lock', 'w') as nginx_lock:
            fcntl.flock(nginx_lock, fcntl.LOCK_EX)
            before = site.read_bytes()
            after = nginx_config(before.decode(), config).encode()
            backup = root / 'nginx-before-assets.conf'
            if not backup.exists():
                atomic(backup, before, 0o600)
            try:
                atomic(site, after, 0o644)
                controller.run(['nginx', '-t'])
                controller.run(['systemctl', 'reload', 'nginx'])
                controller.public_check(state)
            except BaseException:
                atomic(site, before, 0o644)
                controller.run(['nginx', '-t'])
                controller.run(['systemctl', 'reload', 'nginx'])
                raise
        executable = Path('/usr/local/sbin/' + app + '-deploy')
        backup = root / 'controller-before-assets.py'
        if not backup.exists():
            atomic(backup, executable.read_bytes(), 0o600)
        atomic(executable, payload['controller'].encode(), 0o755)
        atomic('/etc/' + app + '/deploy.json', json.dumps(config).encode(), 0o600)
        print(json.dumps({'app': app, 'assetsRetained': len(list(Path(config['assets']).rglob('*'))), 'publicChecks': 'passed', 'cmsRestarted': False}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--operator-key', required=True, type=Path)
    args = parser.parse_args()
    config = json.loads((ROOT / 'deploy/project.json').read_text())
    payload = dict(config=config, controller=(ROOT / 'deploy/server/controller.py').read_text())
    source = Path(__file__).read_text().rsplit("if __name__ == '__main__':", 1)[0]
    source += '\ninstall(' + repr(payload) + ')\n'
    result = subprocess.run(['ssh', '-i', str(args.operator_key), '-o', 'BatchMode=yes', '-o', 'IdentitiesOnly=yes',
                             '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=15',
                             config['user'] + '@' + config['host'], 'sudo -n python3 -'], input=source.encode(), capture_output=True, timeout=300)
    if result.returncode:
        raise RuntimeError('Asset installation failed; inspect private server state before retrying')
    print(result.stdout.decode().strip())


if __name__ == '__main__':
    main()
