'use strict';
const { errors } = require('@strapi/utils');
const { fail, text } = require('../utils/validation');
const CREATOR = 'api::gallery-creator.gallery-creator';
const PROFILE = 'api::gallery-profile.gallery-profile';
const BADGE = 'api::gallery-badge.gallery-badge';
const colors = ['blue','green','purple','gold','gray'];
const snapshot = p => ({ displayName: p.payload.displayName, handle: p.handle, country: p.payload.country || '', job: p.payload.job || '', organization: p.payload.organization || '' });

module.exports = ({ strapi }) => {
  const creators = () => strapi.db.query(CREATOR);
  const profiles = () => strapi.db.query(PROFILE);
  const legacyReviewer = owner => strapi.config.get('gallery.reviewerIds', []).includes(owner);
  const service = {
    async syncProfile(profile) {
      const data = snapshot(profile);
      const existing = await creators().findOne({ where: { accountUid: profile.owner } });
      if (existing) {
        if (Object.entries(data).some(([k,v]) => existing[k] !== v)) await creators().update({ where: { id: existing.id }, data });
        return { ...existing, ...data };
      }
      try { return await creators().create({ data: { accountUid: profile.owner, ...data, canSubmit: true, canReview: legacyReviewer(profile.owner) } }); }
      catch (error) { if (!/unique|duplicate/i.test(error.message)) throw error; return creators().findOne({ where: { accountUid: profile.owner } }); }
    },
    async permissions(owner) {
      const existing = await creators().findOne({ where: { accountUid: owner } });
      if (existing) return { canSubmit: existing.canSubmit === true, canReview: existing.canReview === true };
      const profile = await profiles().findOne({ where: { owner } });
      if (profile) { const row = await service.syncProfile(profile); return { canSubmit: row.canSubmit === true, canReview: row.canReview === true }; }
      return { canSubmit: true, canReview: legacyReviewer(owner) };
    },
    async requireSubmission(owner) { if (!(await service.permissions(owner)).canSubmit) fail(403, 'Submission permission has been disabled for this account'); },
    async publicBadges(owner) {
      const row = await creators().findOne({ where: { accountUid: owner }, populate: { badges: true } });
      return (row?.badges || []).filter(b => b.enabled === true && /^[a-z0-9][a-z0-9-]{1,63}$/.test(b.code) && typeof b.name === 'string').map(b => ({ code: b.code, name: b.name, nameZhTw: b.nameZhTw || '', nameKo: b.nameKo || '', description: b.description || '', color: colors.includes(b.color) ? b.color : 'gray' }));
    },
    async initialize({ seedBadges = false } = {}) {
      // Synchronize author identity only; never reset operator permissions or badges.
      let offset = 0;
      while (true) {
        const batch = await profiles().findMany({ orderBy: { id: 'asc' }, offset, limit: 100 });
        for (const profile of batch) await service.syncProfile(profile);
        if (batch.length < 100) break;
        offset += batch.length;
      }
      for (const uid of strapi.config.get('gallery.reviewerIds', [])) {
        if (!await creators().findOne({ where: { accountUid: uid } })) await creators().create({ data: { accountUid: uid, displayName: `账号 ${uid}`, canSubmit: true, canReview: true } });
      }
      if (seedBadges) for (const data of [
        { code:'verified-creator',name:'Verified creator',nameZhTw:'認證作者',nameKo:'인증 크리에이터',color:'blue',description:'Creator verified by the Gallery team.' },
        { code:'featured-creator',name:'Featured creator',nameZhTw:'精選作者',nameKo:'추천 크리에이터',color:'gold',description:'Recognized for outstanding contributions to Gallery.' },
        { code:'community-contributor',name:'Community contributor',nameZhTw:'社群貢獻者',nameKo:'커뮤니티 기여자',color:'green',description:'An active contributor to the Gallery community.' },
      ]) if (!await strapi.db.query(BADGE).findOne({ where: { code: data.code } })) await strapi.db.query(BADGE).create({ data: { ...data, enabled: true } });
      return { authors: await creators().count(), badges: await strapi.db.query(BADGE).count() };
    },
    middleware: async (context, next) => {
      if (context.uid === BADGE && ['create','update'].includes(context.action) && context.params.data?.code !== undefined && !/^[a-z0-9][a-z0-9-]{1,63}$/.test(context.params.data.code)) throw new errors.ValidationError('Badge code must use lowercase letters, numbers and hyphens (2–64 characters).');
      if (context.uid !== CREATOR) return next();
      if (context.action === 'delete') throw new errors.ValidationError('Use creator permissions to disable access instead of deleting the author operations record.');
      if (!['create','update'].includes(context.action)) return next();
      const data = context.params.data || {};
      const old = context.action === 'update' ? await creators().findOne({ where: { documentId: context.params.documentId } }) : null;
      const accountUid = old?.accountUid || text(data.accountUid, 200, 'accountUid', true);
      if (old && data.accountUid !== undefined && data.accountUid !== old.accountUid) throw new errors.ValidationError('The linked account UID cannot be changed.');
      const profile = await profiles().findOne({ where: { owner: accountUid } });
      context.params.data = { ...data, accountUid, ...(profile ? snapshot(profile) : { displayName: old?.displayName || `账号 ${accountUid}` }) };
      return next();
    },
  };
  return service;
};
