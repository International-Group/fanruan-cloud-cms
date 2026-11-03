'use strict';
const { fail } = require('../utils/validation');
const body = ctx => {
  const value = ctx.request.body;
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(422, 'An object body is required');
  return value;
};
const actor = ctx => ({ ...ctx.state.gallery, canReview: ctx.path.startsWith('/api/admin/gallery/') && ctx.state.gallery.canReview });
const escapeHTML = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const wrap = fn => async ctx => {
  ctx.set('Cache-Control', 'private, no-store');
  try {
    const result = await fn(ctx, strapi.service('api::gallery.gallery'));
    if (result !== undefined) ctx.body = { data: result };
  } catch (error) {
    if (error.status) ctx.throw(error.status, error.expose ? error.message : 'Gallery request failed');
    throw error;
  }
};
module.exports = {
  me: wrap((ctx, s) => s.me(ctx.state.gallery)),
  profile: wrap((ctx, s) => s.profile(actor(ctx))),
  saveProfile: wrap((ctx, s) => s.saveProfile(actor(ctx), body(ctx))),
  avatar: wrap(() => fail(410, 'Profile photos are managed in account settings')),
  banner: wrap((ctx, s) => s.profileUpload(actor(ctx), 'banner', ctx.request.files?.file, ctx.get('Idempotency-Key'))),
  portfolio: wrap((ctx, s) => s.portfolio(ctx.params.handle, ctx.query)),
  list: wrap((ctx, s) => s.list(actor(ctx), ctx.query)),
  detail: wrap((ctx, s) => s.detail(actor(ctx), ctx.params.id)),
  versions: wrap((ctx, s) => s.versions(actor(ctx), ctx.params.id, ctx.query)),
  version: wrap((ctx, s) => s.version(actor(ctx), ctx.params.id, ctx.params.versionId)),
  create: wrap(async (ctx, s) => { const result = await s.create(actor(ctx), body(ctx), ctx.get('Idempotency-Key')); ctx.status = 201; return result; }),
  update: wrap((ctx, s) => s.update(actor(ctx), ctx.params.id, body(ctx))),
  remove: wrap(async (ctx, s) => { await s.remove(actor(ctx), ctx.params.id, body(ctx)); ctx.status = 204; }),
  upload: wrap((ctx, s) => s.upload(actor(ctx), ctx.params.id, body(ctx), ctx.request.files?.file, ctx.get('Idempotency-Key'))),
  removeAsset: wrap((ctx, s) => s.removeAsset(actor(ctx), ctx.params.id, ctx.params.assetId, body(ctx))),
  submit: wrap((ctx, s) => s.submit(actor(ctx), ctx.params.id, body(ctx), ctx.get('Idempotency-Key'))),
  withdraw: wrap((ctx, s) => s.withdraw(actor(ctx), ctx.params.id, body(ctx))),
  emailStatus: wrap((ctx, s) => s.emailStatus(actor(ctx), ctx.params.id)),
  retryEmail: wrap((ctx, s) => s.retryEmail(actor(ctx), ctx.params.id)),
  review: wrap((ctx, s) => s.review(actor(ctx), ctx.params.id, body(ctx), ctx.get('Idempotency-Key'))),
  newRevision: wrap((ctx, s) => s.newRevision(actor(ctx), ctx.params.id)),
  updateRenderLink: wrap((ctx, s) => s.updateRenderLink(actor(ctx), ctx.params.id, body(ctx))),
  unpublish: wrap((ctx, s) => s.visibility(actor(ctx), ctx.params.id, body(ctx), false)),
  republish: wrap((ctx, s) => s.visibility(actor(ctx), ctx.params.id, body(ctx), true)),
  asset: wrap(async (ctx, s) => {
    const file = await s.readableAsset(ctx.params.key, ctx.query.expires, ctx.query.signature);
    const stream = await s.store.open(ctx.params.key, file);
    ctx.type = file.mime;
    ctx.set('X-Content-Type-Options', 'nosniff');
    ctx.set('Content-Security-Policy', "default-src 'none'; sandbox");
    ctx.set('Content-Length', String(file.size));
    ctx.set('Content-Disposition', `${file.mime.startsWith('image/') ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.name)}`);
    ctx.body = stream;
  }),
  preview: wrap(async (ctx, s) => {
    const work = await s.publicWork(ctx.params.key);
    if (!work) ctx.throw(404, 'Work not found');
    const row = await strapi.db.query('api::gallery-submission.gallery-submission').findOne({ where: { key: work.currentSubmission } });
    const images = row.payload.assets.filter(a => ['cover', 'screenshot'].includes(a.kind));
    ctx.type = 'html';
    ctx.remove('X-Frame-Options');
    ctx.set('Content-Security-Policy', `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox`);
    ctx.body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHTML(row.payload.title)}</title><style>body{margin:0;background:#f4f5f7;font:16px system-ui;text-align:center}img{max-width:100%;height:auto;display:block;margin:0 auto 16px}p{padding:16px}</style></head><body><p>Gallery image preview</p>${images.map(a => `<img alt="${escapeHTML(row.payload.title)}" src="${escapeHTML(s.store.url(a.id, false))}">`).join('')}</body></html>`;
  }),
};
