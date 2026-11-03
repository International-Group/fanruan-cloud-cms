 'use strict';
const path = require('node:path');
module.exports = ({ env }) => ({
  accountApiUrl: env('GALLERY_ACCOUNT_API_URL', ''),
  publicUrl: env('GALLERY_PUBLIC_URL', ''), // CMS origin + /api, never the frontend origin
  reviewerIds: env.array('GALLERY_REVIEWER_IDS', []), // stable account uid, falls back to id
  storageDir: env('GALLERY_STORAGE_DIR', path.resolve(process.cwd(), 'runtime/gallery-assets')),
  signingSecret: env('GALLERY_ASSET_SECRET', ''),
  signedUrlSeconds: 900,
});
