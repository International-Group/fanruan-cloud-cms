 'use strict';
const path = require('node:path');
module.exports = ({ env }) => ({
  accountApiUrl: env('GALLERY_ACCOUNT_API_URL', ''),
  publicUrl: env('GALLERY_PUBLIC_URL', ''), // CMS origin + /api, never the frontend origin
  reviewerIds: env.array('GALLERY_REVIEWER_IDS', []), // stable account uid, falls back to id
  storageDir: env('GALLERY_STORAGE_DIR', path.resolve(process.cwd(), 'runtime/gallery-assets')),
  signingSecret: env('GALLERY_ASSET_SECRET', ''),
  signedUrlSeconds: 900,
  siteUrl: env('GALLERY_SITE_URL', 'http://localhost:3000'),
  mail: {
    enabled: env.bool('GALLERY_MAIL_ENABLED', false),
    host: env('GALLERY_MAIL_HOST', ''), port: env.int('GALLERY_MAIL_PORT', 587),
    secure: env.bool('GALLERY_MAIL_SECURE', env.int('GALLERY_MAIL_PORT', 587) == 465),
    user: env('GALLERY_MAIL_USER', ''), pass: env('GALLERY_MAIL_PASS', ''),
    from: env('GALLERY_MAIL_FROM', ''),
    intervalMs: 30000, maxAttempts: 8,
  },
});
