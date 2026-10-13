'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { isDraftPreviewAuthorized } = require('../src/api/template/utils/preview-access');
const adminConfig = require('../config/admin');

test('preview is disabled until the frontend URL and secret are configured', () => {
  const env = (_, fallback) => fallback;
  env.bool = (_, fallback) => fallback;
  assert.equal(adminConfig({ env }).preview.enabled, false);
});

test('template preview URL preserves ID and status without needing a published slug', async () => {
  const values = { CLIENT_URL: 'https://gallery.fanruan.com', PREVIEW_SECRET: 'test-secret' };
  const env = (key, fallback) => values[key] ?? fallback;
  env.bool = (_, fallback) => fallback;
  const config = adminConfig({ env }).preview;
  assert.equal(config.enabled, true);
  const url = new URL(await config.config.handler('api::template.template', { documentId: 'draft123', status: 'draft' }));
  assert.equal(url.pathname, '/api/preview');
  assert.equal(url.searchParams.get('documentId'), 'draft123');
  assert.equal(url.searchParams.get('status'), 'draft');
  assert.equal(url.searchParams.get('view'), 'gallery');
  assert.equal(await config.config.handler('api::article.article', { documentId: 'other' }), null);
});

test('published content remains readable, but drafts require both API token authentication and preview secret', () => {
  const ctx = { query: {}, state: {}, get: () => '' };
  assert.equal(isDraftPreviewAuthorized(ctx), true);
  ctx.query.status = 'draft';
  assert.equal(isDraftPreviewAuthorized(ctx, 'test-secret'), false);
  ctx.state.auth = { strategy: { name: 'api-token' } };
  assert.equal(isDraftPreviewAuthorized(ctx, 'test-secret'), false);
  ctx.get = () => 'test-secret';
  assert.equal(isDraftPreviewAuthorized(ctx, 'test-secret'), true);
  assert.equal(isDraftPreviewAuthorized(ctx, 'different-secret'), false);
  assert.equal(isDraftPreviewAuthorized(ctx, ''), false);
  ctx.state.auth.strategy.name = 'users-permissions';
  assert.equal(isDraftPreviewAuthorized(ctx, 'test-secret'), false);
});
