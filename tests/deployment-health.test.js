const test = require('node:test');
const assert = require('node:assert/strict');
const health = require('../src/middlewares/release-health');

function context(path = '/healthz') { return { path, headers: {}, set(key, value) { this.headers[key] = value; } }; }

test('release readiness requires a successful database query', async () => {
  let query;
  const middleware = health({}, { strapi: { db: { connection: { async raw(sql) { query = sql; } } } } });
  const ctx = context();
  await middleware(ctx, () => assert.fail('Health request reached application'));
  assert.equal(query, 'SELECT 1');
  assert.equal(ctx.status, 200);
  assert.equal(ctx.body.status, 'ok');
  assert.equal(ctx.headers['Cache-Control'], 'no-store');
});

test('database errors return 503 without leaking connection details', async () => {
  const middleware = health({}, { strapi: { db: { connection: { async raw() { throw new Error('private-database-password'); } } } } });
  const ctx = context();
  await middleware(ctx, () => {});
  assert.equal(ctx.status, 503);
  assert.equal(ctx.body.status, 'unavailable');
  assert.ok(!JSON.stringify(ctx.body).includes('private-database-password'));
});

test('CMS content and admin routes pass through unchanged', async () => {
  const middleware = health({}, { strapi: {} });
  let called = false;
  await middleware(context('/admin'), () => { called = true; });
  assert.equal(called, true);
});
