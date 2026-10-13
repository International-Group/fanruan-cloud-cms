'use strict';

const { errors } = require('@strapi/utils');
const TEMPLATE_UID = 'api::template.template';
const HISTORY_UID = 'api::template-slug.template-slug';

const assertAvailable = async (strapi, slug, documentId) => {
  if (!slug) return;
  const history = await strapi.db.query(HISTORY_UID).findOne({ where: { slug } });
  const template = await strapi.db.query(TEMPLATE_UID).findOne({
    where: { slug, ...(documentId ? { documentId: { $ne: documentId } } : {}) },
    select: ['documentId'],
  });
  if ((history && history.templateDocumentId !== documentId) || template) {
    throw new errors.ValidationError('This slug belongs to another template or its slug history.');
  }
};

const remember = async (strapi, template) => {
  if (!template?.slug) return;
  const query = strapi.db.query(HISTORY_UID);
  const history = await query.findOne({ where: { slug: template.slug } });
  if (history) {
    if (history.templateDocumentId !== template.documentId) {
      throw new errors.ValidationError('This slug belongs to another template.');
    }
    return;
  }
  await query.create({ data: {
    slug: template.slug,
    templateDocumentId: template.documentId,
  } });
};

const createSlugHistoryMiddleware = (strapi) => async (context, next) => {
  if (context.uid !== TEMPLATE_UID || !['create', 'update', 'publish', 'unpublish'].includes(context.action)) {
    return next();
  }
  const params = context.params || {};
  const publishing = context.action === 'publish' || params.status === 'published';
  return strapi.db.transaction(async () => {
    let slug = params.data?.slug;
    if (context.action === 'publish') {
      const draft = await strapi.db.query(TEMPLATE_UID).findOne({
        where: { documentId: params.documentId, publishedAt: null },
      });
      slug = draft?.slug;
    }
    if (context.action !== 'unpublish') {
      await assertAvailable(strapi, slug, params.documentId);
    }
    if ((publishing || context.action === 'unpublish') && params.documentId) {
      // Capture the existing published URL on the first rename after deployment.
      const previous = await strapi.db.query(TEMPLATE_UID).findOne({
        where: { documentId: params.documentId, publishedAt: { $notNull: true } },
      });
      await remember(strapi, previous);
    }
    const result = await next();
    if (publishing) {
      const documentId = result?.documentId || params.documentId;
      if (documentId) {
        const published = await strapi.db.query(TEMPLATE_UID).findOne({
          where: { documentId, publishedAt: { $notNull: true } },
        });
        await remember(strapi, published);
      }
    }
    return result;
  });
};

const resolveSlug = async (strapi, slug, language) => {
  const publicWhere = {
    publishedAt: { $notNull: true },
    template_status: 'public',
    ...(language ? { language: { $eqi: language } } : {}),
  };
  const templates = strapi.db.query(TEMPLATE_UID);
  const current = await templates.findOne({ where: { ...publicWhere, slug }, select: ['slug'] });
  if (current) return current.slug;
  const history = await strapi.db.query(HISTORY_UID).findOne({ where: { slug } });
  if (!history) return null;
  const target = await templates.findOne({
    where: { ...publicWhere, documentId: history.templateDocumentId }, select: ['slug'],
  });
  return target?.slug || null;
};

module.exports = { createSlugHistoryMiddleware, resolveSlug };
