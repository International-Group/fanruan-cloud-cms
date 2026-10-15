'use strict';
const fs = require('node:fs');
const path = require('node:path');

module.exports = (_config, { strapi }) => {
  const file = path.join(process.cwd(), '.release.json');
  const release = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : { releaseId: 'development', revision: 'development' };
  return async (ctx, next) => {
    if (ctx.path !== '/healthz') return next();
    ctx.set('Cache-Control', 'no-store');
    let timer;
    try {
      await Promise.race([
        strapi.db.connection.raw('SELECT 1'),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Database timeout')), 3000); }),
      ]);
      ctx.status = 200;
      ctx.body = { status: 'ok', ...release };
    } catch {
      ctx.status = 503;
      ctx.body = { status: 'unavailable', ...release };
    } finally { clearTimeout(timer); }
  };
};
