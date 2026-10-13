'use strict';

module.exports = {
  routes: [{
    method: 'GET',
    path: '/templates/resolve-slug/:slug',
    handler: 'template.resolveSlug',
    // Public lookup exposes only the slug of a published, public template.
    config: { auth: false },
  }],
};
