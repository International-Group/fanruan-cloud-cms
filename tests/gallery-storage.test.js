'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const sharp = require('sharp');
const { randomUUID } = require('node:crypto');
const { storage } = require('../src/api/gallery/utils/storage');
const { migrateGalleryAssets } = require('../src/api/gallery/utils/migrate-storage');
async function fixture(t) {
  const remote = require('./helpers/gallery-s3')(t);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-s3-unit-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const cfg = { storageProvider: 's3', storageDir: path.join(root, 'private'), publicUrl: 'https://cms.example/api', signingSecret: 'test-secret-that-is-longer-than-32-characters', signedUrlSeconds: 900,
    s3: { bucket: 'gallery-private-test', region: 'test-region-1', prefix: 'gallery-private', accessKeyId: 'test-key', secretAccessKey: 'test-secret' } };
  const strapi = { config: { get: () => cfg }, dirs: { static: { public: path.join(root, 'public') } }, log: { warn() {} } };
  const file = path.join(root, 'cover.png');
  await sharp({ create: { width: 12, height: 8, channels: 3, background: '#2266cc' } }).png().toFile(file);
  return { remote, root, cfg, store: storage(strapi), file: { filepath: file, originalFilename: 'cover.png' } };
}
async function contents(stream) { const chunks = []; for await (const part of stream) chunks.push(part); return Buffer.concat(chunks); }

test('S3 Gallery assets are privately stored, streamed through unchanged signed URLs, and deletable', async t => {
  const f = await fixture(t); const asset = await f.store.write(f.file, 'cover');
  assert.equal(asset.storage.provider, 's3'); assert.equal(asset.mime, 'image/webp');
  assert.ok(asset.sha256); assert.equal((await contents(await f.store.open(asset.key, asset))).length, asset.size);
  const url = new URL(f.store.url(asset.key)); assert.equal(url.hostname, 'cms.example');
  assert.equal(f.store.verify(asset.key, url.searchParams.get('expires'), url.searchParams.get('signature')), true);
  await assert.rejects(fs.stat(path.join(f.cfg.storageDir, asset.key)), { code: 'ENOENT' });
  await f.store.remove(asset.key, asset); assert.equal(f.remote.objects.size, 0);
  await assert.rejects(f.store.open(asset.key, asset), e => e.status === 404);
});
test('public bucket settings and invalid S3 configuration fail before uploading any file bytes', async t => {
  const f = await fixture(t); f.remote.private = false;
  await assert.rejects(f.store.write(f.file, 'cover'), e => e.status === 503 && /private S3 bucket/.test(e.message));
  assert.equal(f.remote.objects.size, 0); assert.equal(f.remote.calls.some(c => c.action === 'PutObjectCommand'), false);
  f.cfg.s3.bucket = ''; await assert.rejects(f.store.write(f.file, 'cover'), e => e.status === 503);
});
test('S3 upload failures after remote commit remove the unreferenced object without exposing provider details', async t => {
  const f = await fixture(t); f.remote.failPut = true;
  await assert.rejects(f.store.write(f.file, 'cover'), e => e.status === 503 && !e.message.includes('credentials detail'));
  assert.equal(f.remote.objects.size, 0);
});
test('S3 mode still reads legacy local files until migration and never guesses their location from current config', async t => {
  const f = await fixture(t); const key = randomUUID();
  await fs.mkdir(f.cfg.storageDir); await fs.writeFile(f.store.localPath(key), 'legacy');
  assert.equal((await contents(await f.store.open(key, { size: 6 }))).toString(), 'legacy');
  assert.equal(f.remote.calls.length, 0);
  await assert.rejects(f.store.open('../etc/passwd', {}), e => e.status === 404);
});
test('migration dry-run never writes S3 or database; apply verifies bytes, retains local files, and is repeatable', async t => {
  const f = await fixture(t); const key = randomUUID(); const filename = f.store.localPath(key);
  await fs.mkdir(f.cfg.storageDir); await fs.writeFile(filename, 'migrate this asset');
  const payload = { key, name: 'template.mbi', size: 18, mime: 'application/octet-stream', ext: '.mbi' };
  const db = require('knex')({ client: 'better-sqlite3', connection: { filename: path.join(f.root, 'test.db') }, useNullAsDefault: true });
  t.after(() => db.destroy());
  await db.schema.createTable('gallery_assets', table => { table.increments('id'); table.string('key'); table.text('payload'); table.timestamp('updated_at'); });
  await db('gallery_assets').insert({ key, payload: JSON.stringify(payload) });
  const plan = await migrateGalleryAssets({ database: db, store: f.store });
  assert.equal(plan.planned, 1); assert.equal(plan.migrated, 0); assert.equal(plan.failed, 0); assert.equal(f.remote.calls.length, 0);
  assert.equal(JSON.parse((await db('gallery_assets').first()).payload).storage, undefined);
  f.remote.corruptGet = true;
  const rejected = await migrateGalleryAssets({ database: db, store: f.store, apply: true });
  assert.equal(rejected.failed, 1); assert.equal(JSON.parse((await db('gallery_assets').first()).payload).storage, undefined);
  f.remote.corruptGet = false;
  const applied = await migrateGalleryAssets({ database: db, store: f.store, apply: true });
  assert.equal(applied.migrated, 1); assert.equal(applied.failed, 0);
  const migrated = JSON.parse((await db('gallery_assets').first()).payload);
  assert.equal(migrated.storage.provider, 's3'); assert.equal((await fs.readFile(filename)).toString(), 'migrate this asset');
  assert.equal((await contents(await f.store.open(key, migrated))).toString(), 'migrate this asset');
  assert.equal((await migrateGalleryAssets({ database: db, store: f.store, apply: true })).alreadyS3, 1);
});

