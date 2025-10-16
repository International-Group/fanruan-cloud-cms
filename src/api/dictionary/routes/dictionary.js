'use strict';

/**
 * dictionary router
 */

const { createCoreRouter } = require('@strapi/strapi').factories;

module.exports = createCoreRouter('api::dictionary.dictionary');
