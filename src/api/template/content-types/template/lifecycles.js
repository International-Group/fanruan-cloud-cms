const { syncTemplateFields } = require('../../utils/jiandaoyun');

const TEMPLATE_PUBLIC_BASE_URL = 'https://gallery.fanruan.com';

const syncTemplateToJianDaoYun = async (
  event,
  { syncDownloadLink = false, syncPublishedLink = false }
) => {
  const { data } = event.params;
  const zhTemplateId = event.result?.zh_template_id || data.zh_template_id;

  if (!zhTemplateId) {
    strapi.log.warn(
      '[Template] Skipped JianDaoYun sync because zh_template_id is empty.'
    );
    return;
  }

  const slug = event.result?.slug || data.slug;

  if (syncPublishedLink && !slug) {
    strapi.log.warn(
      '[Template] Skipped JianDaoYun published link sync because slug is empty.'
    );
  }

  if (!syncDownloadLink && (!syncPublishedLink || !slug)) {
    return;
  }

  try {
    await syncTemplateFields({
      zhTemplateId,
      downloadLink: syncDownloadLink ? data.download_link : undefined,
      publishedLink:
        syncPublishedLink && slug
          ? `${TEMPLATE_PUBLIC_BASE_URL}/${slug}`
          : undefined,
    });
  } catch (error) {
    // The Template mutation is already committed at this point. Log the sync
    // failure without turning a successful CMS operation into a false failure.
    strapi.log.error(
      `[Template] Failed to sync fields to JianDaoYun (${zhTemplateId}): ${error.message}`
    );
  }
};

module.exports = {
  async beforeCreate(event) {
    const { data } = event.params;

    // Function to generate a random 12-character alphanumeric string
    const generateSlug = (length = 12) => {
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
      let result = '';
      for (let i = 0; i < length; i++) {
        result += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      return result;
    };

    // If slug is not provided, generate one
    if (!data.slug) {
      data.slug = generateSlug();
    }
  },

  async afterCreate(event) {
    const isPublished = Boolean(
      event.result?.publishedAt || event.params.data.publishedAt
    );

    if (isPublished) {
      await syncTemplateToJianDaoYun(event, { syncPublishedLink: true });
    }
  },

  async afterUpdate(event) {
    const { data } = event.params;
    const hasDownloadLink = Object.prototype.hasOwnProperty.call(
      data,
      'download_link'
    );
    const isPublishing =
      Object.prototype.hasOwnProperty.call(data, 'publishedAt') &&
      Boolean(event.result?.publishedAt || data.publishedAt);

    // Other Template updates (for example viewed count) do not need a sync.
    if (!hasDownloadLink && !isPublishing) {
      return;
    }

    await syncTemplateToJianDaoYun(event, {
      syncDownloadLink: hasDownloadLink,
      syncPublishedLink: isPublishing,
    });
  },
};
