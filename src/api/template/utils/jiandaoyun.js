'use strict';

const DEFAULT_DATA_LIST_API_URL =
  'https://api.jiandaoyun.com/api/v5/app/entry/data/list';
const DEFAULT_DATA_UPDATE_API_URL =
  'https://api.jiandaoyun.com/api/v5/app/entry/data/update';
const DEFAULT_LOOKUP_FIELD = '_widget_1773888010278';
const DEFAULT_TARGET_FIELD = '_widget_1770019599166';
const DEFAULT_PUBLISHED_LINK_FIELD = '_widget_1779852152157';

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
  lookupField:
    process.env.JIANDAOYUN_ZH_TEMPLATE_ID_FIELD || DEFAULT_LOOKUP_FIELD,
  targetField:
    process.env.JIANDAOYUN_NEW_FILE_LINK_FIELD || DEFAULT_TARGET_FIELD,
  publishedLinkField:
    process.env.JIANDAOYUN_PUBLISHED_LINK_FIELD || DEFAULT_PUBLISHED_LINK_FIELD,
});

const assertConfig = ({ apiKey, appId, entryId }) => {
  const missing = [
    ['JIANDAOYUN_API_KEY', apiKey],
    ['JIANDAOYUN_APP_ID', appId],
    ['JIANDAOYUN_ENTRY_ID', entryId],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length) {
    throw new Error(`Missing JianDaoYun configuration: ${missing.join(', ')}`);
  }
};

/**
 * Find a JianDaoYun record by its zh_template_id field and update its link.
 *
 * Field names can be overridden when the API expects `_widget_...` identifiers.
 */
const syncTemplateFields = async ({
  zhTemplateId,
  downloadLink,
  publishedLink,
  fetchImpl = fetch,
}) => {
  const config = getConfig();
  assertConfig(config);

  const headers = {
    Authorization: `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
  };

  const listResponse = await fetchImpl(config.dataListApiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      app_id: config.appId,
      entry_id: config.entryId,
      fields: [config.lookupField],
      filter: {
        rel: 'and',
        cond: [
          {
            field: config.lookupField,
            method: 'eq',
            value: [zhTemplateId],
          },
        ],
      },
      limit: 2,
    }),
  });

  if (!listResponse.ok) {
    const responseBody = await listResponse.text();
    throw new Error(
      `JianDaoYun lookup failed (${listResponse.status}): ${responseBody}`
    );
  }

  const listResult = await listResponse.json();
  const records = Array.isArray(listResult) ? listResult : listResult.data;

  if (!Array.isArray(records)) {
    throw new Error('JianDaoYun lookup returned an invalid response.');
  }

  if (records.length === 0) {
    throw new Error(
      `No JianDaoYun record found for zh_template_id: ${zhTemplateId}`
    );
  }

  if (records.length > 1) {
    throw new Error(
      `Multiple JianDaoYun records found for zh_template_id: ${zhTemplateId}`
    );
  }

  const dataId = records[0]._id || records[0].data_id;

  if (!dataId) {
    throw new Error('JianDaoYun lookup result does not contain a data_id.');
  }

  const updateData = {};

  if (downloadLink !== undefined) {
    updateData[config.targetField] = { value: downloadLink };
  }

  if (publishedLink !== undefined) {
    updateData[config.publishedLinkField] = { value: publishedLink };
  }

  if (Object.keys(updateData).length === 0) {
    throw new Error('No Template fields were provided for JianDaoYun sync.');
  }

  const updateResponse = await fetchImpl(config.dataUpdateApiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      app_id: config.appId,
      entry_id: config.entryId,
      data_id: dataId,
      data: updateData,
    }),
  });

  if (!updateResponse.ok) {
    const responseBody = await updateResponse.text();
    throw new Error(
      `JianDaoYun update failed (${updateResponse.status}): ${responseBody}`
    );
  }
};

const syncDownloadLink = (options) => syncTemplateFields(options);

module.exports = {
  syncDownloadLink,
  syncTemplateFields,
};
