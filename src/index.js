'use strict';
const userBehaviorQueue = require('./api/user-behavior/utils/user-behavior-queue');
const { createSlugHistoryMiddleware } = require('./api/template/utils/slug-history');

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register({ strapi }) {
    strapi.documents.use(createSlugHistoryMiddleware(strapi));
  },

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }) {
    // Example content is initialized explicitly with scripts/seed.js, never on server startup.
    userBehaviorQueue.start(strapi);
  },

  async destroy() {
    await userBehaviorQueue.stop();
  },
};
