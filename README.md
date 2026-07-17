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

When a Template's `download_link` is updated, Strapi queries JianDaoYun by
`zh_template_id`, then locally selects the record by `language`. Language values
are mapped as `en-us → English`, `zh-tw → 繁体`, and `ko-kr → 한국의`. It then
uses the matched record `_id` as `data_id` and updates its `new_file_link` field.
After a Template is published, the same hook also writes
`https://gallery.fanruan.com/{slug}` to `_widget_1779852152157`.
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
```

If the JianDaoYun API requires fields' `_widget_...` identifiers instead of
their names, set those identifiers in `JIANDAOYUN_ZH_TEMPLATE_ID_FIELD` and
`JIANDAOYUN_NEW_FILE_LINK_FIELD`.

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
