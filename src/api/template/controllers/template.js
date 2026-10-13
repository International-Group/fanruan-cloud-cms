'use strict';

/**
 * template controller
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { resolveSlug } = require('../utils/slug-history');

module.exports = createCoreController('api::template.template', ({ strapi }) => ({
  async resolveSlug(ctx) {
    const language = ctx.query.language;
    if (language !== undefined && typeof language !== 'string') {
      return ctx.badRequest('language must be a string');
    }
    const slug = await resolveSlug(strapi, ctx.params.slug, language);
    if (!slug) return ctx.notFound();
    ctx.body = { data: { slug } };
  },
}));
