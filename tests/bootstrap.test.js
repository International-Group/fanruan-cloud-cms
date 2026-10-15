const test = require('node:test');
const assert = require('node:assert/strict');
const queue = require('../src/api/user-behavior/utils/user-behavior-queue');
const app = require('../src/index');

test('startup starts the queue without importing examples or modifying setup stores', async () => {
  const originalStart = queue.start;
  const previousStrapi = global.strapi;
  const originalEnvironment = process.env.NODE_ENV;
  const runtime = { store() { assert.fail('Server startup must not initialize example data'); } };
  let startedWith;
  queue.start = value => { startedWith = value; };
  global.strapi = runtime;
  process.env.NODE_ENV = 'production';
  try {
    await app.bootstrap({ strapi: runtime });
    assert.equal(startedWith, runtime);
  } finally {
    queue.start = originalStart;
    if (previousStrapi === undefined) delete global.strapi;
    else global.strapi = previousStrapi;
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
  }
});
