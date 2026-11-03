'use strict';
const fs = require('node:fs/promises');
const decode = value => typeof value === 'string' ? JSON.parse(value) : value;
// This tool deliberately does not start Strapi, run schema sync/bootstrap, or send mail.
async function migrateGalleryAssets({ database, store, apply = false, onProgress = () => {} }) {
  const result = { apply, scanned: 0, alreadyS3: 0, planned: 0, migrated: 0, failed: 0 };
  let after = 0;
  while (true) {
    const batch = await database('gallery_assets').where('id', '>', after).orderBy('id').limit(100);
    if (!batch.length) break;
    for (const row of batch) {
      result.scanned++;
      try {
        const payload = decode(row.payload);
        if (!payload || payload.key !== row.key || !Number.isSafeInteger(payload.size) || payload.size <= 0) throw new Error('Invalid asset record');
        if (payload.storage?.provider === 's3') { result.alreadyS3++; continue; }
        if (payload.storage?.provider && payload.storage.provider !== 'local') throw new Error('Unknown storage provider');
        const stat = await fs.stat(store.localPath(row.key));
        if (stat.size !== payload.size) throw new Error('Local asset size mismatch');
        result.planned++;
        if (apply) {
          // migrate() verifies the entire remote object before the database points to it.
          const migrated = await store.migrate(row.key, payload);
          await database.transaction(async trx => {
            let query = trx('gallery_assets').where({ id: row.id });
            if (!['sqlite','sqlite3','better-sqlite3'].includes(database.client.config.client)) query = query.forUpdate();
            const current = await query.first();
            if (!current || JSON.stringify(decode(current.payload)) !== JSON.stringify(payload)) throw new Error('Asset changed concurrently; local file retained');
            await trx('gallery_assets').where({ id: row.id }).update({ payload: JSON.stringify(migrated), updated_at: new Date().toISOString() });
          });
          result.migrated++;
        }
        onProgress({ key: row.key, status: apply ? 'migrated' : 'planned' });
      } catch (error) { result.failed++; onProgress({ key: row.key, status: 'failed', error: error.status ? error.message : error.code === 'ENOENT' ? 'Local asset missing' : error.message }); }
    }
    after = batch.at(-1).id;
  }
  return result;
}
module.exports = { migrateGalleryAssets };
