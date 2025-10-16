'use strict';

/**
 * dictionary service
 */

const { createCoreService } = require('@strapi/strapi').factories;

module.exports = createCoreService('api::dictionary.dictionary');