test('migration CLI dry-run loads configuration only, without bootstrap, schema changes, emails or AWS writes', { timeout: 30000 }, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gallery-s3-cli-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const filename = path.join(root, 'test.db'); const privateDir = path.join(root, 'private'); const key = randomUUID();
  await fs.mkdir(privateDir); await fs.mkdir(path.join(root, 'config')); await fs.mkdir(path.join(root, 'src'));
  await fs.writeFile(path.join(privateDir, key), 'legacy');
  await fs.symlink(path.resolve(__dirname, '../node_modules'), path.join(root, 'node_modules'), 'dir');
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'gallery-migration-cli-test', version: '1.0.0' }));
  await fs.writeFile(path.join(root, 'config/database.js'), `module.exports=()=>({connection:{client:'sqlite',connection:{filename:${JSON.stringify(filename)}},useNullAsDefault:true}});`);
  await fs.writeFile(path.join(root, 'config/gallery.js'), `module.exports=()=>({storageProvider:'s3',storageDir:${JSON.stringify(privateDir)},s3:{bucket:'gallery-private-test',region:'test-region-1'}});`);
  const marker = path.join(root, 'bootstrap-should-never-run');
  await fs.writeFile(path.join(root, 'src/index.js'), `module.exports={bootstrap(){require('node:fs').writeFileSync(${JSON.stringify(marker)},'bad');throw Error('bootstrap not permitted')}};`);
  const db = require('knex')({ client: 'better-sqlite3', connection: { filename }, useNullAsDefault: true });
  await db.schema.createTable('gallery_assets', table => { table.increments('id'); table.string('key'); table.text('payload'); table.timestamp('updated_at'); });
  await db('gallery_assets').insert({ key, payload: JSON.stringify({ key, size: 6, name: 'legacy.mbi' }) }); await db.destroy();
  const before = await fs.readFile(filename);
  const run = require('node:util').promisify(require('node:child_process').execFile);
  const result = await run(process.execPath, [path.resolve(__dirname, '../scripts/migrate-gallery-assets-to-s3.js'), '--dry-run'], {
    cwd: root, env: { ...process.env, ENV_PATH: path.join(root, 'absent-env'), NODE_ENV: 'test', STRAPI_TELEMETRY_DISABLED: 'true' },
  });
  const summary = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(summary.apply, false); assert.equal(summary.planned, 1); assert.equal(summary.failed, 0);
  assert.deepEqual(await fs.readFile(filename), before);
  await assert.rejects(fs.access(marker), { code: 'ENOENT' });
});
