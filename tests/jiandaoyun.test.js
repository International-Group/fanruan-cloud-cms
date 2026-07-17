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
      return { ok: true, json: async () => ({ data: [{ _id: 'data-id' }] }) };
    }
    return { ok: true };
  };

  await syncDownloadLink({
    zhTemplateId: 'template-001',
    downloadLink: 'https://cdn.example.test/template.zip',
    fetchImpl,
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(JSON.parse(requests[0].options.body), {
    app_id: 'test-app',
    entry_id: 'test-entry',
    fields: ['zh_template_id'],
    filter: {
      rel: 'and',
      cond: [
        {
          field: 'zh_template_id',
          method: 'eq',
          value: ['template-001'],
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
      new_file_link: {
        value: 'https://cdn.example.test/template.zip',
      },
    },
  });
});

test('allows both JianDaoYun field identifiers to be configured', async () => {
  process.env.JIANDAOYUN_ZH_TEMPLATE_ID_FIELD = '_widget_lookup';
  process.env.JIANDAOYUN_NEW_FILE_LINK_FIELD = '_widget_link';
  const bodies = [];

  await syncDownloadLink({
    zhTemplateId: 'template-001',
    downloadLink: '#',
    fetchImpl: async (url, options) => {
      bodies.push(JSON.parse(options.body));
      return url.endsWith('/list')
        ? { ok: true, json: async () => ({ data: [{ _id: 'data-id' }] }) }
        : { ok: true };
    },
  });

  assert.equal(bodies[0].filter.cond[0].field, '_widget_lookup');
  assert.deepEqual(bodies[1].data, {
    _widget_link: { value: '#' },
  });
});

test('syncs the published gallery link to its JianDaoYun widget', async () => {
  const bodies = [];

  await syncTemplateFields({
    zhTemplateId: 'template-001',
    publishedLink: 'https://gallery.fanruan.com/abc123',
    fetchImpl: async (url, options) => {
      bodies.push(JSON.parse(options.body));
      return url.endsWith('/list')
        ? { ok: true, json: async () => ({ data: [{ _id: 'data-id' }] }) }
        : { ok: true };
    },
  });

  assert.deepEqual(bodies[1].data, {
    _widget_1779852152157: {
      value: 'https://gallery.fanruan.com/abc123',
    },
  });
});

test('combines download and published links in one JianDaoYun update', async () => {
  const bodies = [];

  await syncTemplateFields({
    zhTemplateId: 'template-001',
    downloadLink: 'https://cdn.example.test/template.zip',
    publishedLink: 'https://gallery.fanruan.com/abc123',
    fetchImpl: async (url, options) => {
      bodies.push(JSON.parse(options.body));
      return url.endsWith('/list')
        ? { ok: true, json: async () => ({ data: [{ _id: 'data-id' }] }) }
        : { ok: true };
    },
  });

  assert.deepEqual(bodies[1].data, {
    new_file_link: {
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
      downloadLink: '#',
      fetchImpl: async () => ({
        ok: true,
        json: async () => ({ data: [{ _id: 'one' }, { _id: 'two' }] }),
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
      downloadLink: '#',
      fetchImpl: async () => {
        called = true;
      },
    }),
    /JIANDAOYUN_API_KEY/
  );

  assert.equal(called, false);
});
