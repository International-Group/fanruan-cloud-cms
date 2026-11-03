'use strict';
const { randomUUID, createHash } = require('node:crypto');
const v = require('../utils/validation');
const { storage, hashFile } = require('../utils/storage');
const UID = name => `api::gallery-${name}.gallery-${name}`;
const now = () => new Date().toISOString();
const editable = row => ['draft', 'changes_requested'].includes(row.reviewStatus);
const uniqueError = e => /unique|duplicate/i.test(e.message || '');
const accountAvatar = value => { try { return v.profileAvatar(value); } catch { return ''; } };

module.exports = ({ strapi }) => {
  const q = name => strapi.db.query(UID(name));
  const store = storage(strapi);
  const operations = () => strapi.service('api::gallery.creator-operations');
  const versions = () => strapi.service('api::gallery.versions');
  const notifications = () => strapi.service('api::gallery.notifications');
  const getProfile = owner => q('profile').findOne({ where: { owner } });
  const getSubmission = async (key, actor) => {
    const row = await q('submission').findOne({ where: { key, ...(actor.canReview ? {} : { owner: actor.owner }) } });
    if (!row) v.fail(404, 'Submission not found');
    return row;
  };
  const ownSubmission = async (key, actor) => {
    const row = await getSubmission(key, { owner: actor.owner, canReview: false });
    return row;
  };
  const getWork = async (key, actor) => {
    const row = await q('work').findOne({ where: { key, ...(actor.canReview ? {} : { owner: actor.owner }) } });
    if (!row) v.fail(404, 'Work not found');
    return row;
  };
  const cas = async (type, row, data, expected = row.revision, action = 'saved', actorUid = row.owner) => {
    if (v.revision(expected) !== row.revision) v.fail(409, 'Revision conflict; reload and retry');
    if (type === 'submission') await versions().record(row, 'baseline');
    const result = await q(type).updateMany({ where: { id: row.id, revision: expected }, data: { ...data, revision: expected + 1 } });
    if (result.count !== 1) v.fail(409, 'Revision conflict; reload and retry');
    const updated = await q(type).findOne({ where: { id: row.id } });
    if (type === 'submission' && action) await versions().record(updated, action, actorUid);
    return updated;
  };
  const withOperation = async (actor, scope, key, fingerprint, run) => {
    if (typeof key !== 'string' || !key.trim() || key.length > 200) v.fail(422, 'Idempotency-Key is required (max 200 characters)');
    const operationKey = createHash('sha256').update(JSON.stringify([actor.owner, scope, key])).digest('hex');
    const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const normalized = { ...fingerprint };
    // Upload retries may follow a successful PATCH. The operation identity is the
    // submission, file bytes, kind and key; revision still guards the first write.
    if (scope.startsWith('upload:')) delete normalized.revision;
    const digest = hash(normalized);
    const read = async () => {
      const previous = await q('operation').findOne({ where: { key: operationKey } });
      if (!previous) return null;
      const legacyUpload = scope.startsWith('upload:') && previous.fingerprint === hash({ ...fingerprint, revision: String(previous.payload.revision - 1) });
      if (previous.fingerprint !== digest && !legacyUpload) v.fail(409, 'Idempotency-Key was already used with another request');
      if (previous.payload.key) {
        // A replay must not roll the editor back to the revision cached before
        // later uploads/edits. Do not repeat the mutation; return its current state.
        const current = await q('submission').findOne({ where: { key: previous.payload.key } });
        if (!current) v.fail(404, 'Submission not found');
        return current;
      }
      return previous.payload;
    };
    const previous = await read();
    if (previous) return previous;
    try {
      return await strapi.db.transaction(async ({ onRollback }) => {
        const result = await run({ onRollback });
        await q('operation').create({ data: { key: operationKey, fingerprint: digest, payload: result } });
        return result;
      });
    } catch (error) {
      // A concurrent identical request may have won the unique operation key.
      const previous = await read();
      if (previous) return previous;
      if (uniqueError(error)) v.fail(409, 'Concurrent update; reload and retry');
      throw error;
    }
  };
  const profileDTO = row => row ? { ...row.payload, revision: row.revision } : null;
  const submissionDTO = async row => {
    const work = row.workKey ? await q('work').findOne({ where: { key: row.workKey } }) : null;
    const p = row.payload;
    let renderUrl = p.renderUrl || '';
    if (row.reviewStatus === 'approved' && work?.currentSubmission === row.key && work.templateDocumentId) {
      const template = await strapi.documents('api::template.template').findOne({ documentId: work.templateDocumentId, status: work.publicationStatus === 'published' ? 'published' : 'draft' });
      renderUrl = template?.template_link || '';
    }
    try { renderUrl = v.renderUrl(renderUrl); } catch { renderUrl = ''; }
    return { emailNotification: await notifications().latest(row.key), renderUrl, ...(work ? { isCurrentVersion: work.currentSubmission === row.key } : {}), ...v.draft(p), id: row.key, revision: row.revision, reviewStatus: row.reviewStatus, updatedAt: row.updatedAt,
      assets: p.assets.map(a => ({ id: a.id, kind: a.kind, name: a.name, size: a.size, url: store.url(a.id) })),
      reviews: p.reviews.map(r => ({ id: r.id, action: r.action, reason: r.reason, reviewer: r.reviewer, createdAt: r.createdAt })),
      ...(work ? { workId: work.key, ...(work.templateDocumentId ? { publicSlug: p.publicSlug || work.key, publicationStatus: work.publicationStatus } : {}) } : {}),
    };
  };
  const ensureOnboarded = async owner => { const row = await getProfile(owner); if (!row?.payload?.onboardingCompleted) v.fail(422, 'Complete your creator profile before uploading or submitting'); return row; };
  const touchWork = row => cas('work', row, {});
  const history = (payload, action, actor, reason = '') => [...payload.reviews, { id: randomUUID(), action, reason, reviewer: actor.canReview ? 'Gallery team' : 'Creator', createdAt: now() }];
  const assetRecord = async key => { const row = await q('asset').findOne({ where: { key } }); if (!row) v.fail(404, 'Asset not found'); return row; };
  const newRow = async (owner, payload, workKey = null) => {
    const row = await q('submission').create({ data: { owner, key: randomUUID(), revision: 1, reviewStatus: 'draft', workKey, activeKey: workKey, payload: { ...payload, renderUrl: '', assets: payload.assets || [], reviews: [] } } });
    await versions().record(row, workKey ? 'new_revision' : 'created', owner);
    return row;
  };
  const media = async asset => {
    const a = await assetRecord(asset.id);
    const p = a.payload;
    return strapi.db.query('plugin::upload.file').create({ data: {
      name: p.name, hash: a.key, ext: p.ext, mime: p.mime, size: p.size / 1000,
      url: store.url(a.key, false), provider: 'local', provider_metadata: { gallery: true },
      ...(p.mime.startsWith('image/') ? { width: p.width, height: p.height } : {}),
    } });
  };
  const publish = async (row, work, profile, renderUrl) => {
    const payload = row.payload;
    const cover = await media(payload.assets.find(a => a.kind === 'cover'));
    const file = payload.submissionType === 'link' ? null : await media(payload.assets.find(a => a.kind === 'template'));
    const data = {
      name: payload.title, slug: payload.publicSlug || work.key, template_status: 'public', author: profile.payload.displayName,
      creator_handle: profile.handle, gallery_work_key: work.key,
      template_link: v.renderUrl(renderUrl),
      thumbnail: cover.id, templateFile: file ? file.id : null, scenario: payload.scenario, industry: payload.industry,
      language: payload.language, product: payload.product, source: 'Competition', description: payload.description,
      download_link: file ? store.url(file.hash, false) : '#', supported_version: payload.supportedVersion, featured: false, free: true,
      seo: { metaTitle: payload.title, metaDescription: payload.description.slice(0, 300), shareImage: cover.id },
      // No translated source ID: lifecycle intentionally skips JianDaoYun synchronization.
    };
    const documents = strapi.documents('api::template.template');
    let result;
    if (work.templateDocumentId) result = await documents.update({ documentId: work.templateDocumentId, data, status: 'published' });
    else result = await documents.create({ data, status: 'published' });
    if (!result?.documentId) v.fail(502, 'Template publication failed');
    const published = await documents.findOne({ documentId: result.documentId, status: 'published' });
    if (!published || published.template_status !== 'public') v.fail(502, 'Template publication failed');
    await q('work').update({ where: { id: work.id }, data: { templateDocumentId: published.documentId, currentSubmission: row.key, publicationStatus: 'published' } });
    return published.slug;
  };
  const service = {
    async me(actor) { const p = await getProfile(actor.owner); return { avatarUrl: accountAvatar(actor.avatar), ...await operations().permissions(actor.owner), needsOnboarding: !p?.payload?.onboardingCompleted, profileHandle: p?.handle || null }; },
    async syncAccountAvatar(owner, avatar) {
      const avatarUrl = accountAvatar(avatar);
      // Account avatars are a cache, not an editable Gallery profile field. A conditional
      // update preserves concurrent profile edits without changing the editor revision.
      for (let attempt = 0; attempt < 3; attempt++) {
        const row = await getProfile(owner);
        if (!row || row.payload.avatarUrl === avatarUrl) return;
        const changed = await q('profile').updateMany({ where: { id: row.id, revision: row.revision }, data: { payload: { ...row.payload, avatarUrl } } });
        if (changed.count === 1) return;
      }
    },
    async profile(actor) { return { profile: profileDTO(await getProfile(actor.owner)), avatarUrl: accountAvatar(actor.avatar) }; },
    async saveProfile(actor, input) {
      const payload = v.profile({ ...input, avatarUrl: accountAvatar(actor.avatar) }); const revision = v.revision(input.revision);
      try {
        return await strapi.db.transaction(async () => {
          const old = await getProfile(actor.owner);
          if (old && old.handle !== payload.handle) v.fail(409, 'Profile handle cannot be changed');
          for (const kind of ['banner']) {
            const url = payload[`${kind}Url`];
            if (!url) continue;
            const match = await q('asset').findMany({ where: { owner: actor.owner, scope: `profile:${kind}` } });
            if (!match.some(a => store.url(a.key, false) === url)) v.fail(422, `${kind} must be uploaded by this account`);
          }
          if (!old && revision !== 0) v.fail(409, 'Revision conflict');
          const saved = old ? await cas('profile', old, { payload }, revision) : await q('profile').create({ data: { owner: actor.owner, handle: payload.handle, revision: 1, payload } });
          await operations().syncProfile(saved);
          return profileDTO(saved);
        });
      } catch (error) { if (uniqueError(error)) v.fail(409, 'Handle already in use or concurrent profile update'); throw error; }
    },
    async profileUpload(actor, kind, file, key) {
      if (kind !== 'banner') v.fail(403, 'Profile photos are managed in account settings');
      const digest = file && !Array.isArray(file) && await hashFile(file);
      const result = await withOperation(actor, `profile:${kind}`, key, { digest, name: file?.originalFilename }, async ({ onRollback }) => {
        const asset = await store.write(file, kind);
        onRollback(() => require('node:fs').rmSync(store.filePath(asset.key), { force: true }));
        try { await q('asset').create({ data: { key: asset.key, owner: actor.owner, scope: `profile:${kind}`, payload: asset } }); }
        catch (e) { await store.remove(asset.key); throw e; }
        return { assetKey: asset.key };
      });
      return { [`${kind}Url`]: store.url(result.assetKey, false) };
    },
    async list(actor, input) {
      const page = v.page(input.page, 1, 100000); const limit = v.page(input.limit, 50, 100);
      const where = { ...(actor.canReview ? {} : { owner: actor.owner }) };
      if (input.status !== undefined) {
        if (!['draft', 'pending', 'changes_requested', 'rejected', 'approved'].includes(input.status)) v.fail(422, 'Invalid status');
        where.reviewStatus = input.status;
      }
      const rows = await q('submission').findMany({ where, orderBy: { updatedAt: 'desc' }, offset: (page - 1) * limit, limit });
      const total = await q('submission').count({ where });
      return { items: await Promise.all(rows.map(submissionDTO)), pagination: { page, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
    },
    async detail(actor, key) { return submissionDTO(await getSubmission(key, actor)); },
    async create(actor, input, key) {
      await operations().requireSubmission(actor.owner);
      const payload = v.draft(input); if (v.revision(input.revision) !== 0) v.fail(409, 'New draft revision must be zero');
      await ensureOnboarded(actor.owner);
      const result = await withOperation(actor, 'create', key, input, () => newRow(actor.owner, payload));
      return submissionDTO(result);
    },
    async update(actor, key, input) {
      return submissionDTO(await strapi.db.transaction(async () => {
        const row = await ownSubmission(key, actor);
        if (!editable(row)) v.fail(409, 'Submission cannot be edited in this state');
        return cas('submission', row, { payload: { ...row.payload, ...v.draft({ ...row.payload, ...input }) } }, input.revision);
      }));
    },
    async upload(actor, id, input, file, key) {
      await operations().requireSubmission(actor.owner);
      await ensureOnboarded(actor.owner);
      if (!['cover', 'template', 'screenshot'].includes(input.kind)) v.fail(422, 'Invalid asset kind');
      const revision = v.revision(Number(input.revision));
      if (!file || Array.isArray(file)) v.fail(422, 'One file is required');
      const digest = await hashFile(file);
      const result = await withOperation(actor, `upload:${id}`, key, { ...input, digest, name: file.originalFilename }, async ({ onRollback }) => {
        const row = await ownSubmission(id, actor);
        if (!editable(row)) v.fail(409, 'Submission is not editable');
        if (row.payload.submissionType === 'link' && input.kind === 'template') v.fail(422, 'Link submissions do not accept template files');
        // Claim the row before file IO. Transaction rollback restores it on any failure.
        await cas('submission', row, {}, revision, null);
        if (input.kind === 'screenshot' && row.payload.assets.filter(a => a.kind === 'screenshot').length >= 5) v.fail(422, 'Maximum five screenshots');
        const asset = await store.write(file, input.kind, row.payload.product);
        onRollback(() => require('node:fs').rmSync(store.filePath(asset.key), { force: true }));
        try {
          await q('asset').create({ data: { key: asset.key, owner: actor.owner, scope: `submission:${id}`, payload: asset } });
          const assets = row.payload.assets.filter(a => input.kind === 'screenshot' || a.kind !== input.kind);
          assets.push({ id: asset.key, kind: input.kind, name: asset.name, size: asset.size });
          const uploaded = await q('submission').update({ where: { id: row.id }, data: { payload: { ...row.payload, assets } } });
          await versions().record(uploaded, 'asset_uploaded', actor.owner);
          return uploaded;
        } catch (e) { await store.remove(asset.key); throw e; }
      });
      return submissionDTO(result);
    },
    async removeAsset(actor, id, assetId, input) {
      return submissionDTO(await strapi.db.transaction(async () => {
        const row = await ownSubmission(id, actor);
        if (!editable(row)) v.fail(409, 'Submission is not editable');
        if (!row.payload.assets.some(a => a.id === assetId)) v.fail(404, 'Asset not found');
        // Keep immutable asset records for previous published versions and in-flight signed URLs.
        return cas('submission', row, { payload: { ...row.payload, assets: row.payload.assets.filter(a => a.id !== assetId) } }, input.revision, 'asset_removed');
      }));
    },
    async submit(actor, id, input, key) {
      await operations().requireSubmission(actor.owner);
      await ensureOnboarded(actor.owner);
      const row = await withOperation(actor, `submit:${id}`, key, input, async () => {
        const row = await ownSubmission(id, actor);
        if (!editable(row)) v.fail(409, 'Submission is not editable');
        v.ready(row.payload);
        // Revalidate attachment type against product even if the product changed after upload.
        for (const item of row.payload.assets.filter(a => a.kind === 'template' && row.payload.submissionType !== 'link')) {
          const asset = await assetRecord(item.id);
          const formats = { FineBI: ['.mbi', '.zip'], FineReport: ['.cpt', '.cptx', '.frmx', '.zip'], FineVis: ['.mfvs', '.fvs', '.zip'], FineDataLink: ['.zip'] };
          if (!formats[row.payload.product].includes(asset.payload.ext)) v.fail(422, 'Template file does not match product');
        }
        return cas('submission', row, { reviewStatus: 'pending', payload: { ...row.payload, notificationLocale: ['en-us','zh-tw','ko','ko-kr'].includes(input.locale) ? input.locale : row.payload.language, reviews: history(row.payload, 'submitted', actor) } }, input.revision, 'submitted');
      });
      return submissionDTO(row);
    },
    async withdraw(actor, id, input) {
      return submissionDTO(await strapi.db.transaction(async () => {
        const row = await ownSubmission(id, actor);
        if (row.reviewStatus !== 'pending') v.fail(409, 'Only pending submissions can be withdrawn');
        return cas('submission', row, { reviewStatus: 'draft', payload: { ...row.payload, reviews: history(row.payload, 'withdrawn', actor) } }, input.revision, 'withdrawn');
      }));
    },
    async remove(actor, id, input) {
      await strapi.db.transaction(async () => {
        const row = await ownSubmission(id, actor);
        if (row.reviewStatus !== 'draft') v.fail(409, 'Only drafts can be deleted');
        await cas('submission', row, {}, input.revision, 'deleted');
        await q('submission').delete({ where: { id: row.id } });
      });
    },
    async review(actor, id, input, key) {
      if (!actor.canReview) v.fail(403, 'Reviewer required');
      if (!['approved', 'changes_requested', 'rejected'].includes(input.action)) v.fail(422, 'Invalid review action');
      const reason = v.text(input.reason, 4000, 'reason', input.action !== 'approved');
      const result = await withOperation(actor, `review:${id}`, key, input, async () => {
        const row = await getSubmission(id, actor);
        if (row.reviewStatus !== 'pending') v.fail(409, 'Only pending submissions can be reviewed');
        const renderUrl = input.action === 'approved' ? v.renderUrl(input.renderUrl ?? (row.payload.submissionType === 'link' ? row.payload.submittedRenderUrl : '')) : '';
        await cas('submission', row, {}, input.revision, null);
        let workKey = row.workKey; let slug = row.payload.publicSlug;
        if (input.action === 'approved') {
          const profile = await ensureOnboarded(row.owner);
          v.ready(row.payload);
          let work;
          if (workKey) work = await touchWork(await getWork(workKey, actor));
          else {
            workKey = randomUUID();
            work = await q('work').create({ data: { key: workKey, owner: row.owner, revision: 1 } });
          }
          slug = await publish(row, work, profile, renderUrl);
        }
        const reviewed = await q('submission').update({ where: { id: row.id }, data: {
          reviewStatus: input.action, workKey,
          ...(input.action !== 'changes_requested' ? { activeKey: null } : {}),
          payload: { ...row.payload, ...(input.action === 'approved' ? { renderUrl } : {}), ...(slug ? { publicSlug: slug } : {}), reviews: history(row.payload, input.action, actor, reason) },
        } });
        await versions().record(reviewed, `review_${input.action}`, actor.owner);
        await notifications().enqueue(reviewed, input.action, reason, reviewed.payload.reviews.at(-1).createdAt);
        return reviewed;
      });
      return submissionDTO(result);
    },
    async newRevision(actor, id) {
      await operations().requireSubmission(actor.owner);
      try {
        return await strapi.db.transaction(async () => {
          const work = await getWork(id, { ...actor, canReview: false });
          const existing = await q('submission').findOne({ where: { activeKey: id, owner: actor.owner } });
          if (existing) return submissionDTO(existing);
          await touchWork(work);
          const source = await ownSubmission(work.currentSubmission, actor);
          const row = await newRow(actor.owner, source.payload, id);
          return submissionDTO(row);
        });
      } catch (error) {
        const existing = await q('submission').findOne({ where: { activeKey: id, owner: actor.owner } });
        if (existing) return submissionDTO(existing);
        throw error;
      }
    },
    async visibility(actor, id, input, restore) {
      if (!actor.canReview) v.fail(403, 'Reviewer required');
      const reason = v.text(input.reason, 4000, 'reason', true);
      return submissionDTO(await strapi.db.transaction(async () => {
        const work = await getWork(id, actor);
        const source = await getSubmission(work.currentSubmission, actor);
        if (!work.templateDocumentId || work.publicationStatus !== (restore ? 'delisted' : 'published')) v.fail(409, 'Work visibility conflict');
        // Frontend sends the selected submission revision. Reject stale historical versions.
        await cas('submission', source, { payload: { ...source.payload, reviews: history(source.payload, restore ? 'republish' : 'unpublish', actor, reason) } }, input.revision, restore ? 'republished' : 'unpublished', actor.owner);
        await touchWork(work);
        const docs = strapi.documents('api::template.template');
        if (restore) {
          const draft = await docs.findOne({ documentId: work.templateDocumentId, status: 'draft' });
          v.renderUrl(draft?.template_link);
          await docs.update({ documentId: work.templateDocumentId, data: { template_status: 'public' }, status: 'published' });
        } else {
          await docs.unpublish({ documentId: work.templateDocumentId });
          await docs.update({ documentId: work.templateDocumentId, data: { template_status: 'delisted' } });
        }
        await q('work').update({ where: { id: work.id }, data: { publicationStatus: restore ? 'published' : 'delisted' } });
        const reviewed = await q('submission').findOne({ where: { id: source.id } });
        await notifications().enqueue(reviewed, restore ? 'republish' : 'unpublish', reason, reviewed.payload.reviews.at(-1).createdAt);
        return reviewed;
      }));
    },
    async updateRenderLink(actor, id, input) {
      if (!actor.canReview) v.fail(403, 'Reviewer required');
      const renderUrl = v.renderUrl(input.renderUrl);
      return submissionDTO(await strapi.db.transaction(async () => {
        const work = await getWork(id, actor);
        const source = await getSubmission(work.currentSubmission, actor);
        if (!work.templateDocumentId || source.reviewStatus !== 'approved' || input.submissionId !== source.key) v.fail(409, 'Only the current approved version can change its rendering URL');
        await cas('submission', source, { payload: { ...source.payload, renderUrl, reviews: history(source.payload, 'render_link_updated', actor, 'Rendering URL updated') } }, input.revision, 'render_link_updated', actor.owner);
        await touchWork(work);
        await strapi.documents('api::template.template').update({ documentId: work.templateDocumentId, data: { template_link: renderUrl }, ...(work.publicationStatus === 'published' ? { status: 'published' } : {}) });
        return q('submission').findOne({ where: { id: source.id } });
      }));
    },
    async versions(actor, id, input) {
      const row = await getSubmission(id, actor);
      const siblings = row.workKey ? await q('submission').findMany({ where: { owner: row.owner, workKey: row.workKey }, select: ['key'] }) : [row];
      const where = { owner: row.owner, ...(row.workKey ? { $or: [{ submissionKey: { $in: siblings.map(s => s.key) } }, { workKey: row.workKey }] } : { submissionKey: row.key }) };
      const page = v.page(input.page, 1, 100000); const limit = v.page(input.limit, 20, 100); const start = (page - 1) * limit;
      const [rows, total] = await Promise.all([
        q('submission-version').findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], offset: start, limit }),
        q('submission-version').count({ where }),
      ]);
      return { items: rows.map(r => ({ id: r.key, submissionId: r.submissionKey, revision: r.revision, title: r.title,
        reviewStatus: r.reviewStatus, action: r.action, savedAt: r.savedAt })),
        pagination: { page, totalPages: Math.max(1, Math.ceil(total / limit)), total } };
    },
    async version(actor, id, versionKey) {
      const row = await getSubmission(id, actor);
      const version = await q('submission-version').findOne({ where: { key: versionKey, owner: row.owner } });
      if (!version) v.fail(404, 'Version not found');
      if (version.submissionKey !== row.key && !(row.workKey && version.workKey === row.workKey)) {
        const sibling = row.workKey && await q('submission').findOne({ where: { key: version.submissionKey, owner: row.owner, workKey: row.workKey } });
        if (!sibling) v.fail(404, 'Version not found');
      }
      let renderUrl = ''; try { renderUrl = v.renderUrl(version.payload.renderUrl); } catch { /* A draft may have no rendering URL. */ }
      return { id: version.key, submissionId: version.submissionKey, revision: version.revision,
        action: version.action, reviewStatus: version.reviewStatus, savedAt: version.savedAt,
        snapshot: { ...v.draft(version.payload), renderUrl,
          assets: version.payload.assets.map(a => ({ id: a.id, kind: a.kind, name: a.name, size: a.size, url: store.url(a.id) })) } };
    },
    async emailStatus(actor, id) {
      const row = await getSubmission(id, actor);
      return notifications().latest(row.key);
    },
    async retryEmail(actor, id) {
      if (!actor.canReview) v.fail(403, 'Reviewer required');
      const row = await getSubmission(id, actor);
      await notifications().retry(row.key);
      return submissionDTO(row);
    },
    async portfolio(handle, input) {
      if (typeof handle !== 'string' || !/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(handle)) v.fail(404, 'Creator not found');
      const row = await q('profile').findOne({ where: { handle } });
      if (!row) v.fail(404, 'Creator not found');
      const page = v.page(input.page, 1, 100000); const limit = v.page(input.limit, 12, 100);
      if (input.sort !== undefined && !['newest', 'popular'].includes(input.sort)) v.fail(422, 'Invalid sort');
      const where = { creator_handle: handle, publishedAt: { $notNull: true }, template_status: 'public' };
      if (input.product !== undefined) {
        if (!require('../../template/content-types/template/schema.json').attributes.product.enum.includes(input.product)) v.fail(422, 'Invalid product');
        where.product = input.product;
      }
      const tq = strapi.db.query('api::template.template');
      const rows = await tq.findMany({ where, orderBy: input.sort === 'popular' ? [{ viewed: 'desc' }, { id: 'desc' }] : [{ publishedAt: 'desc' }, { id: 'desc' }], offset: (page - 1) * limit, limit, populate: { thumbnail: true } });
      const total = await tq.count({ where });
      // Aggregate views in SQL; do not load unbounded work payloads into memory.
      const meta = strapi.db.metadata.get('api::template.template');
      const column = name => meta.attributes[name].columnName;
      const stats = await strapi.db.connection(meta.tableName).where(column('creator_handle'), handle).whereNotNull(column('publishedAt')).where(column('template_status'), 'public').sum({ views: column('viewed') }).count({ total: '*' }).first();
      return { profile: { ...v.publicProfile(row.payload), badges: await operations().publicBadges(row.owner), joinedAt: row.createdAt, workCount: Number(stats.total) || 0, views: Number(stats.views) || 0 },
        works: rows.map(t => ({ id: t.gallery_work_key || t.documentId, documentId: t.documentId, slug: t.slug, title: t.name, product: t.product, coverUrl: t.thumbnail?.url, views: Number(t.viewed) || 0, publishedAt: t.publishedAt, publicationStatus: 'published' })), pagination: { page, totalPages: Math.max(1, Math.ceil(total / limit)), total } };
    },
    async publicWork(key) {
      const work = await q('work').findOne({ where: { key, publicationStatus: 'published' } });
      if (!work?.templateDocumentId) return null;
      const template = await strapi.db.query('api::template.template').findOne({ where: { documentId: work.templateDocumentId, publishedAt: { $notNull: true }, template_status: 'public' } });
      return template ? work : null;
    },
    async readableAsset(key, expires, signature) {
      const asset = await assetRecord(key);
      if (store.verify(key, expires, signature)) return asset.payload;
      if (asset.scope.startsWith('profile:')) {
        const profile = await getProfile(asset.owner);
        const field = `${asset.scope.split(':')[1]}Url`;
        if (field === 'bannerUrl' && profile?.payload?.[field] === store.url(key, false)) return asset.payload;
      } else {
        // Assets can be shared by immutable approved versions. Only the current public snapshot grants anonymous access.
        const works = await q('work').findMany({ where: { owner: asset.owner, publicationStatus: 'published' } });
        for (const candidate of works) {
          const work = await service.publicWork(candidate.key);
          if (!work) continue;
          const row = await q('submission').findOne({ where: { key: work.currentSubmission } });
          if (row?.payload?.assets.some(a => a.id === key && !(row.payload.submissionType === 'link' && a.kind === 'template'))) return asset.payload;
        }
      }
      v.fail(404, 'Asset not found');
    },
    store,
  };
  return service;
};
