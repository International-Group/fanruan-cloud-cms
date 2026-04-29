'use strict';

/**
 * user-behavior service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::user-behavior.user-behavior');
