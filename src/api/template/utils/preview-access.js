'use strict';

const { timingSafeEqual } = require('node:crypto');

const isDraftPreviewAuthorized = (ctx, secret = process.env.PREVIEW_SECRET) => {
  if (ctx.query.status !== 'draft') return true;
  if (!secret || ctx.state.auth?.strategy?.name !== 'api-token') return false;
  const candidate = Buffer.from(ctx.get('x-template-preview-secret') || '');
  const expected = Buffer.from(secret);
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
};

module.exports = { isDraftPreviewAuthorized };
