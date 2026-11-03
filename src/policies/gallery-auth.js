 'use strict';
const { fail } = require('../api/gallery/utils/validation');
// Account service is the authority. Never decode an unverified JWT or accept CMS API tokens.
module.exports = async (ctx, config, { strapi }) => {
  const authorization = ctx.request.headers.authorization;
  if (!/^Bearer [^\s]+$/i.test(authorization || '') || authorization.length > 8192) fail(401, 'Sign in required');
  const base = strapi.config.get('gallery.accountApiUrl');
  if (!base) fail(503, 'Gallery account verification is not configured');
  let response;
  try {
    response = await fetch(`${base.replace(/\/$/, '')}/user/profile`, { headers: { Authorization: authorization }, redirect: 'error', signal: AbortSignal.timeout(5000) });
  } catch { fail(503, 'Account verification unavailable'); }
  if (response.status === 401 || response.status === 403) fail(401, 'Session expired');
  if (!response.ok) fail(503, 'Account verification unavailable');
  let user;
  try { user = await response.json(); } catch { fail(503, 'Invalid account response'); }
  // Frontend's account /user/profile returns the user object directly.
  const id = user?.uid ?? user?.id;
  if (!['string', 'number'].includes(typeof id) || !String(id).trim() || String(id).length > 200) fail(401, 'Invalid account identity');
  const owner = String(id);
  const canReview = strapi.config.get('gallery.reviewerIds', []).includes(owner);
  if (config.review && !canReview) fail(403, 'Gallery reviewer permission required');
  ctx.state.gallery = { owner, canReview, avatar: typeof user.avatar === 'string' ? user.avatar : '', name: user.name || user.username || '' };
  return true;
};
