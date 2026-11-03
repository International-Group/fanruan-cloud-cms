'use strict';
const { createHash } = require('node:crypto');
const labels = {
  en: { title: 'Gallery review result', approved: 'Approved and published', changes_requested: 'Changes requested', rejected: 'Submission rejected', unpublish: 'Work unpublished', republish: 'Publication restored', work: 'Work', result: 'Result', feedback: 'Reviewer feedback', open: 'View submission', public: 'View published work', footer: 'This email reports the decision at the time shown. Sign in to Gallery for the latest status.', time: 'Decision time' },
  zh: { title: 'Gallery 審核結果通知', approved: '已批准並發布', changes_requested: '需修改', rejected: '投稿已拒絕', unpublish: '作品已下架', republish: '已恢復發布', work: '作品', result: '審核結果', feedback: '審核意見', open: '查看投稿', public: '查看公開作品', footer: '此郵件記錄所示時間的處理結果，最新狀態請登入 Gallery 查看。', time: '處理時間' },
  ko: { title: 'Gallery 검토 결과', approved: '승인 및 게시 완료', changes_requested: '수정 요청', rejected: '제출 반려', unpublish: '작품 게시 취소', republish: '게시 복원', work: '작품', result: '결과', feedback: '검토 의견', open: '제출 작품 보기', public: '게시된 작품 보기', footer: '이 이메일은 표시된 시점의 결정입니다. 최신 상태는 Gallery에서 확인하세요.', time: '처리 시각' },
};
const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(value);
function renderReviewEmail(job, siteUrl, from) {
  const p = job.payload;
  const copy = labels[p.locale?.startsWith('zh') ? 'zh' : p.locale?.startsWith('ko') ? 'ko' : 'en'];
  if (!copy[p.action]) throw new Error('Unsupported notification action');
  const base = new URL(siteUrl);
  if (base.username || base.password || (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost','127.0.0.1'].includes(base.hostname)))) throw new Error('Invalid Gallery site URL');
  base.pathname = base.pathname.replace(/\/$/, '') + '/'; base.search = ''; base.hash = '';
  const submissionUrl = new URL(`templates/creator/${encodeURIComponent(job.submissionKey)}`, base).href;
  const publicUrl = ['approved','republish'].includes(p.action) && p.slug ? new URL(`templates/${encodeURIComponent(p.slug)}`, base).href : '';
  const subject = `[Gallery] ${copy[p.action]} · ${String(p.title || '').replace(/[\r\n]/g, ' ').slice(0, 180)}`;
  const text = `${copy.title}\n\n${copy.work}: ${p.title}\n${copy.result}: ${copy[p.action]}\n${copy.time}: ${p.decidedAt}\n${p.reason ? `\n${copy.feedback}:\n${p.reason}\n` : ''}\n${copy.open}: ${submissionUrl}\n${publicUrl ? `${copy.public}: ${publicUrl}\n` : ''}\n${copy.footer}`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f6f8;font-family:Arial,sans-serif;color:#1d2939"><main style="max-width:600px;margin:32px auto;padding:32px;background:white;border-radius:12px"><p style="color:#2458c5;font-weight:bold">Fine Gallery</p><h1 style="font-size:22px">${escape(copy.title)}</h1><h2 style="font-size:18px">${escape(p.title)}</h2><p><strong>${escape(copy.result)}:</strong> ${escape(copy[p.action])}</p><p style="color:#667085">${escape(copy.time)}: ${escape(p.decidedAt)}</p>${p.reason ? `<h3>${escape(copy.feedback)}</h3><p style="white-space:pre-wrap">${escape(p.reason)}</p>` : ''}<p><a href="${escape(submissionUrl)}">${escape(copy.open)}</a></p>${publicUrl ? `<p><a href="${escape(publicUrl)}">${escape(copy.public)}</a></p>` : ''}<hr><p style="font-size:12px;color:#667085">${escape(copy.footer)}</p></main></body></html>`;
  const domain = /@([^>\s]+)>?$/.exec(from)?.[1] || 'gallery.invalid';
  return { subject, text, html, messageId: `<gallery-${createHash('sha256').update(job.eventKey).digest('hex')}@${domain}>`, disableFileAccess: true, disableUrlAccess: true };
}
module.exports = { renderReviewEmail, validEmail };
