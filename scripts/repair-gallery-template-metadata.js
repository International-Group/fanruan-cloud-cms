'use strict';
const encodeLegacyDescription = value => Array.from(value).map(c => c === '\n' ? '\n' : `&#${c.codePointAt(0)};`).join('');

function planMetadataRepair(templates, works, submissions) {
  const byWork = new Map(works.map(w => [w.key, w]));
  const bySubmission = new Map(submissions.map(s => [s.key, s]));
  return templates.flatMap(template => {
    const work = byWork.get(template.gallery_work_key);
    const submission = work && bySubmission.get(work.currentSubmission);
    // Only the current, approved external submission can identify original text.
    if (!work || !submission || work.templateDocumentId !== template.documentId || submission.owner !== work.owner || submission.reviewStatus !== 'approved') return [];
    const data = {};
    if (template.source !== 'Competition') data.source = 'Competition';
    const original = submission.payload?.description;
    // Do not decode arbitrary entities or overwrite CMS edits made since publication.
    if (typeof original === 'string' && template.description !== original && template.description === encodeLegacyDescription(original)) data.description = original;
    return Object.keys(data).length ? [{ row: template, data }] : [];
  });
}

async function repairGalleryTemplateMetadata(strapi, { apply = false } = {}) {
  const templates = strapi.db.query('api::template.template');
  return strapi.db.transaction(async () => {
    const rows = await templates.findMany({ where: { gallery_work_key: { $notNull: true } } });
    const works = await strapi.db.query('api::gallery-work.gallery-work').findMany();
    const submissions = await strapi.db.query('api::gallery-submission.gallery-submission').findMany({ where: { reviewStatus: 'approved' } });
    const plan = planMetadataRepair(rows, works, submissions);
    if (apply) for (const { row, data } of plan) {
      const result = await templates.updateMany({ where: { id: row.id, source: row.source, description: row.description }, data: { ...data, updatedAt: new Date() } });
      if (result.count !== 1) throw new Error('Template changed during metadata repair; transaction rolled back');
    }
    return { matchedRecords: rows.length, changedRecords: plan.length, applied: apply, fields: plan.map(p => ({ id: p.row.id, documentId: p.row.documentId, fields: Object.keys(p.data) })) };
  });
}

module.exports = { encodeLegacyDescription, planMetadataRepair, repairGalleryTemplateMetadata };

// Local operator command. Require an explicit SQLite path before loading the app;
// cannot accidentally use a remote database. Back up SQLite before any app startup.
if (require.main === module) (async () => {
  const path = require('node:path');
  const fs = require('node:fs/promises');
  const args = process.argv.slice(2);
  const index = args.indexOf('--sqlite');
  if (index < 0 || !args[index + 1]) throw new Error('Usage: node scripts/repair-gallery-template-metadata.js --sqlite /absolute/path/database.db [--apply]');
  const { compileStrapi, createStrapi } = require('@strapi/strapi');
  const app = createStrapi(await compileStrapi());
  let loaded = false;
  try {
    const config = app.config.get('database.connection');
    if (config.client !== 'sqlite' || path.resolve(config.connection.filename) !== path.resolve(args[index + 1])) throw new Error('Database does not match the explicitly selected local SQLite file');
    if (args.includes('--apply')) {
      const backupDir = path.resolve('runtime/gallery-backups'); await fs.mkdir(backupDir, { recursive: true });
      const backup = path.join(backupDir, `before-metadata-repair-${Date.now()}.db`);
      const sqlite = new (require('better-sqlite3'))(config.connection.filename, { readonly: true });
      try { await sqlite.backup(backup); } finally { sqlite.close(); }
      console.log(`Local database backup: ${backup}`);
    }
    await app.load(); loaded = true;
    console.log(JSON.stringify(await repairGalleryTemplateMetadata(app, { apply: args.includes('--apply') }), null, 2));
  } finally { if (loaded) await app.destroy(); }
})().catch(e => { console.error(e.message); process.exitCode = 1; });
