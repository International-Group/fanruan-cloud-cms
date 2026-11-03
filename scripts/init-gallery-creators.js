'use strict';
// Explicit local migration. Never starts an HTTP server or sends notification mail.
(async () => {
  const fs = require('node:fs/promises');
  const path = require('node:path');
  const args = process.argv.slice(2);
  const i = args.indexOf('--sqlite');
  if (!args.includes('--apply') || i < 0 || !args[i + 1]) throw new Error('Usage: node scripts/init-gallery-creators.js --apply --sqlite /absolute/path/database.db');
  const { compileStrapi, createStrapi } = require('@strapi/strapi');
  const app = createStrapi(await compileStrapi());
  try {
    const connection = app.config.get('database.connection');
    if (connection.client !== 'sqlite' || path.resolve(connection.connection.filename) !== path.resolve(args[i + 1])) throw new Error('Expected the explicitly selected local SQLite database');
    const folder = path.resolve('runtime/gallery-backups'); await fs.mkdir(folder, { recursive: true });
    const backup = path.join(folder, `before-creator-operations-${Date.now()}.db`);
    const db = new (require('better-sqlite3'))(connection.connection.filename, { readonly: true });
    try { await db.backup(backup); } finally { db.close(); }
    console.log(`Local database backup: ${backup}`);
    app.config.set('gallery.mail.enabled', false);
    await app.load();
    await app.service('api::gallery.notifications').stop();
    const result = await app.service('api::gallery.creator-operations').initialize({ seedBadges: true });
    console.log(JSON.stringify(result));
  } finally { await app.destroy(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
