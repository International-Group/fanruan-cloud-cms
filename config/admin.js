module.exports = ({ env }) => ({
  auth: {
    secret: env('ADMIN_JWT_SECRET'),
  },
  apiToken: {
    salt: env('API_TOKEN_SALT'),
  },
  transfer: {
    token: {
      salt: env('TRANSFER_TOKEN_SALT'),
    },
  },
  flags: {
    nps: env.bool('FLAG_NPS', true),
    promoteEE: env.bool('FLAG_PROMOTE_EE', true),
  },
  preview: {
    enabled: Boolean(env('CLIENT_URL') && env('PREVIEW_SECRET')),
    config: {
      allowedOrigins: env('CLIENT_URL', 'http://localhost:3000'),
      async handler(uid, { documentId, status }) {
        if (uid !== 'api::template.template' || !documentId) return null;
        const url = new URL('/api/preview', env('CLIENT_URL'));
        url.search = new URLSearchParams({
          documentId,
          status: status === 'published' ? 'published' : 'draft',
          secret: env('PREVIEW_SECRET'),
          view: env('PREVIEW_TEMPLATE_VIEW', 'gallery'),
        }).toString();
        return url.toString();
      },
    },
  },
});
