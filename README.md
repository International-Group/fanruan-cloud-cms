生产发布和回滚请参阅 [自动化部署说明](deploy/README.md)。

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

## Template Preview

Configure the CMS server environment:

```text
CLIENT_URL=https://gallery.fanruan.com
PREVIEW_SECRET=<random secret shared with the frontend server>
PREVIEW_TEMPLATE_VIEW=gallery
```

Preview is enabled only when both `CLIENT_URL` and `PREVIEW_SECRET` are set.
For local development use `CLIENT_URL=http://localhost:3000`. The optional
`PREVIEW_TEMPLATE_VIEW` can be `gallery`, `bi`, or `fvs`.
Restart the CMS after configuring these variables.

In Strapi Settings → API Tokens, create a dedicated Read-only token (or a custom
token with Template `findOne` and the read permissions needed for media).
Configure the Community frontend server with the same `PREVIEW_SECRET`,
`CMS_PREVIEW_TOKEN=<that token>`, and `CMS_API_URL=<this CMS origin>`.
The token and secret must never use a `NEXT_PUBLIC_` prefix.

Save a Template draft with a slug, then click Preview to view it in the frontend.
The preview handler identifies documents by `documentId`, so newly created
drafts and renamed slugs work before publishing. Draft Content API requests
require both valid API-token authentication and an `X-Template-Preview-Secret`
header matching `PREVIEW_SECRET`; ordinary published reads remain unchanged.
The frontend disables view/share/download effects and GTM during preview,
provides an Exit preview link, and expires the signed preview session after
one hour. Preview has no effect on publishing or slug history.

## Dora 场景资源库

在 Strapi 内容管理器中编辑 **Dora 场景资源库**。场景支持草稿和发布，每条可关联多个行业和业务域。分类在 **Dora 行业** 和 **Dora 业务域** 中维护，前端用分类的 `slug` 筛选。

- 三个集合都支持 Strapi 多语言。切换场景的语言版本后，从同一语言的行业和业务域中选择关联。翻译同一分类时沿用原 `slug`，例如 `manufacturing`。
- 场景列表 `GET /api/dora-scenarios`，详情 `GET /api/dora-scenarios/:documentId`。
- 分类列表 `GET /api/dora-industries` 和 `GET /api/dora-business-domains`。
- 三个接口都接受 `locale`，使用 Strapi 配置里的语言代码。繁中台湾使用 `zh-Hant-TW`，省略参数时读取 Strapi 的默认语言。
- 使用现有的 Content API 认证。自定义只读令牌需要场景的 `find`、`findOne`，以及两个分类的 `find` 权限。

列表查询示例。同一分类内的多个选项取并集，行业与业务域之间取交集。

```js
const query = qs.stringify({
  locale: 'zh-Hant-TW',
  fields: ['title', 'description', 'company'],
  filters: {
    industries: { slug: { $in: ['manufacturing', 'consumer'] } },
    businessDomains: { slug: { $in: ['supply-chain'] } },
  },
  populate: ['industries', 'businessDomains', 'cover', 'companyLogo', 'tags'],
}, { encodeValuesOnly: true });
```

详情请求可用 `?populate=*` 带回分类、图片和标签。Markdown 正文在 `content` 字段，标签是 `[{ tag: "供应链分析" }]` 这样的组件列表。

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
