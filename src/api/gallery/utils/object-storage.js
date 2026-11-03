'use strict';
const fs = require('node:fs/promises');
const { createReadStream } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { fail } = require('./validation');
const validKey = key => typeof key === 'string' && /^[a-f0-9-]{36}$/.test(key);
function objectStorage(strapi) {
  const cfg = strapi.config.get('gallery');
  const clients = new Map(); const checked = new Map();
  const sdk = () => require('@aws-sdk/client-s3');
  const localPath = key => {
    if (!validKey(key)) fail(404, 'Asset not found');
    const directory = path.resolve(cfg.storageDir);
    const publicDir = path.resolve(strapi.dirs.static.public);
    if (directory === publicDir || directory.startsWith(publicDir + path.sep)) fail(503, 'Gallery storage must be outside the public directory');
    return path.join(directory, key);
  };
  const client = region => {
    if (!clients.has(region)) {
      const options = cfg.s3 || {};
      if (!!options.accessKeyId !== !!options.secretAccessKey) fail(503, 'Gallery S3 credentials are incomplete');
      clients.set(region, new (sdk().S3Client)({ region, maxAttempts: 3,
        ...(options.accessKeyId ? { credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey, ...(options.sessionToken ? { sessionToken: options.sessionToken } : {}) } } : {}) }));
    }
    return clients.get(region);
  };
  const location = key => {
    if (!validKey(key)) fail(404, 'Asset not found');
    const provider = cfg.storageProvider || 'local';
    if (provider === 'local') return { provider: 'local' };
    if (provider !== 's3') fail(503, 'Invalid Gallery storage provider');
    const s3 = cfg.s3 || {}; const prefix = (s3.prefix || 'gallery-private').replace(/\/+$/, '');
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(s3.bucket || '') || !s3.region || !/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,199}$/.test(prefix)) fail(503, 'Configure the Gallery private S3 bucket, region and prefix');
    return { provider: 's3', bucket: s3.bucket, region: s3.region, objectKey: `${prefix}/${key}` };
  };
  const privateBucket = async loc => {
    const identity = `${loc.region}:${loc.bucket}`;
    if ((checked.get(identity) || 0) > Date.now()) return;
    try {
      const result = await client(loc.region).send(new (sdk().GetPublicAccessBlockCommand)({ Bucket: loc.bucket }));
      if (!['BlockPublicAcls','IgnorePublicAcls','BlockPublicPolicy','RestrictPublicBuckets'].every(key => result.PublicAccessBlockConfiguration?.[key] === true)) throw new Error('Not private');
      checked.set(identity, Date.now() + 5 * 60 * 1000);
    } catch { fail(503, 'Gallery requires a private S3 bucket with all Block Public Access settings enabled and s3:GetBucketPublicAccessBlock permission'); }
  };
  const readLocation = (key, asset) => {
    if (!validKey(key)) fail(404, 'Asset not found');
    const loc = asset?.storage || { provider: 'local' }; // Legacy rows always remain local until explicitly migrated.
    if (loc.provider === 's3' && (!loc.bucket || !loc.region || typeof loc.objectKey !== 'string' || !loc.objectKey.endsWith(`/${key}`))) fail(503, 'Invalid Gallery S3 asset location');
    if (!['local','s3'].includes(loc.provider)) fail(503, 'Invalid Gallery asset storage');
    return loc;
  };
  const remove = async (key, asset) => {
    const loc = readLocation(key, asset);
    if (loc.provider === 'local') return fs.rm(localPath(key), { force: true });
    await client(loc.region).send(new (sdk().DeleteObjectCommand)({ Bucket: loc.bucket, Key: loc.objectKey }));
  };
  const put = async (key, source, asset) => {
    const loc = location(key);
    if (loc.provider === 'local') {
      const destination = localPath(key);
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      let copied = false;
      try {
        await fs.copyFile(source, destination, require('node:fs').constants.COPYFILE_EXCL); copied = true;
        await fs.chmod(destination, 0o600);
        return loc;
      } catch (error) { if (copied) await fs.rm(destination, { force: true }); throw error; }
    }
    await privateBucket(loc);
    const body = createReadStream(source);
    try {
      // Deliberately do not inherit the media library's public-read ACL or CDN URL.
      await client(loc.region).send(new (sdk().PutObjectCommand)({ Bucket: loc.bucket, Key: loc.objectKey,
        Body: body, ContentLength: asset.size, ContentType: asset.mime, CacheControl: 'private, no-store',
        ...(asset.sha256 ? { ChecksumSHA256: Buffer.from(asset.sha256, 'hex').toString('base64'), Metadata: { 'gallery-sha256': asset.sha256 } } : {}) }));
      return loc;
    } catch {
      // The server may have committed an object whose response was lost.
      try { await remove(key, { storage: loc }); } catch { strapi.log.warn('[Gallery storage] Unreferenced S3 object cleanup failed'); }
      fail(503, 'Gallery S3 upload unavailable');
    } finally { body.destroy(); }
  };
  const open = async (key, asset) => {
    const loc = readLocation(key, asset);
    if (loc.provider === 'local') {
      const filename = localPath(key);
      try { await fs.access(filename); } catch { fail(404, 'Asset not found'); }
      return createReadStream(filename);
    }
    try {
      const result = await client(loc.region).send(new (sdk().GetObjectCommand)({ Bucket: loc.bucket, Key: loc.objectKey }));
      if (!result.Body || typeof result.Body.pipe !== 'function') throw new Error('Missing stream');
      return result.Body;
    } catch (error) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) fail(404, 'Asset not found');
      fail(503, 'Gallery S3 read unavailable');
    }
  };
  return { location, localPath, put, open, remove,
    async migrate(key, asset) {
      if (asset.storage?.provider === 's3') return asset;
      if (location(key).provider !== 's3') fail(503, 'Select S3 storage before migration');
      const filename = localPath(key); const stat = await fs.stat(filename);
      if (stat.size !== asset.size) fail(422, 'Local asset size does not match its record');
      const h = createHash('sha256'); for await (const part of createReadStream(filename)) h.update(part);
      const sha256 = h.digest('hex');
      if (asset.sha256 && asset.sha256 !== sha256) fail(422, 'Local asset checksum mismatch; original file retained');
      const storage = await put(key, filename, { ...asset, sha256 });
      const migrated = { ...asset, storage, sha256 };
      const stream = await open(key, migrated); const verify = createHash('sha256'); let bytes = 0;
      for await (const part of stream) { verify.update(part); bytes += part.length; }
      if (bytes !== stat.size || verify.digest('hex') !== sha256) fail(503, 'S3 migration verification failed; local asset retained');
      return migrated;
    },
  };
}
module.exports = { objectStorage };
