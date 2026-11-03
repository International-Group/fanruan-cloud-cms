# Gallery 后端接入

实现目录：`src/api/gallery`；接口前缀 `/api`。直接匹配 Gallery 前端现有 `lib/gallery/submissions.ts`、`creators.ts` 的契约。收藏和账号信息仍由账号服务处理，不在 CMS 重建第二套收藏/账号系统。

## 配置

将 `.env.gallery.example` 中的配置合并到部署环境（不要覆盖已有 Strapi 密钥）。

- `GALLERY_ACCOUNT_API_URL`：现有账号服务基础地址。认证策略将 Bearer 令牌发送到该地址的 `GET /user/profile`，使用响应的 `uid`（否则 `id`）确定所有者。只接受成功的服务端验证，不从未验证 JWT 或请求体取身份；401 由前端原有刷新逻辑处理。该地址必须由运维固定配置。
- `GALLERY_PUBLIC_URL`：浏览器能访问的 CMS 地址，**包含 `/api`**。生产使用 HTTPS，本地支持 `http://localhost:1337/api`。
- `GALLERY_REVIEWER_IDS`：审核员的稳定账号 uid/id，用逗号分隔。默认空，所有普通账号均无审核权限；不根据邮箱、前端 query 或 CMS API token 授权。
- `GALLERY_ASSET_SECRET`：至少 32 字符的随机密钥，可使用 `openssl rand -hex 32` 生成。仅用于私有附件限时 URL，不放进前端。
- `GALLERY_STORAGE_DIR`：私有文件目录，默认 `runtime/gallery-assets`，**必须在 public 之外**。运行用户需要读写权限。备份时同时备份数据库和此目录。

前端 `.env.local` 设置 `NEXT_PUBLIC_GALLERY_API_URL=http://localhost:1337/api`，重启 Next.js 后生效。前端通过原有账号服务登录，不使用 CMS 公共 API token。

### 部署文件持久化

现有部署脚本仅挂载 `public/uploads`，新增私有目录必须另行挂载。例如 Docker 增加 `--mount type=bind,source=/srv/cms/gallery-private,target=/app/runtime/gallery-assets`，并给容器 node 用户读写权限。**不要把私有目录放进 public/uploads**。多实例必须共享同一文件目录和签名密钥。此任务未部署线上服务、未修改线上环境。

当前为保留审核与版本追溯，上传记录和文件不会自动删除。已解绑头像、替换附件、删除草稿后的文件也保留在私有目录；清理时必须核对所有投稿快照及头像引用。签名链接最长有效 15 分钟；下架立即停止匿名永久链接访问，已经签发的私有链接会在到期后失效。

## 接口

所有 JSON 成功响应为 `{ data: ... }`；删除成功为 204。失败使用 Strapi 标准 `{ data: null, error: ... }`，区分 401、403、404、409、422、503。私人接口返回 `Cache-Control: private, no-store`。

| 方法 | 路径（不含 `/api`） | 说明 |
| --- | --- | --- |
| GET | `/gallery/me` | canReview / needsOnboarding / profileHandle |
| GET / PUT | `/gallery/profile/me` | 读取本人完整资料 / 带 revision 保存 |
| POST | `/gallery/profile/avatar`、`/gallery/profile/banner` | multipart `file`，带 Idempotency-Key；暂存图片，不提前完成资料 |
| GET | `/gallery/creators/:handle` | 匿名公开资料、已发布作品、分页；product、sort=newest/popular、page、limit |
| GET / POST | `/gallery/submissions` | 本人分页列表 / 创建草稿，创建带 Idempotency-Key、revision=0 |
| GET / PATCH / DELETE | `/gallery/submissions/:id` | 本人详情 / 更新可编辑版本 / 删除草稿；写操作带 revision |
| POST | `/gallery/submissions/:id/assets` | multipart file、kind、revision，带 Idempotency-Key |
| DELETE | `/gallery/submissions/:id/assets/:assetId` | 删除可编辑快照的附件引用，带 revision |
| POST | `/gallery/submissions/:id/submit` | 带 revision、Idempotency-Key，校验后送审 |
| POST | `/gallery/submissions/:id/withdraw` | 带 revision，撤回待审核版本为草稿 |
| POST | `/gallery/works/:id/revisions` | 为本人作品创建更新草稿，已有活动版本时返回已有版本 |
| GET | `/admin/gallery/submissions`、`/admin/gallery/submissions/:id` | 审核员列表 / 详情 |
| POST | `/admin/gallery/submissions/:id/review` | action=approved/changes_requested/rejected、reason、revision，带 Idempotency-Key |
| POST | `/admin/gallery/works/:id/unpublish`、`republish` | reason、revision，下架/恢复当前已批准版本 |
| GET | `/gallery/assets/:key` | 私有签名访问，或当前公开作品/已绑定公开头像的匿名访问 |
| GET | `/gallery/works/:key/preview` | 当前公开作品的封面和截图预览 |

列表支持 `page`、`limit`（最多 100），投稿列表另支持 `status`。前端现有批量审核逐条调用 review 即可。

## 数据与发布

新增五个隐藏业务模型：gallery-profile、gallery-submission、gallery-work、gallery-asset、gallery-operation。没有通用 CRUD 路由；owner、私有快照等字段标记 private。数据库唯一索引保证账号资料、公开 handle、幂等键及同一作品最多一个活动更新版本。

写操作采用 revision 比较更新，冲突返回 409。幂等键按账号和操作路径隔离，同键不同参数返回 409。审核操作与 Template 发布放在同一数据库事务，失败会回滚审核状态、发布结果、媒体记录和幂等记录，可用原键重试。实现依照 [Strapi 5 数据库事务约定](https://docs-v5.strapi.io/cms/database-transactions)。

现有前端会将 Template.description 交给 MDX 服务端编译，因此发布时将投稿简介编码为纯文本字符引用，禁止将用户输入当作 JSX、表达式或 ESM 执行；私人投稿快照仍保留原始可编辑文本。

批准作品时创建/更新现有 Template，写入 thumbnail、templateFile、SEO、下载地址及作者 handle。Template 继续使用现有生命周期与 slug 历史逻辑。新增 `creator_handle` 提供前端作者链接；`gallery_work_key` 为内部关联。更新作品发布时沿用原 Template documentId，保留收藏关联；待审或被拒绝的更新不替换公开版本。公开作者资料使用白名单输出，不包含 goals、账号信息、审核记录、隐藏国家及关闭联系入口时的 contactUrl。

预览目前是**封面/截图 HTML 展示**，不会执行上传的 BI/报表文件。自动部署 FineBI/FineReport/FineVis 运行环境不属于此接口实现；需另行连接对应产品的发布服务。模板文件按产品扩展名、100 MB 上限及 ZIP 结构/XML 文件头验证；不会执行或解压上传内容。封面/截图/头像 PNG/JPEG/WebP 最大 5 MB，经解码重新编码为 WebP，截图最多五张。

## 验证

使用项目支持的 Node 20/22：

```sh
npm run test:gallery
npm test
```

HTTP 集成测试创建临时 Strapi、SQLite、文件目录和测试账号服务，启动前断言应用目录/数据库目录都在临时目录，并禁止读取项目 `.env`。验证身份与归属、资料唯一地址、图片归属、私有文件访问、上传校验、revision 竞争、幂等、审核反馈、发布失败回滚、公开白名单、更新版本与上下架。
