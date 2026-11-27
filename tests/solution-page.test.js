'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const UID = 'api::solution-page.solution-page';
const ROUTE = '/api/solution-pages';

test('Solution Page REST API stores localized MDX, file and SEO without exposing drafts', { timeout: 60000 }, async t => {
  const source = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solution-page-test-'));
  const previousEnv = { NODE_ENV: process.env.NODE_ENV, ENV_PATH: process.env.ENV_PATH, STRAPI_TELEMETRY_DISABLED: process.env.STRAPI_TELEMETRY_DISABLED };
  let app;
  t.after(async () => {
    try {
      await app?.destroy();
    } finally {
      for (const [key, value] of Object.entries(previousEnv)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  for (const folder of ['src', 'config']) fs.cpSync(path.join(source, folder), path.join(dir, folder), { recursive: true });
  fs.mkdirSync(path.join(dir, 'public/uploads'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'data'));
  fs.symlinkSync(path.join(source, 'node_modules'), path.join(dir, 'node_modules'), 'dir');
  fs.copyFileSync(path.join(source, 'package.json'), path.join(dir, 'package.json'));
  const write = (name, content) => fs.writeFileSync(path.join(dir, 'config', name), content);
  write('database.js', `module.exports=()=>({connection:{client:'sqlite',connection:{filename:${JSON.stringify(path.join(dir, 'data/solution.db'))}},useNullAsDefault:true}});`);
  write('server.js', "module.exports=()=>({host:'127.0.0.1',port:0,app:{keys:['solution-test-key']},logger:{updates:{enabled:false}}});");
  write('admin.js', "module.exports=()=>({serveAdminPanel:false,auth:{secret:'test-admin-secret'},apiToken:{salt:'test-api-salt'},transfer:{token:{salt:'test-transfer-salt'}},secrets:{encryptionKey:'test-encryption-key'}});");
  write('plugins.js', "module.exports=()=>({cloud:{enabled:false},upload:{config:{provider:'local'}},'users-permissions':{config:{jwtSecret:'test-jwt-secret'}}});");
  write('gallery.js', "module.exports=()=>({mail:{enabled:false}});");
  process.env.NODE_ENV = 'test';
  process.env.ENV_PATH = path.join(dir, 'no-environment-file');
  process.env.STRAPI_TELEMETRY_DISABLED = 'true';

  const { createStrapi } = require('@strapi/strapi');
  app = createStrapi({ appDir: dir, distDir: dir, autoReload: false });
  assert.equal(app.config.get('database.connection.connection.filename'), path.join(dir, 'data/solution.db'));
  await app.load();
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${app.server.httpServer.address().port}`;
  const { accessKey } = await app.service('admin::api-token').create({ name: 'Solution Page test', type: 'full-access' });
  await app.plugin('i18n').service('locales').create({ code: 'zh-Hant-TW', name: 'Chinese (Traditional, Taiwan)' });
  const retainedTables = await app.store.get({ type: 'core', key: 'persisted_tables' });
  assert.ok(retainedTables.includes('solution_pages'));
  assert.ok(retainedTables.includes('solution_pages_cmps'));

  async function call(url, { method = 'GET', data, form, status = 200 } = {}) {
    const headers = { Authorization: `Bearer ${accessKey}` };
    if (data) headers['Content-Type'] = 'application/json';
    const response = await fetch(origin + url, { method, headers, body: form ?? (data && JSON.stringify({ data })) });
    const payload = await response.json();
    assert.equal(response.status, status, `${method} ${url}: ${JSON.stringify(payload.error)}`);
    return payload.data ?? payload;
  }

  const form = new FormData();
  form.append('files', new Blob(['%PDF-1.4\n%%EOF\n'], { type: 'application/pdf' }), 'solution-brief.pdf');
  const [file] = await call('/api/upload', { method: 'POST', form, status: 201 });
  const body = {
    path: 'manufacturing/lean-production',
    content: '## Overview\n\n<SolutionHero title="Lean production" />\n',
    downloadFile: file.id,
    seo: { metaTitle: 'Lean production', metaDescription: 'A manufacturing solution.' },
  };
  const draft = await call(ROUTE + '?locale=en&status=draft', { method: 'POST', data: body, status: 201 });
  assert.equal(draft.publishedAt, null);
  const listByPath = (locale, status = 'published', routePath = body.path) => call(ROUTE + '?' + new URLSearchParams({
    locale, status, 'filters[path][$eq]': routePath, 'populate[0]': 'downloadFile', 'populate[1]': 'seo',
  }));
  assert.deepEqual(await listByPath('en'), []);
  assert.equal((await listByPath('en', 'draft'))[0].content, body.content);
  await call(ROUTE + '?locale=en&status=draft', { method: 'POST', data: body, status: 400 });
  await call(ROUTE + '?locale=en&status=draft', { method: 'POST', data: { ...body, path: '/solutions/lean-production' }, status: 400 });

  const translated = await call(`${ROUTE}/${draft.documentId}?locale=zh-Hant-TW&status=draft`, {
    method: 'PUT', data: { ...body, content: '# 精實生產', downloadFile: null, seo: { metaTitle: '精實生產', metaDescription: '製造業解決方案' } },
  });
  assert.equal(translated.documentId, draft.documentId);
  await app.documents(UID).publish({ documentId: draft.documentId, locale: 'en' });
  const [published] = await listByPath('en');
  assert.equal(published.downloadFile.mime, 'application/pdf');
  assert.equal(published.seo.metaTitle, body.seo.metaTitle);
  assert.equal(published.content, body.content);
  assert.deepEqual(await listByPath('zh-Hant-TW'), []);
  await app.documents(UID).publish({ documentId: draft.documentId, locale: 'zh-Hant-TW' });
  const [taiwan] = await listByPath('zh-Hant-TW');
  assert.equal(taiwan.content, '# 精實生產');
  assert.equal(taiwan.downloadFile, null);

  const newPath = 'manufacturing/lean-operations';
  await call(`${ROUTE}/${draft.documentId}?locale=en&status=draft`, { method: 'PUT', data: { path: newPath } });
  assert.equal((await listByPath('en'))[0].documentId, draft.documentId);
  assert.deepEqual(await listByPath('en', 'published', newPath), []);
  await call(ROUTE + '?locale=en&status=draft', { method: 'POST', data: body, status: 400 });
  await call(ROUTE + '?locale=en&status=draft', { method: 'POST', data: { ...body, path: newPath }, status: 400 });
});
