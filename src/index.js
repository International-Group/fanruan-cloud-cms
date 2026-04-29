'use strict';
const bootstrap = require("./bootstrap");
const userBehaviorQueue = require('./api/user-behavior/utils/user-behavior-queue');

module.exports = {
  /**
   * An asynchronous register function that runs before
   * your application is initialized.
   *
   * This gives you an opportunity to extend code.
   */
  register(/*{ strapi }*/) {},

  /**
   * An asynchronous bootstrap function that runs before
   * your application gets started.
   *
   * This gives you an opportunity to set up your data model,
   * run jobs, or perform some special logic.
   */
  async bootstrap({ strapi }) {
    await bootstrap();
    userBehaviorQueue.start(strapi);
  },

  async destroy() {
    await userBehaviorQueue.stop();
  },
};
