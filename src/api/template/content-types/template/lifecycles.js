const { syncDownloadLink } = require('../../utils/jiandaoyun');

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

  async afterUpdate(event) {
    const { data } = event.params;

    // Other Template updates (for example viewed count) do not need a sync.
    if (!Object.prototype.hasOwnProperty.call(data, 'download_link')) {
      return;
    }

    const zhTemplateId = event.result?.zh_template_id || data.zh_template_id;

    if (!zhTemplateId) {
      strapi.log.warn(
        '[Template] Skipped JianDaoYun sync because zh_template_id is empty.'
      );
      return;
    }

    try {
      await syncDownloadLink({
        zhTemplateId,
        downloadLink: data.download_link,
      });
    } catch (error) {
      // The Template update is already committed at this point. Log the sync
      // failure without turning a successful CMS update into a false failure.
      strapi.log.error(
        `[Template] Failed to sync download_link to JianDaoYun (${zhTemplateId}): ${error.message}`
      );
    }
  },
};
