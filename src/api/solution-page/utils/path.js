'use strict';

const { errors } = require('@strapi/utils');
const schema = require('../content-types/solution-page/schema.json');

const UID = 'api::solution-page.solution-page';
const pathPattern = new RegExp(schema.attributes.path.regex);
const pathActions = new Set(['create', 'update', 'clone', 'publish', 'discardDraft']);

const createSolutionPagePathMiddleware = (strapi) => async (context, next) => {
  if (context.uid !== UID || !pathActions.has(context.action)) return next();

  const { data, documentId, locale: requestedLocale } = context.params ?? {};
  const path = data?.path;
  if (path !== undefined || context.action === 'clone') {
    if (typeof path !== 'string' || path.length > schema.attributes.path.maxLength || path.trim() !== path || !pathPattern.test(path)) {
      throw new errors.ValidationError('Enter a relative solution path such as manufacturing/lean-production.');
    }
  }

  return strapi.db.transaction(async ({ trx }) => {
    // Hold the same PostgreSQL lock across the path check and the document write,
    // including publication from another process.
    if (strapi.db.dialect.client === 'postgres') {
      await trx.raw('SELECT pg_advisory_xact_lock(hashtext(?))', [UID]);
    }
    if (path !== undefined) {
      const locale = requestedLocale ?? await strapi.plugin('i18n').service('locales').getDefaultLocale();
      const conflict = await strapi.db.query(UID).findOne({
        where: {
          path,
          ...(locale === '*' ? {} : { locale }),
          ...(context.action === 'update' && documentId ? { documentId: { $ne: documentId } } : {})
        },
        select: ['documentId']
      });
      if (conflict) {
        throw new errors.ValidationError('This solution path already exists in the selected locale.');
      }
    }
    return next();
  });
};

module.exports = { createSolutionPagePathMiddleware };
