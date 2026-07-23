const {
  syncTemplateToJianDaoYun,
} = require('../../utils/jiandaoyun');

const IGNORED_UPDATE_FIELDS = new Set(['viewed', 'updatedAt']);

const getPublishDate = (event) => {
  const changedData = event.params?.data || {};

  // Only a publish mutation should be allowed to set the first-publish date.
  // Reading publishedAt from event.result alone would also match later edits
  // to an already-published Template.
  if (
    !Object.prototype.hasOwnProperty.call(changedData, 'publishedAt') ||
    !changedData.publishedAt
  ) {
    return undefined;
  }

  return event.result?.publishedAt || changedData.publishedAt;
};

const syncTemplate = async (event) => {
  const data = event.result || event.params.data;
  const {
    zh_template_id: zhTemplateId,
    language,
    download_link: downloadLink,
    slug,
  } = data;

  if (!zhTemplateId) {
    strapi.log.warn(
      '[Template] Skipped JianDaoYun sync because zh_template_id is empty.'
    );
    return;
  }

  try {
    const result = await syncTemplateToJianDaoYun({
      zhTemplateId,
      language,
      downloadLink,
      slug,
      publishDate: getPublishDate(event),
      logger: strapi.log,
    });

    strapi.log.info(
      `[Template] JianDaoYun sync succeeded: zh_template_id=${zhTemplateId}, language=${language}, data_id=${result.dataId}, status=${result.status}, fields=${result.syncedFields.join(',')}`
    );
  } catch (error) {
    // The Strapi mutation has already succeeded. Keep it successful and expose
    // the external synchronization failure in server logs.
    strapi.log.error(
      `[Template] Failed to sync fields to JianDaoYun (zh_template_id=${zhTemplateId}, language=${language}): ${error.message}`
    );
  }
};

module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;

    const generateSlug = (length = 12) => {
      const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let result = '';
      for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    if (!data.slug) {
      data.slug = generateSlug();
    }
  },

  async afterCreate(event) {
    await syncTemplate(event);
  },

  async afterUpdate(event) {
    const changedFields = Object.keys(event.params.data || {});
    const isOnlyIgnoredUpdate =
      changedFields.length > 0 &&
      changedFields.every((field) => IGNORED_UPDATE_FIELDS.has(field));

    if (!isOnlyIgnoredUpdate) {
      await syncTemplate(event);
    }
  },
};
