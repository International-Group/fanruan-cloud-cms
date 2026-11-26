const test = require('node:test');
const assert = require('node:assert/strict');
const queue = require('../src/api/user-behavior/utils/user-behavior-queue');
const app = require('../src/index');
const initializeDoraLibrary = require('../src/api/dora-scenario/utils/initialize');

test('startup starts the queue without importing examples or modifying setup stores', async () => {
  const originalStart = queue.start;
  const previousStrapi = global.strapi;
  const originalEnvironment = process.env.NODE_ENV;
  let mailStarted = false;
  let authorsInitialized = false;
  let versionsInitialized = false;
  const services = {
    'api::gallery.creator-operations': { async initialize() { authorsInitialized = true; } },
    'api::gallery.versions': { async initialize() { versionsInitialized = true; } },
    'api::gallery.notifications': { start() { mailStarted = true; } },
  };
  const runtime = {
    db: { transaction: callback => callback() },
    plugin: () => ({ service: () => ({ getDefaultLocale: async () => 'en', find: async () => [{ code: 'en' }] }) }),
    service(uid) {
      assert.ok(Object.hasOwn(services, uid), `Unexpected startup service ${uid}`);
      return services[uid];
    },
    store(options) {
      assert.deepEqual(options, { type: 'core', name: 'dora-library' });
      return { get: async ({ key }) => ({ initialized: true, localized_locales: ['en'] })[key] };
    },
  };
  let startedWith;
  queue.start = value => { startedWith = value; };
  global.strapi = runtime;
  process.env.NODE_ENV = 'production';
  try {
    await app.bootstrap({ strapi: runtime });
    assert.equal(startedWith, runtime);
    assert.equal(mailStarted, true);
    assert.equal(authorsInitialized, true);
    assert.equal(versionsInitialized, true);
  } finally {
    queue.start = originalStart;
    if (previousStrapi === undefined) delete global.strapi;
    else global.strapi = previousStrapi;
    if (originalEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnvironment;
  }
});

test('Dora localizes starter categories without replacing documents or editorial changes', async () => {
  const industry = 'api::dora-industry.dora-industry';
  const saved = { initialized: true };
  const updates = [];
  const runtime = {
    db: { transaction: callback => callback() },
    plugin: () => ({ service: () => ({
      getDefaultLocale: async () => 'en',
      find: async () => [{ code: 'en' }, { code: 'zh-Hant-TW' }],
    }) }),
    store: () => ({
      get: async ({ key }) => saved[key],
      set: async ({ key, value }) => { saved[key] = value; },
    }),
    documents: uid => ({
      async findMany({ locale }) {
        if (uid !== industry) return [];
        if (locale === 'en') return [
          { documentId: 'manufacturing-doc', slug: 'manufacturing', name: '大制造' },
          { documentId: 'finance-doc', slug: 'finance', name: 'Banking and Insurance' },
        ];
        return [{ documentId: 'finance-doc', slug: 'finance', name: '銀行與保險' }];
      },
      async update(params) { updates.push({ uid, ...params }); },
    }),
  };

  await initializeDoraLibrary(runtime);
  await initializeDoraLibrary(runtime);

  assert.deepEqual(updates, [
    { uid: industry, documentId: 'manufacturing-doc', locale: 'en', data: { name: 'Manufacturing' } },
    { uid: industry, documentId: 'manufacturing-doc', locale: 'zh-Hant-TW', data: { name: '製造業', slug: 'manufacturing' } },
  ]);
});
