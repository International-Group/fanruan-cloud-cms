'use strict';

const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');

const {
  syncDownloadLink,
  syncTemplateFields,
} = require('../src/api/template/utils/jiandaoyun');

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
];

let originalEnv;

beforeEach(() => {
  originalEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.JIANDAOYUN_DATA_LIST_API_URL = 'https://example.test/data/list';
  process.env.JIANDAOYUN_DATA_UPDATE_API_URL = 'https://example.test/data/update';
  process.env.JIANDAOYUN_API_KEY = 'test-key';
  process.env.JIANDAOYUN_APP_ID = 'test-app';
  process.env.JIANDAOYUN_ENTRY_ID = 'test-entry';
  delete process.env.JIANDAOYUN_ZH_TEMPLATE_ID_FIELD;
  delete process.env.JIANDAOYUN_NEW_FILE_LINK_FIELD;
  delete process.env.JIANDAOYUN_PUBLISHED_LINK_FIELD;
  delete process.env.JIANDAOYUN_LANGUAGE_FIELD;
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

test('looks up the record by zh_template_id before updating new_file_link', async () => {
  const requests = [];
  const fetchImpl = async (url, options) => {
    requests.push({ url, options });
    if (url.endsWith('/list')) {
      return {
        ok: true,
        json: async () => ({
          data: [{ _id: 'data-id', _widget_1770003814387: 'English' }],
        }),
      };
    }
    return { ok: true };
  };

  await syncDownloadLink({
    zhTemplateId: 'template-001',
    language: 'en-us',
    downloadLink: 'https://cdn.example.test/template.zip',
    fetchImpl,
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    app_id: 'test-app',
    entry_id: 'test-entry',
    fields: ['_widget_1773888010278', '_widget_1770003814387'],
    filter: {
      rel: 'and',
      cond: [
        {
          field: '_widget_1773888010278',
          method: 'eq',
          value: ['template-001'],
        },
      ],
    },
    limit: 100,
  });
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    app_id: 'test-app',
    entry_id: 'test-entry',
    data_id: 'data-id',
    data: {
      _widget_1770019599166: {
        value: 'https://cdn.example.test/template.zip',
      },
    },
  });
});

test('maps all supported Template languages to JianDaoYun values', async () => {
  const mappings = {
    'en-us': 'English',
    'zh-tw': '繁体',
    'ko-kr': '한국의',
  };

  for (const [language, expectedValue] of Object.entries(mappings)) {
    let updateBody;

    await syncDownloadLink({
      zhTemplateId: 'template-001',
      language,
      downloadLink: '#',
      fetchImpl: async (url, options) => {
        if (url.endsWith('/list')) {
          return {
            ok: true,
            json: async () => ({
              data: [{ _id: 'data-id', _widget_1770003814387: expectedValue }],
            }),
          };
        }
        updateBody = JSON.parse(options.body);
        return { ok: true, status: 200 };
      },
    });

    assert.equal(updateBody.data_id, 'data-id');
  }
});

test('rejects an unmapped language before querying JianDaoYun', async () => {
  let called = false;

  await assert.rejects(
    syncDownloadLink({
      zhTemplateId: 'template-001',
      language: 'ru',
      downloadLink: '#',
      fetchImpl: async () => {
        called = true;
      },
    }),
    /Unsupported Template language/
  );

  assert.equal(called, false);
});

test('allows both JianDaoYun field identifiers to be configured', async () => {
  process.env.JIANDAOYUN_ZH_TEMPLATE_ID_FIELD = '_widget_lookup';
  process.env.JIANDAOYUN_NEW_FILE_LINK_FIELD = '_widget_link';
  const bodies = [];

  await syncDownloadLink({
    zhTemplateId: 'template-001',
    language: 'en-us',
    downloadLink: '#',
    fetchImpl: async (url, options) => {
      bodies.push(JSON.parse(options.body));
      return url.endsWith('/list')
        ? {
            ok: true,
            json: async () => ({
              data: [{ _id: 'data-id', _widget_1770003814387: 'English' }],
            }),
          }
        : { ok: true, status: 200 };
    },
  });

  assert.equal(bodies[0].filter.cond[0].field, '_widget_lookup');
  assert.deepEqual(bodies[1].data, {
    _widget_link: { value: '#' },
  });
});

test('syncs the published gallery link to its JianDaoYun widget', async () => {
  const bodies = [];

  const result = await syncTemplateFields({
    zhTemplateId: 'template-001',
    language: 'en-us',
    publishedLink: 'https://gallery.fanruan.com/abc123',
    fetchImpl: async (url, options) => {
      bodies.push(JSON.parse(options.body));
      return url.endsWith('/list')
        ? {
            ok: true,
            json: async () => ({
              data: [{ _id: 'data-id', _widget_1770003814387: 'English' }],
            }),
          }
        : { ok: true, status: 200 };
    },
  });

  assert.deepEqual(bodies[1].data, {
    _widget_1779852152157: {
      value: 'https://gallery.fanruan.com/abc123',
    },
  });
  assert.deepEqual(result, {
    dataId: 'data-id',
    status: 200,
    candidateCount: 1,
    matchedCount: 1,
    syncedFields: ['_widget_1779852152157'],
  });
});

test('combines download and published links in one JianDaoYun update', async () => {
  const bodies = [];

  await syncTemplateFields({
    zhTemplateId: 'template-001',
    language: 'en-us',
    downloadLink: 'https://cdn.example.test/template.zip',
    publishedLink: 'https://gallery.fanruan.com/abc123',
    fetchImpl: async (url, options) => {
      bodies.push(JSON.parse(options.body));
      return url.endsWith('/list')
        ? {
            ok: true,
            json: async () => ({
              data: [{ _id: 'data-id', _widget_1770003814387: 'English' }],
            }),
          }
        : { ok: true };
    },
  });

  assert.deepEqual(bodies[1].data, {
    _widget_1770019599166: {
      value: 'https://cdn.example.test/template.zip',
    },
    _widget_1779852152157: {
      value: 'https://gallery.fanruan.com/abc123',
    },
  });
  assert.equal(bodies.length, 2);
});

test('does not update when the lookup finds no record', async () => {
  let callCount = 0;

  await assert.rejects(
    syncDownloadLink({
      zhTemplateId: 'missing',
      language: 'en-us',
      downloadLink: '#',
      fetchImpl: async () => {
        callCount += 1;
        return { ok: true, json: async () => ({ data: [] }) };
      },
    }),
    /No JianDaoYun record found/
  );

  assert.equal(callCount, 1);
});

test('does not update when zh_template_id matches multiple records', async () => {
  await assert.rejects(
    syncDownloadLink({
      zhTemplateId: 'duplicate',
      language: 'en-us',
      downloadLink: '#',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({
          data: [
            { _id: 'one', _widget_1770003814387: 'English' },
            { _id: 'two', _widget_1770003814387: 'English' },
          ],
        }),
      }),
    }),
    /Multiple JianDaoYun records found/
  );
});

test('rejects incomplete JianDaoYun configuration before making a request', async () => {
  delete process.env.JIANDAOYUN_API_KEY;
  let called = false;

  await assert.rejects(
    syncDownloadLink({
      zhTemplateId: 'template-001',
      language: 'en-us',
      downloadLink: '#',
      fetchImpl: async () => {
        called = true;
      },
    }),
    /JIANDAOYUN_API_KEY/
  );

  assert.equal(called, false);
});
