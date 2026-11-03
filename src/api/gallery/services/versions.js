'use strict';
const { errors } = require('@strapi/utils');
const VERSION = 'api::gallery-submission-version.gallery-submission-version';
const SUBMISSION = 'api::gallery-submission.gallery-submission';
const READ_ONLY = new Set([VERSION, SUBMISSION]);
module.exports = ({ strapi }) => {
  const q = () => strapi.db.query(VERSION);
  const record = async (row, action, actorUid) => {
    const key = `${row.key}:${row.revision}`;
    // Existing snapshots are immutable, including when an idempotent operation replays.
    if (await q().findOne({ where: { key } })) return;
    return q().create({ data: { key, submissionKey: row.key, owner: row.owner, workKey: row.workKey || null,
      title: row.payload.title || '', revision: row.revision, reviewStatus: row.reviewStatus,
      action, actorUid: actorUid || null, savedAt: row.updatedAt || row.createdAt || new Date().toISOString(),
      payload: JSON.parse(JSON.stringify(row.payload)) } });
  };
  return {
    record,
    async initialize() {
      let last = 0; let count = 0;
      while (true) {
        const rows = await strapi.db.query(SUBMISSION).findMany({ where: { id: { $gt: last } }, orderBy: { id: 'asc' }, limit: 100 });
        if (!rows.length) break;
        for (const row of rows) {
          await strapi.db.transaction(async () => {
            const current = await strapi.db.query(SUBMISSION).findOne({ where: { id: row.id } });
            if (current) await record(current, 'baseline');
          });
          count++;
        }
        last = rows.at(-1).id;
      }
      return { submissions: count };
    },
    async middleware(context, next) {
      if (READ_ONLY.has(context.uid) && ['create','update','delete','publish','unpublish','discardDraft'].includes(context.action)) {
        throw new errors.ForbiddenError('Gallery drafts and history are read-only here; use the Gallery submission workflow.');
      }
      return next();
    },
  };
};
