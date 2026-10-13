# 🚀 Getting started with Strapi

Strapi comes with a full featured [Command Line Interface](https://docs.strapi.io/dev-docs/cli) (CLI) which lets you scaffold and manage your project in seconds.

### `develop`

Start your Strapi application with autoReload enabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-develop)

```
npm run develop
# or
yarn develop
```

### `start`

Start your Strapi application with autoReload disabled. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-start)

```
npm run start
# or
yarn start
```

### `build`

Build your admin panel. [Learn more](https://docs.strapi.io/dev-docs/cli#strapi-build)

```
npm run build
# or
yarn build
```

## ⚙️ Deployment

Strapi gives you many possible deployment options for your project including [Strapi Cloud](https://cloud.strapi.io). Browse the [deployment section of the documentation](https://docs.strapi.io/dev-docs/deployment) to find the best solution for your use case.

```
yarn strapi deploy
```

## JianDaoYun synchronization

Whenever a Template is saved or published, Strapi queries JianDaoYun with an
`zh_template_id AND language` filter. `zh_template_id` uses the official
`number` filter type, and `language` uses the official `text` filter type.
Language values are mapped as `en-us → English`, `zh-tw → 繁体`, and
`ko-kr → 한국의`. Zero or multiple matches are treated as errors.

For the unique match, Strapi uses its `_id` as `data_id` and updates both the
Template `download_link` and `https://gallery.fanruan.com/{slug}` in one API
request. After a successful first publish it also writes `publish_date`; later
edits and republishes preserve the existing date.
Successful, skipped, and failed synchronization attempts are written to the
Strapi server log with the `zh_template_id` and relevant JianDaoYun details.

Configure the integration with these environment variables:

```text
JIANDAOYUN_API_KEY=
JIANDAOYUN_APP_ID=
JIANDAOYUN_ENTRY_ID=
```

The following variables are optional:

```text
JIANDAOYUN_DATA_LIST_API_URL=https://api.jiandaoyun.com/api/v5/app/entry/data/list
JIANDAOYUN_DATA_UPDATE_API_URL=https://api.jiandaoyun.com/api/v5/app/entry/data/update
JIANDAOYUN_ZH_TEMPLATE_ID_FIELD=_widget_1773888010278
JIANDAOYUN_NEW_FILE_LINK_FIELD=_widget_1770019599166
JIANDAOYUN_PUBLISHED_LINK_FIELD=_widget_1779852152157
JIANDAOYUN_LANGUAGE_FIELD=_widget_1770003814387
JIANDAOYUN_PUBLISH_DATE_FIELD=publish_date
TEMPLATE_PUBLIC_BASE_URL=https://gallery.fanruan.com
```

## Template slug redirects

Template Document Service mutations reserve every published slug in the
`Template Slug History` collection, mapped to the stable Template `documentId`.
Saving a draft does not activate a redirect. Publishing a renamed template
also captures its previous published slug, including templates that existed
before this feature was deployed. Unpublishing preserves history for later
republishing. Other templates cannot reuse reserved slugs.

`GET /api/templates/resolve-slug/:slug` returns `{ "data": { "slug": "current-slug" } }`
for a current or historical slug belonging to a published, public template.
Unknown, deleted, private, delisted, pending, or unpublished templates return
404. The optional `language` query parameter limits the target language.
The route is public and exposes only the current slug; history has no generated
Content API routes. Historical entries can be added through the admin collection
using `slug` and `templateDocumentId` when recovering earlier URLs from backups.

Deploy/restart the CMS first so Strapi creates the history collection, then
deploy the Community frontend. Its Next.js proxy requests this endpoint before
rendering and returns HTTP 301 to the latest slug, retaining the route prefix
and all query parameters. The frontend uses `NEXT_PUBLIC_CMS_API_URL` and needs
no additional API token permissions. CMS lookup failures fall through to the
existing page handling. Slugs lost before deployment must be supplied manually.

## 📚 Learn more

- [Resource center](https://strapi.io/resource-center) - Strapi resource center.
- [Strapi documentation](https://docs.strapi.io) - Official Strapi documentation.
- [Strapi tutorials](https://strapi.io/tutorials) - List of tutorials made by the core team and the community.
- [Strapi blog](https://strapi.io/blog) - Official Strapi blog containing articles made by the Strapi team and the community.
- [Changelog](https://strapi.io/changelog) - Find out about the Strapi product updates, new features and general improvements.

Feel free to check out the [Strapi GitHub repository](https://github.com/strapi/strapi). Your feedback and contributions are welcome!

## ✨ Community

- [Discord](https://discord.strapi.io) - Come chat with the Strapi community including the core team.
- [Forum](https://forum.strapi.io/) - Place to discuss, ask questions and find answers, show your Strapi project and get feedback or just talk with other Community members.
- [Awesome Strapi](https://github.com/strapi/awesome-strapi) - A curated list of awesome things related to Strapi.

---

<sub>🤫 Psst! [Strapi is hiring](https://strapi.io/careers).</sub>
