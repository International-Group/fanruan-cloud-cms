'use strict';

const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');

const schema = require('../src/api/template/content-types/template/schema.json');
const templateLifecycles = require('../src/api/template/content-types/template/lifecycles');

let originalStrapi;

beforeEach(() => {
  originalStrapi = global.strapi;
});

afterEach(() => {
  global.strapi = originalStrapi;
});

test('zh_template_id is a string instead of a globally unique UID', () => {
  assert.equal(schema.attributes.zh_template_id.type, 'string');
  assert.notEqual(schema.attributes.zh_template_id.unique, true);
});

test('allows the same zh_template_id in a different language', async () => {
  const queries = [];

  global.strapi = {
    db: {
      query() {
        return {
          async findOne(params) {
            queries.push(params);
            return null;
          },
        };
      },
    },
  };

  await templateLifecycles.beforeCreate({
    action: 'beforeCreate',
    params: {
      data: {
        zh_template_id: '20001696',
        language: 'zh-tw',
        publishedAt: '2026-07-30T00:00:00.000Z',
        slug: 'traditional-chinese-template',
      },
    },
  });

  assert.deepEqual(queries[0].where, {
    zh_template_id: '20001696',
    language: 'zh-tw',
    publishedAt: { $notNull: true },
  });
});

test('rejects an existing published zh_template_id and language pair', async () => {
  global.strapi = {
    db: {
      query() {
        return {
          async findOne() {
            return { id: 42 };
          },
        };
      },
    },
  };

  await assert.rejects(
    templateLifecycles.beforeCreate({
      action: 'beforeCreate',
      params: {
        data: {
          zh_template_id: '20001696',
          language: 'en-us',
          publishedAt: '2026-07-30T00:00:00.000Z',
          slug: 'english-template',
        },
      },
    }),
    /combination of zh_template_id and language must be unique/
  );
});

test('validates partial updates using the persisted identity fields', async () => {
  const queries = [];

  global.strapi = {
    db: {
      query() {
        return {
          async findOne(params) {
            queries.push(params);
            if (queries.length === 1) {
              return {
                id: 7,
                zh_template_id: '20001696',
                language: 'en-us',
                publishedAt: '2026-07-29T00:00:00.000Z',
              };
            }
            return null;
          },
        };
      },
    },
  };

  await templateLifecycles.beforeUpdate({
    action: 'beforeUpdate',
    params: {
      where: { id: 7 },
      data: { language: 'ko-kr' },
    },
  });

  assert.deepEqual(queries[1].where, {
    zh_template_id: '20001696',
    language: 'ko-kr',
    publishedAt: { $notNull: true },
    id: { $ne: 7 },
  });
});

test('does not enforce the published identity constraint while saving a draft', async () => {
  let queryCalled = false;

  global.strapi = {
    db: {
      query() {
        queryCalled = true;
      },
    },
  };

  await templateLifecycles.beforeCreate({
    action: 'beforeCreate',
    params: {
      data: {
        zh_template_id: '20001696',
        language: 'en-us',
        publishedAt: null,
        slug: 'draft-template',
      },
    },
  });

  assert.equal(queryCalled, false);
});
