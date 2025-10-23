export default [
  'strapi::logger',
  'strapi::errors',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            'https://intl-media.fanruan.com/',
            'https://market-assets.strapi.io',
          ],
          'media-src': [
            "'self'",
            'data:',
            'blob:',
            'https://intl-media.fanruan.com/',
          ],
          'connect-src': [
            "'self'",
            'https://intl-media.fanruan.com/',
            'https://market-assets.strapi.io',
          ]
        },
      },
    },
  }  
];
