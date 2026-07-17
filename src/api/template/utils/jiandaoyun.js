'use strict';

const DEFAULT_DATA_LIST_API_URL =
  'https://api.jiandaoyun.com/api/v5/app/entry/data/list';
const DEFAULT_DATA_UPDATE_API_URL =
  'https://api.jiandaoyun.com/api/v5/app/entry/data/update';
const DEFAULT_PUBLIC_BASE_URL = 'https://gallery.fanruan.com';

const DEFAULT_FIELDS = {
  zhTemplateId: '_widget_1773888010278',
  language: '_widget_1770003814387',
  downloadLink: '_widget_1770019599166',
  galleryLink: '_widget_1779852152157',
};

const LANGUAGE_VALUES = {
  'en-us': 'English',
  'zh-tw': '繁体',
  'ko-kr': '한국의',
};

const getConfig = () => ({
  dataListApiUrl:
    process.env.JIANDAOYUN_DATA_LIST_API_URL || DEFAULT_DATA_LIST_API_URL,
  dataUpdateApiUrl:
    process.env.JIANDAOYUN_DATA_UPDATE_API_URL ||
    process.env.JIANDAOYUN_API_URL ||
    DEFAULT_DATA_UPDATE_API_URL,
  apiKey: process.env.JIANDAOYUN_API_KEY,
  appId: process.env.JIANDAOYUN_APP_ID,
  entryId: process.env.JIANDAOYUN_ENTRY_ID,
  publicBaseUrl:
    process.env.TEMPLATE_PUBLIC_BASE_URL || DEFAULT_PUBLIC_BASE_URL,
  fields: {
    zhTemplateId:
      process.env.JIANDAOYUN_ZH_TEMPLATE_ID_FIELD ||
      DEFAULT_FIELDS.zhTemplateId,
    language:
      process.env.JIANDAOYUN_LANGUAGE_FIELD || DEFAULT_FIELDS.language,
    downloadLink:
      process.env.JIANDAOYUN_NEW_FILE_LINK_FIELD ||
      DEFAULT_FIELDS.downloadLink,
    galleryLink:
      process.env.JIANDAOYUN_PUBLISHED_LINK_FIELD ||
      DEFAULT_FIELDS.galleryLink,
  },
});

const assertConfig = ({ apiKey, appId, entryId }) => {
  const missing = [
    ['JIANDAOYUN_API_KEY', apiKey],
    ['JIANDAOYUN_APP_ID', appId],
    ['JIANDAOYUN_ENTRY_ID', entryId],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(`Missing JianDaoYun configuration: ${missing.join(', ')}`);
  }
};

const normalizeValue = (value) => String(value ?? '').trim();

const maskHeaders = (headers) => ({
  ...headers,
  Authorization: headers.Authorization ? 'Bearer ***' : headers.Authorization,
});

const logRequest = (logger, label, url, request) => {
  if (!logger?.info) {
    return;
  }

  logger.info(
    `[Template] JianDaoYun ${label} request: ${JSON.stringify({
      url,
      method: request.method,
      headers: maskHeaders(request.headers || {}),
      body: JSON.parse(request.body),
    })}`
  );
};

const assertResponseOk = async (response, operation) => {
  if (response.ok) {
    return;
  }

  const responseBody = await response.text();
  throw new Error(
    `JianDaoYun ${operation} failed (${response.status}): ${responseBody}`
  );
};

/**
 * Query one JianDaoYun record by zh_template_id + language, then update both
 * its download link and public gallery link.
 *
 * Filter shape follows https://hc.jiandaoyun.com/open/14220. Both fields are
 * text filters; JianDaoYun classifies single-line text, dropdowns and radio
 * groups as `text` for this API.
 */
const syncTemplateToJianDaoYun = async ({
  zhTemplateId,
  language,
  downloadLink,
  slug,
  fetchImpl = fetch,
  logger,
}) => {
  const config = getConfig();
  assertConfig(config);

  const mappedLanguage = LANGUAGE_VALUES[language];
  if (!mappedLanguage) {
    throw new Error(
      `Unsupported Template language for JianDaoYun sync: ${language}`
    );
  }

  for (const [field, value] of Object.entries({
    zh_template_id: zhTemplateId,
    download_link: downloadLink,
    slug,
  })) {
    if (!normalizeValue(value)) {
      throw new Error(`Template ${field} is required for JianDaoYun sync.`);
    }
  }

  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };

  const lookupBody = {
    app_id: config.appId,
    entry_id: config.entryId,
    fields: [config.fields.zhTemplateId, config.fields.language],
    filter: {
      rel: 'and',
      cond: [
        {
          field: config.fields.zhTemplateId,
          type: 'text',
          method: 'eq',
          value: [normalizeValue(zhTemplateId)],
        },
        {
          field: config.fields.language,
          type: 'text',
          method: 'eq',
          value: [mappedLanguage],
        },
      ],
    },
    // Fetch two so an invalid duplicate can be detected without reading a
    // full page of unrelated form data.
    limit: 2,
  };
  const lookupRequest = {
    method: 'POST',
    headers,
    body: JSON.stringify(lookupBody),
  };

  logRequest(logger, 'lookup', config.dataListApiUrl, lookupRequest);

  const lookupResponse = await fetchImpl(config.dataListApiUrl, lookupRequest);

  await assertResponseOk(lookupResponse, 'lookup');

  const lookupResult = await lookupResponse.json();
  const records = lookupResult?.data;

  if (!Array.isArray(records)) {
    throw new Error('JianDaoYun lookup returned an invalid response.');
  }

  if (records.length === 0) {
    throw new Error(
      `No JianDaoYun record found for zh_template_id=${zhTemplateId}, language=${mappedLanguage}`
    );
  }

  if (records.length > 1) {
    const dataIds = records.map((record) => record._id).filter(Boolean);
    throw new Error(
      `Multiple JianDaoYun records found for zh_template_id=${zhTemplateId}, language=${mappedLanguage}; data_ids=${dataIds.join(',')}`
    );
  }

  const record = records[0];
  const dataId = record._id;

  if (!dataId) {
    throw new Error('JianDaoYun lookup result does not contain a data_id.');
  }

  // The API returns requested form fields at the record's top level. Validate
  // them before updating so an ignored filter can never modify another row.
  if (
    normalizeValue(record[config.fields.zhTemplateId]) !==
      normalizeValue(zhTemplateId) ||
    normalizeValue(record[config.fields.language]) !== mappedLanguage
  ) {
    throw new Error(
      `JianDaoYun lookup response did not match zh_template_id=${zhTemplateId}, language=${mappedLanguage}`
    );
  }

  const galleryLink = `${config.publicBaseUrl.replace(/\/$/, '')}/${slug}`;
  const updateData = {
    [config.fields.downloadLink]: { value: downloadLink },
    [config.fields.galleryLink]: { value: galleryLink },
  };

  const updateBody = {
    app_id: config.appId,
    entry_id: config.entryId,
    data_id: dataId,
    data: updateData,
  };
  const updateRequest = {
    method: 'POST',
    headers,
    body: JSON.stringify(updateBody),
  };

  logRequest(logger, 'update', config.dataUpdateApiUrl, updateRequest);

  const updateResponse = await fetchImpl(config.dataUpdateApiUrl, updateRequest);

  await assertResponseOk(updateResponse, 'update');

  return {
    dataId,
    status: updateResponse.status,
    galleryLink,
    syncedFields: Object.keys(updateData),
  };
};

module.exports = {
  syncTemplateToJianDaoYun,
};
