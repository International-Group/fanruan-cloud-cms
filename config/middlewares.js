module.exports = [
  'strapi::logger',
  'strapi::errors',
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  {
    name: 'strapi::body',
    config: {
      // 主要限制
      formLimit: '2gb',
      jsonLimit: '2gb',
      textLimit: '2gb',
      formidable: {
        maxFileSize: 2 * 1024 * 1024 * 1024, // 2GB
      },
    },
  },
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
