'use strict';
const { randomUUID } = require('node:crypto');
const { renderReviewEmail, validEmail } = require('../utils/review-email');
const { fail } = require('../utils/validation');
const JOB = 'api::gallery-notification.gallery-notification';
const CONTACT = 'api::gallery-contact.gallery-contact';

module.exports = ({ strapi }) => {
  const jobs = () => strapi.db.query(JOB);
  const contacts = () => strapi.db.query(CONTACT);
  let timer, running, transport, stopped = true;
  const config = () => strapi.config.get('gallery');
  const stamp = () => new Date();
  const dto = job => job ? { id: job.eventKey, status: job.state, action: job.payload.action, attempts: job.attempts, sentAt: job.sentAt || null, nextAttemptAt: job.nextAttemptAt || null, errorCode: job.errorCode || null } : null;
  const worker = {
    async syncContact(owner, user) {
      const email = validEmail(user.email) ? user.email.trim() : '';
      const verified = !!email && user.emailVerified === true;
      const old = await contacts().findOne({ where: { owner } });
      if (old && old.email === email && old.verified === verified) return;
      if (old) await contacts().update({ where: { id: old.id }, data: { email, verified } });
      else try { await contacts().create({ data: { owner, email, verified } }); }
      catch (e) {
        if (!/unique|duplicate/i.test(e.message)) throw e;
        await contacts().update({ where: { owner }, data: { email, verified } });
      }
      if (verified) await jobs().updateMany({ where: { owner, state: 'blocked', errorCode: 'RECIPIENT_UNAVAILABLE' }, data: { state: 'pending', errorCode: null, nextAttemptAt: stamp() } });
    },
    // Called inside the same transaction as the review/publish mutation.
    async enqueue(submission, action, reason, decidedAt) {
      const record = submission.payload.reviews.at(-1);
      const eventKey = `review:${record.id}`;
      const existing = await jobs().findOne({ where: { eventKey } });
      if (existing) return existing;
      await jobs().updateMany({ where: { submissionKey: submission.key, state: { $in: ['pending','blocked','failed'] } }, data: { state: 'superseded', nextAttemptAt: null } });
      return jobs().create({ data: { eventKey, owner: submission.owner, submissionKey: submission.key, state: 'pending', attempts: 0, nextAttemptAt: stamp(), payload: { action, reason, title: submission.payload.title, slug: submission.payload.publicSlug || '', locale: submission.payload.notificationLocale || submission.payload.language || 'en-us', decidedAt } } });
    },
    async latest(submissionKey) { return dto(await jobs().findOne({ where: { submissionKey }, orderBy: { id: 'desc' } })); },
    async retry(submissionKey) {
      const job = await jobs().findOne({ where: { submissionKey }, orderBy: { id: 'desc' } });
      if (!job) fail(404, 'No review email exists for this submission');
      if (!['failed','blocked'].includes(job.state)) fail(409, 'This review email is already queued or sent');
      const result = await jobs().updateMany({ where: { id: job.id, state: job.state }, data: { state: 'pending', attempts: 0, errorCode: null, nextAttemptAt: stamp() } });
      if (result.count !== 1) fail(409, 'Notification changed; reload and retry');
      return worker.latest(submissionKey);
    },
    async deliver(job) {
      const cfg = config(); const mail = cfg.mail || {};
      const leaseToken = randomUUID(); const now = stamp();
      const claim = await jobs().updateMany({ where: { id: job.id, state: job.state, attempts: job.attempts, nextAttemptAt: job.nextAttemptAt, ...(job.state === 'sending' ? { leaseUntil: { $lte: now } } : {}) }, data: { state: 'sending', leaseToken, leaseUntil: new Date(Date.now() + 120000) } });
      if (claim.count !== 1) return;
      const update = data => jobs().updateMany({ where: { id: job.id, state: 'sending', leaseToken }, data: { ...data, leaseToken: null, leaseUntil: null } });
      const blocked = errorCode => update({ state: 'blocked', errorCode, nextAttemptAt: new Date(Date.now() + 15 * 60000) });
      if (!mail.enabled) return blocked('MAIL_DISABLED');
      if (!mail.host || !mail.from || !mail.user || !mail.pass) return blocked('SMTP_NOT_CONFIGURED');
      const contact = await contacts().findOne({ where: { owner: job.owner } });
      if (!contact?.verified || !validEmail(contact.email)) return blocked('RECIPIENT_UNAVAILABLE');
      const attempts = job.attempts + 1;
      try {
        const message = renderReviewEmail(job, cfg.siteUrl, mail.from);
        if (!transport) transport = require('nodemailer').createTransport({ host: mail.host, port: mail.port, secure: mail.secure, requireTLS: !mail.secure, auth: { user: mail.user, pass: mail.pass }, connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 30000, logger: false, debug: false });
        const result = await transport.sendMail({ ...message, from: mail.from, to: contact.email });
        if (!result.accepted?.some(address => String(address).toLowerCase() === contact.email.toLowerCase())) throw new Error('Recipient not accepted');
        await update({ state: 'sent', attempts, sentAt: stamp(), nextAttemptAt: null, errorCode: null });
      } catch {
        const max = mail.maxAttempts || 8;
        await update({ state: 'failed', attempts, errorCode: 'SEND_FAILED', nextAttemptAt: attempts < max ? new Date(Date.now() + Math.min(6 * 3600000, 60000 * 2 ** (attempts - 1))) : null });
        strapi.log.warn(`[Gallery mail] Delivery failed for notification ${job.id}; retry is tracked in the outbox.`);
      }
    },
    async drain() {
      if (running) return running;
      running = (async () => {
        const now = stamp();
        const due = await jobs().findMany({ where: { $or: [ { state: { $in: ['pending','failed','blocked'] }, nextAttemptAt: { $notNull: true, $lte: now } }, { state: 'sending', leaseUntil: { $lte: now } } ] }, orderBy: { id: 'asc' }, limit: 20 });
        for (const job of due) { if (stopped) break; await worker.deliver(job); }
      })().finally(() => { running = null; });
      return running;
    },
    start() {
      if (timer) return;
      stopped = false;
      timer = setInterval(() => { void worker.drain().catch(() => strapi.log.error('[Gallery mail] Outbox scan failed; will retry.')); }, config().mail?.intervalMs || 30000);
      timer.unref?.();
    },
    async stop() { stopped = true; if (timer) clearInterval(timer); timer = null; if (running) await running; transport?.close?.(); transport = null; },
    // Injectable transport for isolated delivery tests; never exposed through an API.
    setTransportForTests(value) { if (process.env.NODE_ENV !== 'test') throw new Error('Test transport is only available under NODE_ENV=test'); transport = value; },
  };
  return worker;
};
