const fs = require('node:fs');
const release = JSON.parse(fs.readFileSync('/app/.release.json', 'utf8'));
fetch(`http://127.0.0.1:${process.env.PORT || process.env.NODE_PORT || 1337}/healthz`, { signal: AbortSignal.timeout(5000) })
  .then(async response => {
    const body = await response.json();
    if (!response.ok || body.status !== 'ok' || body.releaseId !== release.releaseId) throw new Error('Not ready');
  }).catch(() => { process.exitCode = 1; });
