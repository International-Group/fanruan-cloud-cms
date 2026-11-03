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
| POST | `/admin/gallery/submissions/:id/review` | action=approved/changes_requested/rejected、reason、revision；approved 另必填 renderUrl，带 Idempotency-Key |
| POST | `/admin/gallery/works/:id/unpublish`、`republish` | reason、revision，下架/恢复当前已批准版本 |
| PATCH | `/admin/gallery/works/:id/render-link` | 审核员修正当前已通过版本的渲染地址，renderUrl、submissionId、revision；保持现有上下架状态 |
| GET | `/gallery/assets/:key` | 私有签名访问，或当前公开作品/已绑定公开头像的匿名访问 |
| GET | `/gallery/works/:key/preview` | 当前公开作品的封面和截图预览 |

列表支持 `page`、`limit`（最多 100），投稿列表另支持 `status`。批量审核仅提供退回修改和拒绝；批准发布须逐件填写并检查对应渲染连结。

## 数据与发布

新增五个隐藏业务模型：gallery-profile、gallery-submission、gallery-work、gallery-asset、gallery-operation。没有通用 CRUD 路由；owner、私有快照等字段标记 private。数据库唯一索引保证账号资料、公开 handle、幂等键及同一作品最多一个活动更新版本。

写操作采用 revision 比较更新，冲突返回 409。幂等键按账号和操作路径隔离，同键不同参数返回 409。审核操作与 Template 发布放在同一数据库事务，失败会回滚审核状态、发布结果、媒体记录和幂等记录，可用原键重试。实现依照 [Strapi 5 数据库事务约定](https://docs-v5.strapi.io/cms/database-transactions)。

外部投稿发布时固定 source=Competition，description 保存可读 Unicode 原文。Gallery 的三个作品详情入口对带 creator_handle 的作者简介使用 React 纯文本渲染，不交给 MDX 编译；内部编辑内容继续沿用原有 MDX 路径。

批准作品时创建/更新现有 Template，写入 thumbnail、templateFile、SEO、下载地址及作者 handle。Template 继续使用现有生命周期与 slug 历史逻辑。新增 `creator_handle` 提供前端作者链接；`gallery_work_key` 为内部关联。更新作品发布时沿用原 Template documentId，保留收藏关联；待审或被拒绝的更新不替换公开版本。公开作者资料使用白名单输出，不包含 goals、账号信息、审核记录、隐藏国家及关闭联系入口时的 contactUrl。

批准前必须填写真实部署后的公开 HTTPS 渲染页面，后端拒绝缺失地址、Gallery 图片预览、图片/附件直链、本机地址及带帐号密码的 URL。`template_link` 写入审核员提供的地址，不再自动填入 `/gallery/works/:key/preview`。新版本不能沿用旧版未确认的地址。当前已通过版本支持修改地址，旧版本不可覆盖当前版本；下架作品修改地址不会自动上架，恢复发布也必须有有效地址。审核记录保留变更动作。

旧的 `/gallery/works/:key/preview` 只为兼容已有作品保留封面/截图展示，不是渲染服务。已有发布数据不会自动下架或批量改写；审核员应逐件补上真实连结。CMS 不执行模板，不请求任意用户网址；URL 校验只检查格式和已知占位地址，审核员须实际检查可运行与可嵌入性。FineBI/FineReport/FineVis 的部署仍在对应产品环境完成。

模板文件按产品扩展名、100 MB 上限及 ZIP 结构/XML 文件头验证；不会执行或解压上传内容。封面/截图/头像 PNG/JPEG/WebP 最大 5 MB，经解码重新编码为 WebP，截图最多五张。

## 验证

使用项目支持的 Node 20/22：

```sh
npm run test:gallery
npm test
```

HTTP 集成测试创建临时 Strapi、SQLite、文件目录和测试账号服务，启动前断言应用目录/数据库目录都在临时目录，并禁止读取项目 `.env`。验证身份与归属、资料唯一地址、图片归属、私有文件访问、上传校验、revision 竞争、幂等、审核反馈、发布失败回滚、公开白名单、更新版本与上下架。


## 修复旧投稿元数据（本地）

使用 `node scripts/repair-gallery-template-metadata.js --sqlite /absolute/path/data/database.db` 预览；追加 `--apply` 才会应用。命令强制核对 SQLite 路径，并在应用前备份至 `runtime/gallery-backups`。修复仅针对 gallery_work_key 对应当前已批准投稿的 Template 记录（草稿和公开版分别处理），固定 source=Competition；仅当旧简介严格等于原投稿经旧字符实体编码后的结果时还原原文，不覆盖 CMS 中额外编辑的简介。条件更新防止并发覆盖，整个修复在数据库事务中执行，不改变作品上下架状态或渲染链接。


## 审核结果邮件

批准发布、退回修改、拒绝、下架及恢复发布时，在相同数据库事务中新增私有邮件 outbox 记录。SMTP 发送由后台 worker 处理，约每 30 秒扫描一次，不在审核请求中发信。发送失败不会撤销审核结果；数据库事务失败时也不会留下待发送的虚假审核结果。

配置：`GALLERY_MAIL_ENABLED=true`，填写 `GALLERY_MAIL_HOST/PORT/SECURE/USER/PASS/FROM`，可复用统一账号服务 SMTP。`GALLERY_SITE_URL` 为邮件中作品链接的 Gallery 前端根地址，本地为 `http://localhost:3000`，生产部署时须改为实际站点 HTTPS 地址。465 使用隐式 TLS，587 使用强制 STARTTLS；不关闭证书校验。参考 [Nodemailer SMTP 配置](https://nodemailer.com/smtp)。密钥只保留在后端环境，不放入前端或日志。

收件地址只从账号服务成功验证的 `/user/profile` 响应同步至隐藏 gallery-contact 模型，并要求 emailVerified=true。前端和审核员不能指定、覆盖收件人。未验证邮箱或旧投稿尚无联系资料时，通知保留为 blocked，创作者使用已验证邮箱登录 Gallery 后会自动恢复。账号令牌不持久保存。公开作者主页和投稿 DTO 不包含邮箱。

新增隐藏 gallery-notification 模型保存事件快照、发送状态、租约和重试时间，没有通用 CRUD 路由。使用审核记录 ID 作为唯一事件键，幂等审核重放不重复入队；发送租约防止多实例同时处理同一任务，崩溃后的过期租约可以恢复。每轮最多自动尝试 8 次，1 分钟起指数退避、最长间隔 6 小时。之前尚未发送的同一投稿旧结果会被新结果取代。SMTP 在“服务端已经接受，但客户端未记录成功”的断连窗口下仍可能重复投递，使用固定 Message-ID 降低重复影响；不能承诺 SMTP 严格 exactly-once。

`Submission.emailNotification` 包含最新通知的 status、action、attempts、sentAt、nextAttemptAt、errorCode，不返回邮箱或 SMTP 错误详情。作者和审核员可通过各自权限范围的 `GET /gallery/submissions/:id/notifications`、`GET /admin/gallery/submissions/:id/notifications` 刷新状态。审核员可调用 `POST /admin/gallery/submissions/:id/notifications/retry` 重试 failed/blocked 通知，sent/pending/sending 不允许重复重试。页面每 15 秒轻量刷新状态，不重新加载或清空编辑表单。

通知从接入后的后续审核操作开始产生，不批量补发历史审核。邮件以作者送审时的页面语言为优先，支持英文、繁体中文和韩文，包含作品名称、处理结果、原因、处理时间和站内链接；不包含私人附件或临时下载链接。后台不记录邮箱、SMTP 密码或原始 SMTP 响应。

测试使用隔离 SQLite、模拟邮件传输和 Nodemailer JSON transport，不连接真实 SMTP，也不投递真实邮件；覆盖事务回滚、幂等重放、发送失败及手动重试、邮箱验证保护、多 worker 竞争、崩溃租约恢复和 HTML/邮件头注入保护。


## Strapi 作者运营

在 Content Manager 中使用 **Gallery 作者运营** 和 **Gallery 作者勋章** 两个集合。原来的 Author 集合继续用于文章作者，不与 Gallery 统一账号混用。已有 Gallery 公开资料的作者会在启动时回填，新作者保存资料时自动收录；原环境审核员名单也会迁移为后台可管理的账号记录。账号 UID 是稳定绑定，创建后不可改；名称、主页标识、国家/地区、职业、组织从作者资料同步。为没有公开主页的审核员，可在作者运营集合手动填入统一账号 UID 创建权限记录。

作者字段：

- **允许投稿 canSubmit**：默认开启。关闭后，新建草稿、作品文件上传、送审和创建更新版本都由后端拒绝；本人仍可查看作品/反馈、修改个人资料及已有草稿文字。已公开作品不会自动下架。
- **允许审核作品 canReview**：默认关闭；开启后可访问 Gallery 审核工作台、处理审核、上下架、修改渲染地址、重试邮件。后台记录存在时以此字段为准，关闭后不会被旧 GALLERY_REVIEWER_IDS 配置重新开启。环境名单只用于首次迁移/尚无运营记录的兼容引导。
- **作者勋章 badges**：多选，纯展示。名称支持默认语言、繁体中文和韩文，颜色为限定枚举。关闭勋章 enabled 后会从所有公开主页隐藏，不删除授予关系。勋章不授予投稿、审核或 CMS 权限。
- **内部标签和运营备注**：仅后台使用，不进入公开作者接口。

作者运营/勋章模型没有通用 Content API 路由，统一账号用户不能给自己改权限或发勋章；资料保存只同步身份字段，不重置运营设置。Content Manager 的操作仍由 Strapi 管理员及其 RBAC 角色控制；需要后台运营权限的同事应在 Strapi 管理员角色中获得这两个集合对应的读写权限。为避免权限重置，不删除作者运营记录，使用权限开关停用相应能力。

公开作者响应只新增白名单 badges 数组（code/name/nameZhTw/nameKo/description/color），不返回 UID、权限、内部备注、标签或勋章反向作者关系。普通账号提交伪造 badges/canReview/canSubmit 字段不会改变后台设置。

本地初始化：`node scripts/init-gallery-creators.js --apply --sqlite /absolute/path/data/database.db`。先备份，再创建/回填运营记录和三个未授予的示例勋章；不监听 HTTP 端口，不发送通知邮件，也不重置已有权限或授予状态。正常启动只同步作者及兼容旧审核员，不重新创建被运营人员移除的示例勋章。
