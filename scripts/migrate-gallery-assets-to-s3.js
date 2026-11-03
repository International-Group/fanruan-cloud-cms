'use strict';
(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Plan: node scripts/migrate-gallery-assets-to-s3.js --dry-run\nApply after backup: node scripts/migrate-gallery-assets-to-s3.js --apply --bucket PRIVATE_BUCKET\nConfigure GALLERY_STORAGE_PROVIDER=s3 and GALLERY_S3_BUCKET. Local files are never deleted.'); return;
  }
  const apply = args.includes('--apply');
  const bucket = args[args.indexOf('--bucket') + 1];
  if ((apply && args.includes('--dry-run')) || args.some((arg, i) => !['--apply','--dry-run','--bucket'].includes(arg) && args[i - 1] !== '--bucket')) throw new Error('Invalid migration arguments; use --help');
  const { compileStrapi, createStrapi } = require('@strapi/strapi');
  // Construct config only: app.load()/start() are intentionally never called.
  const app = createStrapi(await compileStrapi());
  const cfg = app.config.get('gallery');
  if (cfg.storageProvider !== 's3') throw new Error('Set GALLERY_STORAGE_PROVIDER=s3 before planning migration');
  if (apply && (!args.includes('--bucket') || bucket !== cfg.s3.bucket)) throw new Error('--bucket must exactly match GALLERY_S3_BUCKET');
  const connection = app.config.get('database.connection');
  const database = require('knex')({ ...connection, client: connection.client === 'sqlite' ? 'better-sqlite3' : connection.client, pool: { min: 0, max: 1 } });
  try {
    const { storage } = require('../src/api/gallery/utils/storage');
    const { migrateGalleryAssets } = require('../src/api/gallery/utils/migrate-storage');
    const result = await migrateGalleryAssets({ database, store: storage(app), apply, onProgress: event => console.log(JSON.stringify(event)) });
    console.log(JSON.stringify(result)); if (result.failed) process.exitCode = 1;
  } finally { await database.destroy(); }
})().catch(() => { console.error('Gallery S3 migration failed. Check configuration, database access and private bucket permissions. No local files were deleted.'); process.exitCode = 1; });
