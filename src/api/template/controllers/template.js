'use strict';

/**
 * template controller
 */

const { createCoreController } = require('@strapi/strapi').factories;
const { resolveSlug } = require('../utils/slug-history');
const { isDraftPreviewAuthorized } = require('../utils/preview-access');

module.exports = createCoreController('api::template.template', ({ strapi }) => ({
  async find(ctx) {
    if (!isDraftPreviewAuthorized(ctx)) return ctx.forbidden('Drafts require authenticated preview access.');
    if (ctx.query.status === 'draft') ctx.set('Cache-Control', 'private, no-store');
    return super.find(ctx);
  },
  async findOne(ctx) {
    if (!isDraftPreviewAuthorized(ctx)) return ctx.forbidden('Drafts require authenticated preview access.');
    if (ctx.query.status === 'draft') ctx.set('Cache-Control', 'private, no-store');
    return super.findOne(ctx);
  },
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
