'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const nodemailer = require('nodemailer');
const { renderReviewEmail, validEmail } = require('../src/api/gallery/utils/review-email');
const job = action => ({ eventKey: 'review:fixed-event', submissionKey: 'work-123', payload: { action, locale: 'zh-tw', title: '作品 <script>alert(1)</script>\r\nBcc: other@example.test', reason: '請修改 <img src=x onerror="run()">\n第二行', slug: 'published-work', decidedAt: '2026-11-03T04:00:00Z' } });

test('all review outcomes have escaped HTML and text with safe Gallery links', () => {
  for (const action of ['approved','changes_requested','rejected','unpublish','republish']) {
    const result = renderReviewEmail(job(action), 'https://gallery.example.test', 'Gallery <notify@example.test>');
    assert.ok(!/[\r\n]/.test(result.subject));
    assert.ok(!result.html.includes('<script>'));
    assert.ok(result.html.includes('&lt;script&gt;'));
    assert.ok(!result.html.includes('<img src=x'));
    assert.ok(result.text.includes('https://gallery.example.test/templates/creator/work-123'));
    assert.equal(result.text.includes('https://gallery.example.test/templates/published-work'), ['approved','republish'].includes(action));
    assert.ok(result.text.includes('第二行'));
    assert.equal(result.disableFileAccess, true);
    assert.equal(result.disableUrlAccess, true);
  }
  assert.throws(() => renderReviewEmail(job('approved'), 'javascript:alert(1)', 'notify@example.test'));
  assert.equal(renderReviewEmail(job('approved'), 'https://gallery.example.test', 'notify@example.test').messageId, renderReviewEmail(job('approved'), 'https://gallery.example.test', 'notify@example.test').messageId);
});

test('Nodemailer builds the notification without fetching URLs or sending external mail', async () => {
  const content = renderReviewEmail(job('approved'), 'https://gallery.example.test', 'notify@example.test');
  const transport = nodemailer.createTransport({ jsonTransport: true });
  const result = await transport.sendMail({ ...content, from: 'notify@example.test', to: 'creator@example.test' });
  const message = JSON.parse(result.message);
  assert.equal(message.to[0].address, 'creator@example.test');
  assert.ok(message.html.includes('Gallery'));
  assert.equal(message.messageId, content.messageId);
});

test('notification addresses cannot contain header injection or multiple recipients', () => {
  for (const email of ['a@example.test\r\nBcc: x@example.test', 'a@example.test,b@example.test', '<a@example.test>', undefined]) assert.equal(validEmail(email), false);
  assert.equal(validEmail('creator@example.test'), true);
});
