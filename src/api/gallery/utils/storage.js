 'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHmac, timingSafeEqual, createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const { fail } = require('./validation');
const sharp = require('sharp');
const formats = { FineBI: ['.mbi', '.zip'], FineReport: ['.cpt', '.cptx', '.frmx', '.zip'], FineVis: ['.mfvs', '.fvs', '.zip'], FineDataLink: ['.zip'] };
const hashFile = async file => { const h = createHash('sha256'); for await (const data of createReadStream(file.filepath)) h.update(data); return h.digest('hex'); };
// Validate the ZIP central directory without extracting or executing user content.
async function validateZip(filename, size) {
  const file = await fs.open(filename, 'r');
  try {
    const tail = Buffer.alloc(Math.min(size, 65557));
    await file.read(tail, 0, tail.length, size - tail.length);
    let end = -1;
    for (let i = tail.length - 22; i >= 0; i--) {
      if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
    }
    if (end < 0) fail(422, 'Invalid ZIP directory');
    const count = tail.readUInt16LE(end + 10), bytes = tail.readUInt32LE(end + 12), offset = tail.readUInt32LE(end + 16);
    if (!count || count > 10000 || bytes > 8 * 1024 * 1024 || offset + bytes !== size - tail.length + end || tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count) fail(422, 'Unsupported ZIP container');
    const central = Buffer.alloc(bytes); await file.read(central, 0, bytes, offset);
    let pos = 0, expanded = 0;
    for (let i = 0; i < count; i++) {
      if (pos + 46 > bytes || central.readUInt32LE(pos) !== 0x02014b50) fail(422, 'Invalid ZIP entry');
      const flags = central.readUInt16LE(pos + 8), method = central.readUInt16LE(pos + 10);
      const nameLen = central.readUInt16LE(pos + 28), extraLen = central.readUInt16LE(pos + 30), commentLen = central.readUInt16LE(pos + 32);
      const next = pos + 46 + nameLen + extraLen + commentLen;
      const entryName = central.subarray(pos + 46, pos + 46 + nameLen).toString('utf8');
      expanded += central.readUInt32LE(pos + 24);
      if (next > bytes || flags & 1 || ![0, 8].includes(method) || expanded > 500 * 1024 * 1024 || central.readUInt32LE(pos + 42) >= offset || entryName.startsWith('/') || entryName.includes('\\') || entryName.split('/').includes('..')) fail(422, 'Unsafe or oversized ZIP entry');
      pos = next;
    }
    if (pos !== bytes) fail(422, 'Invalid ZIP directory length');
  } finally { await file.close(); }
}
function storage(strapi) {
  const cfg = strapi.config.get('gallery');
  const base = () => {
    if (!cfg.publicUrl || !cfg.signingSecret || cfg.signingSecret.length < 32) fail(503, 'Gallery URL and asset secret must be configured');
    const publicDir = path.resolve(strapi.dirs.static.public);
    const storageDir = path.resolve(cfg.storageDir);
    if (storageDir === publicDir || storageDir.startsWith(publicDir + path.sep)) fail(503, 'Gallery storage must be outside the public directory');
    const url = new URL(cfg.publicUrl);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) fail(503, 'Gallery public URL must use HTTPS');
    return cfg.publicUrl.replace(/\/$/, '');
  };
  const filePath = key => { if (!/^[a-f0-9-]{36}$/.test(key)) fail(404, 'Asset not found'); return path.join(path.resolve(cfg.storageDir), key); };
  const sign = (key, expires) => createHmac('sha256', cfg.signingSecret).update(`${key}:${expires}`).digest('hex');
  return {
    base,
    url(key, temporary = true) { const url = `${base()}/gallery/assets/${key}`; if (!temporary) return url; const exp = Math.floor(Date.now() / 1000) + cfg.signedUrlSeconds; return `${url}?expires=${exp}&signature=${sign(key, exp)}`; },
    verify(key, expires, signature) {
      if (!cfg.signingSecret || !/^\d{10}$/.test(String(expires)) || Number(expires) < Date.now() / 1000 || Number(expires) > Date.now() / 1000 + cfg.signedUrlSeconds + 5 || !/^[a-f0-9]{64}$/.test(signature || '')) return false;
      return timingSafeEqual(Buffer.from(sign(key, expires)), Buffer.from(signature));
    },
    filePath,
    async remove(key) { await fs.rm(filePath(key), { force: true }); },
    async write(file, kind, product) {
      base();
      if (!file || Array.isArray(file) || typeof file.filepath !== 'string') fail(422, 'One file is required');
      const stat = await fs.stat(file.filepath);
      if (!stat.size || stat.size > (kind === 'template' ? 100 : 5) * 1024 * 1024) fail(422, 'File exceeds size limit');
      const name = path.basename(file.originalFilename || file.name || 'file').replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200);
      const ext = path.extname(name).toLowerCase();
      const key = randomUUID(); const destination = filePath(key);
      await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      let mime;
      try {
        if (kind === 'template') {
          if (!(formats[product] || []).includes(ext)) fail(422, 'File extension does not match product');
          // Packaged FineBI/FineVis formats are ZIP containers. Legacy CPT/FRMX are XML.
          const handle = await fs.open(file.filepath, 'r');
          const head = Buffer.alloc(4096); let length;
          try { ({ bytesRead: length } = await handle.read(head, 0, head.length, 0)); } finally { await handle.close(); }
          const zip = head.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]));
          const xml = /^\s*(?:<\?xml\b|<[A-Za-z][\w:.-]*(?:\s|>))/.test(head.subarray(0, length).toString('utf8').replace(/^\uFEFF/, ''));
          if (['.cpt', '.frmx'].includes(ext) ? !(xml || zip) : !zip) fail(422, 'Template content does not match file format');
          if (zip) await validateZip(file.filepath, stat.size);
          mime = 'application/octet-stream';
          await fs.copyFile(file.filepath, destination, require('node:fs').constants.COPYFILE_EXCL);
        } else {
          if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) fail(422, 'Use PNG, JPEG or WebP');
          const image = sharp(file.filepath, { limitInputPixels: 40000000 });
          const metadata = await image.metadata();
          if (!['png', 'jpeg', 'webp'].includes(metadata.format) || metadata.pages > 1) fail(422, 'Invalid image content');
          // Decode/re-encode to strip metadata and reject disguised SVG/HTML/polyglots.
          await image.rotate().webp({ quality: 90 }).toFile(destination);
          mime = 'image/webp';
        }
        await fs.chmod(destination, 0o600);
        const dimensions = mime.startsWith('image/') ? await sharp(destination).metadata() : {};
        return { key, name, width: dimensions.width, height: dimensions.height, size: (await fs.stat(destination)).size, mime, ext: kind === 'template' ? ext : '.webp' };
      } catch (e) { await fs.rm(destination, { force: true }); if (e.status) throw e; fail(422, 'Invalid or unreadable file'); }
    },
  };
}
module.exports = { storage, hashFile };
