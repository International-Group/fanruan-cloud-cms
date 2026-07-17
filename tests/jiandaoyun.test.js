'use strict';

const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');

const {
  syncTemplateToJianDaoYun,
} = require('../src/api/template/utils/jiandaoyun');
const templateLifecycles = require('../src/api/template/content-types/template/lifecycles');

const ENV_KEYS = [
  'JIANDAOYUN_API_URL',
  'JIANDAOYUN_DATA_LIST_API_URL',
  'JIANDAOYUN_DATA_UPDATE_API_URL',
  'JIANDAOYUN_API_KEY',
  'JIANDAOYUN_APP_ID',
  'JIANDAOYUN_ENTRY_ID',
  'JIANDAOYUN_ZH_TEMPLATE_ID_FIELD',
  'JIANDAOYUN_NEW_FILE_LINK_FIELD',
  'JIANDAOYUN_PUBLISHED_LINK_FIELD',
  'JIANDAOYUN_LANGUAGE_FIELD',
  'TEMPLATE_PUBLIC_BASE_URL',
];

let originalEnv;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.JIANDAOYUN_DATA_LIST_API_URL = 'https://example.test/data/list';
  process.env.JIANDAOYUN_DATA_UPDATE_API_URL = 'https://example.test/data/update';
  process.env.JIANDAOYUN_API_KEY = 'test-key';
  process.env.JIANDAOYUN_APP_ID = 'test-app';
  process.env.JIANDAOYUN_ENTRY_ID = 'test-entry';

  for (const key of ENV_KEYS.slice(6)) {
    delete process.env[key];
  }
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

const matchingRecord = (language = 'English') => ({
  _id: 'data-id',
  _widget_1773888010278: '20001696',
  _widget_1770003814387: language,
});

test('queries by template ID and language, then updates both links', async () => {
  const requests = [];

  const result = await syncTemplateToJianDaoYun({
    zhTemplateId: '20001696',
    language: 'en-us',
    downloadLink: 'https://cdn.example.test/template.zip',
    slug: 'abc123',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return url.endsWith('/list')
        ? {
            ok: true,
            json: async () => ({ data: [matchingRecord()] }),
          }
        : { ok: true, status: 200 };
    },
  });

  assert.deepEqual(JSON.parse(requests[0].options.body), {
    app_id: 'test-app',
    entry_id: 'test-entry',
    fields: ['_widget_1773888010278', '_widget_1770003814387'],
    filter: {
      rel: 'and',
      cond: [
        {
          field: '_widget_1773888010278',
          type: 'text',
          method: 'eq',
          value: ['20001696'],
        },
        {
          field: '_widget_1770003814387',
          type: 'text',
          method: 'eq',
          value: ['English'],
        },
      ],
    },
    limit: 2,
  });
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    app_id: 'test-app',
    entry_id: 'test-entry',
    data_id: 'data-id',
    data: {
      _widget_1770019599166: {
        value: 'https://cdn.example.test/template.zip',
      },
      _widget_1779852152157: {
        value: 'https://gallery.fanruan.com/abc123',
      },
    },
  });
  assert.deepEqual(result, {
    dataId: 'data-id',
    status: 200,
    galleryLink: 'https://gallery.fanruan.com/abc123',
    syncedFields: ['_widget_1770019599166', '_widget_1779852152157'],
  });
});

test('maps each supported Strapi language to JianDaoYun text', async () => {
  const mappings = {
    'en-us': 'English',
    'zh-tw': '繁体',
    'ko-kr': '한국의',
  };

  for (const [language, mappedLanguage] of Object.entries(mappings)) {
    let lookupBody;

    await syncTemplateToJianDaoYun({
      zhTemplateId: '20001696',
      language,
      downloadLink: '#',
      slug: 'abc123',
      fetchImpl: async (url, options) => {
        if (url.endsWith('/list')) {
          lookupBody = JSON.parse(options.body);
          return {
            ok: true,
            json: async () => ({ data: [matchingRecord(mappedLanguage)] }),
          };
        }
        return { ok: true, status: 200 };
      },
    });

    assert.deepEqual(lookupBody.filter.cond[1].value, [mappedLanguage]);
  }
});

test('rejects a lookup that returns no record', async () => {
  await assert.rejects(
    syncTemplateToJianDaoYun({
      zhTemplateId: '20001696',
      language: 'en-us',
      downloadLink: '#',
      slug: 'abc123',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ data: [] }),
      }),
    }),
    /No JianDaoYun record found/
  );
});

test('rejects a lookup that returns multiple records', async () => {
  await assert.rejects(
    syncTemplateToJianDaoYun({
      zhTemplateId: '20001696',
      language: 'en-us',
      downloadLink: '#',
      slug: 'abc123',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: [matchingRecord(), { ...matchingRecord(), _id: 'duplicate-id' }],
        }),
      }),
    }),
    /Multiple JianDaoYun records found.*data-id,duplicate-id/
  );
});

test('rejects an unsupported language before querying JianDaoYun', async () => {
  let called = false;

  await assert.rejects(
    syncTemplateToJianDaoYun({
      zhTemplateId: '20001696',
      language: 'ru',
      downloadLink: '#',
      slug: 'abc123',
      fetchImpl: async () => {
        called = true;
      },
    }),
    /Unsupported Template language/
  );

  assert.equal(called, false);
});

test('rejects a mismatched record instead of updating it', async () => {
  let callCount = 0;

  await assert.rejects(
    syncTemplateToJianDaoYun({
      zhTemplateId: '20001696',
      language: 'en-us',
      downloadLink: '#',
      slug: 'abc123',
      fetchImpl: async () => {
        callCount += 1;
        return {
          ok: true,
          json: async () => ({
            data: [{ ...matchingRecord(), _widget_1773888010278: 'wrong-id' }],
          }),
        };
      },
    }),
    /lookup response did not match/
  );

  assert.equal(callCount, 1);
});

test('syncs after save and publish but ignores a viewed-only update', async () => {
  const originalFetch = global.fetch;
  const originalStrapi = global.strapi;
  let callCount = 0;

  global.fetch = async (url) => {
    callCount += 1;
    return url.endsWith('/list')
      ? { ok: true, json: async () => ({ data: [matchingRecord()] }) }
      : { ok: true, status: 200 };
  };
  global.strapi = {
    log: {
      info() {},
      warn() {},
      error() {},
    },
  };

  const result = {
    zh_template_id: '20001696',
    language: 'en-us',
    download_link: 'https://cdn.example.test/template.zip',
    slug: 'abc123',
  };

  try {
    await templateLifecycles.afterCreate({
      params: { data: result },
      result,
    });
    await templateLifecycles.afterUpdate({
      params: { data: { publishedAt: '2026-07-17T00:00:00.000Z' } },
      result: { ...result, publishedAt: '2026-07-17T00:00:00.000Z' },
    });
    await templateLifecycles.afterUpdate({
      params: { data: { viewed: '2' } },
      result: { ...result, viewed: '2' },
    });
  } finally {
    global.fetch = originalFetch;
    global.strapi = originalStrapi;
  }

  assert.equal(callCount, 4);
});
