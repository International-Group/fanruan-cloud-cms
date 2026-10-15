#!/usr/bin/env python3
import json
import os
from pathlib import Path
import tempfile
from release import Remote, RELEASE


def main():
    release = os.environ['ROLLBACK_RELEASE']
    if not RELEASE.fullmatch(release):
        raise SystemExit('Invalid current release ID')
    report = {'releaseId': release, 'state': 'failed'}
    try:
        with tempfile.TemporaryDirectory(prefix='fanruan-rollback-') as directory:
            remote = Remote(directory)
            current = remote.call('status')
            if current['releaseId'] != release or not current.get('previous'):
                raise RuntimeError('Selected release is not current, or has no rollback version')
            report['restored'] = remote.call(f'restore {release} {current["previous"]["releaseId"]}')
            report['state'] = 'success'
    except Exception as error:
        report['error'] = str(error)
    Path('rollback-result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(report['state'])
    if report['state'] != 'success':
        raise SystemExit(report['error'])


if __name__ == '__main__':
    main()
