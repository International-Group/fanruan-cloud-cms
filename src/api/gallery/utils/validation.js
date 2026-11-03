 'use strict';
const template = require('../../template/content-types/template/schema.json');
const goals = ['learn', 'find_templates', 'share_work', 'find_opportunities', 'build_portfolio', 'explore'];
const socials = ['linkedin', 'bluesky', 'facebook', 'x'];
const fields = ['title', 'description', 'product', 'supportedVersion', 'language', 'industry', 'scenario', 'instructions', 'authorName'];
const fail = (status, message) => { const error = new Error(message); error.status = status; error.expose = true; throw error; };
const text = (value, max, field, required = false) => {
  if (value === undefined) value = '';
  if (typeof value !== 'string' || value.length > max || /\u0000/.test(value) || (required && !value.trim())) fail(422, `Invalid ${field}`);
  return value.trim();
};
const revision = value => { if (!Number.isSafeInteger(value) || value < 0) fail(422, 'revision must be a nonnegative integer'); return value; };
const link = (value, field, allowLocal = false) => {
  const result = text(value, 2048, field);
  if (!result) return '';
  try { const u = new URL(result); if ((u.protocol === 'https:' || (allowLocal && u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname))) && !u.username && !u.password) return u.href; } catch {}
  fail(422, `${field} must be an HTTPS URL`);
};
const draft = input => {
  const result = {};
  for (const f of fields) result[f] = text(input[f], ['description', 'instructions'].includes(f) ? 20000 : 200, f);
  for (const f of ['product', 'language', 'industry', 'scenario']) if (!template.attributes[f].enum.includes(result[f])) fail(422, `Invalid ${f}`);
  if (typeof input.rightsConfirmed !== 'boolean') fail(422, 'Invalid rightsConfirmed');
  result.submissionType = input.submissionType === undefined ? 'file' : input.submissionType;
  if (!['file', 'link'].includes(result.submissionType)) fail(422, 'Invalid submissionType');
  // Drafts may retain an incomplete address; submission and approval validate the page URL.
  result.submittedRenderUrl = text(input.submittedRenderUrl, 2048, 'submittedRenderUrl');
  result.rightsConfirmed = input.rightsConfirmed;
  return result;
};
const ready = payload => {
  for (const f of ['title', 'description', 'product', 'supportedVersion', 'language', 'industry', 'scenario', 'authorName']) if (!payload[f]) fail(422, `${f} is required`);
  if (!payload.rightsConfirmed) fail(422, 'Distribution rights must be confirmed');
  if (!payload.assets.some(a => a.kind === 'cover')) fail(422, 'Cover is required');
  if (payload.submissionType === 'link') renderUrl(payload.submittedRenderUrl);
  else if (!payload.assets.some(a => a.kind === 'template')) fail(422, 'Template file is required');
};
const profile = input => {
  const handle = text(input.handle, 30, 'handle', true);
  if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(handle)) fail(422, 'Invalid handle');
  const country = text(input.country, 2, 'country', true);
  if (!/^[A-Z]{2}$/.test(country)) fail(422, 'Invalid country');
  if (!Array.isArray(input.goals) || !input.goals.length || input.goals.some(g => !goals.includes(g))) fail(422, 'Invalid goals');
  for (const f of ['showCountry', 'hireMe']) if (typeof input[f] !== 'boolean') fail(422, `Invalid ${f}`);
  const result = { handle, country, displayName: text(input.displayName, 100, 'displayName', true), job: text(input.job, 100, 'job', true), bio: text(input.bio, 600, 'bio'), organization: text(input.organization, 200, 'organization'), avatarUrl: link(input.avatarUrl, 'avatarUrl', true), bannerUrl: link(input.bannerUrl, 'bannerUrl', true), website: link(input.website, 'website'), contactUrl: link(input.contactUrl, 'contactUrl'), goals: [...new Set(input.goals)], showCountry: input.showCountry, hireMe: input.hireMe, socialLinks: {}, onboardingCompleted: true };
  if (result.hireMe && !result.contactUrl) fail(422, 'Contact URL is required');
  for (const f of socials) result.socialLinks[f] = link(input.socialLinks?.[f], f);
  return result;
};
const publicProfile = p => ({ handle: p.handle, displayName: p.displayName, bio: p.bio, avatarUrl: /\/gallery\/assets\//i.test(p.avatarUrl || '') ? '' : p.avatarUrl, bannerUrl: p.bannerUrl, job: p.job, organization: p.organization, socialLinks: p.socialLinks, website: p.website, hireMe: p.hireMe, ...(p.showCountry ? { country: p.country } : {}), ...(p.hireMe ? { contactUrl: p.contactUrl } : {}) });
const page = (value, fallback, max) => { const n = value === undefined ? fallback : Number(value); if (!Number.isSafeInteger(n) || n < 1 || n > max) fail(422, 'Invalid pagination'); return n; };
// Validate syntax only. Reviewers must check the deployed page and iframe compatibility.
// Never fetch a reviewer-supplied URL from the CMS server (avoids SSRF).
const renderUrl = value => {
  const result = link(value, 'renderUrl');
  if (!result) fail(422, 'A deployed rendering URL is required before publication');
  const u = new URL(result);
  if (u.hostname === 'localhost' || u.hostname.endsWith('.localhost') || u.hostname.endsWith('.local') || !u.hostname.includes('.') || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname) || /\/gallery\/(?:works|assets)(?:\/|$)/i.test(u.pathname) || /\.(?:png|jpe?g|webp|gif|svg|mbi|mfvs|fvs|cpt|cptx|frmx|zip)$/i.test(u.pathname)) fail(422, 'Use a deployed rendering page, not a Gallery image preview or file URL');
  return result;
};
module.exports = { profileAvatar: value => link(value, 'avatarUrl', true), renderUrl, fail, text, revision, draft, ready, profile, publicProfile, page };
