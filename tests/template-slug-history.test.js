'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createSlugHistoryMiddleware, resolveSlug } = require('../src/api/template/utils/slug-history');

const UID = 'api::template.template';
function fixture() {
  const state = {
    templates: [{ documentId: 'one', slug: 'original', publishedAt: '2026-01-01', template_status: 'public', language: 'en-us' }],
    history: [],
  };
  function matches(row, where) {
    return Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object') {
        if ('$ne' in value) return row[key] !== value.$ne;
        if ('$notNull' in value) return row[key] != null;
        if ('$eqi' in value) return row[key]?.toLowerCase() === value.$eqi.toLowerCase();
      }
      return row[key] === value;
    });
  }
  const strapi = { db: {
    async transaction(fn) {
      const backup = structuredClone(state);
      try { return await fn(); } catch (error) { Object.assign(state, backup); throw error; }
    },
    query(uid) {
      const key = uid === UID ? 'templates' : 'history';
      return {
        async findOne({ where }) { return state[key].find((row) => matches(row, where)) || null; },
        async create({ data }) { state[key].push(data); return data; },
      };
    },
  } };
  return { state, strapi, middleware: createSlugHistoryMiddleware(strapi) };
}

async function publish(f, slug, action = 'publish') {
  f.state.templates = f.state.templates.filter((t) => t.publishedAt !== null);
  f.state.templates.push({ documentId: 'one', slug, publishedAt: null, template_status: 'public', language: 'en-us' });
  return f.middleware({ uid: UID, action, params: {
    documentId: 'one', ...(action === 'update' ? { status: 'published', data: { slug } } : {}),
  } }, async () => {
    f.state.templates = f.state.templates.filter((t) => t.documentId !== 'one');
    f.state.templates.push({ documentId: 'one', slug, publishedAt: '2026-02-01', template_status: 'public', language: 'en-us' });
    return action === 'publish' ? { documentId: 'one', entries: [] } : { documentId: 'one' };
  });
}

test('first rename and repeated renames resolve directly to the latest published slug', async () => {
  const f = fixture();
  await publish(f, 'second');
  await publish(f, 'third', 'update');
  assert.equal(await resolveSlug(f.strapi, 'original'), 'third');
  assert.equal(await resolveSlug(f.strapi, 'second'), 'third');
  assert.equal(await resolveSlug(f.strapi, 'third'), 'third');
  assert.equal(await resolveSlug(f.strapi, 'unknown'), null);
});

test('saving drafts does not create redirects or change the published target', async () => {
  const f = fixture();
  await f.middleware({ uid: UID, action: 'update', params: { documentId: 'one', data: { slug: 'draft-name' } } }, async () => ({}));
  assert.deepEqual(f.state.history, []);
  assert.equal(await resolveSlug(f.strapi, 'original'), 'original');
  assert.equal(await resolveSlug(f.strapi, 'draft-name'), null);
});

test('unpublish preserves old URLs for a subsequent rename and republish', async () => {
  const f = fixture();
  await f.middleware({ uid: UID, action: 'unpublish', params: { documentId: 'one' } }, async () => {
    f.state.templates = [];
  });
  assert.equal(await resolveSlug(f.strapi, 'original'), null);
  await publish(f, 'republished');
  assert.equal(await resolveSlug(f.strapi, 'original'), 'republished');
});

test('another template cannot take a historical or currently used slug', async () => {
  const f = fixture();
  await publish(f, 'new-name');
  for (const slug of ['original', 'new-name']) {
    await assert.rejects(f.middleware({ uid: UID, action: 'create', params: { data: { slug } } }, async () => {
      assert.fail('must reject before mutation');
    }), /slug belongs/);
  }
});

test('the same template can restore its old slug without a redirect loop', async () => {
  const f = fixture();
  await publish(f, 'second');
  await publish(f, 'original');
  assert.equal(await resolveSlug(f.strapi, 'original'), 'original');
  assert.equal(await resolveSlug(f.strapi, 'second'), 'original');
});

test('resolver only exposes published public templates matching the requested language', async () => {
  const f = fixture();
  await publish(f, 'new-name');
  assert.equal(await resolveSlug(f.strapi, 'original', 'zh-tw'), null);
  assert.equal(await resolveSlug(f.strapi, 'original', 'EN-US'), 'new-name');
  f.state.templates[0].template_status = 'private';
  assert.equal(await resolveSlug(f.strapi, 'original'), null);
  f.state.templates = [];
  assert.equal(await resolveSlug(f.strapi, 'original'), null);
});

test('failed publishing rolls back history', async () => {
  const f = fixture();
  f.state.templates.push({ documentId: 'one', slug: 'new-name', publishedAt: null });
  await assert.rejects(f.middleware({ uid: UID, action: 'publish', params: { documentId: 'one' } }, async () => {
    throw new Error('publish failed');
  }), /publish failed/);
  assert.deepEqual(f.state.history, []);
});
