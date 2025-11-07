module.exports = ({ env }) => ({
  host: env('HOST', '0.0.0.0'),
  port: env.int('PORT', 1337),
  app: {
    keys: env.array('APP_KEYS'),
  },
  webhooks: {
    populateRelations: env.bool('WEBHOOKS_POPULATE_RELATIONS', false),
  },
  // 增加请求超时时间以支持大文件上传（30分钟）
  http: {
    serverOptions: {
      requestTimeout: 30 * 60 * 1000, // 30分钟
    },
  },
});
