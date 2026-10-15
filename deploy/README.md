# CMS 标准自动化部署

仓库：`International-Group/fanruan-cloud-cms`。线上：<https://intl-cms.fanruan.com/admin>。

## 发布和回滚

- PR 运行应用测试、发布恢复测试，并在 GitHub runner 构建实际生产镜像。
- 合入 `main` 后，Actions 再次测试、构建并推送 GHCR，服务器只按不可变 SHA256 digest 拉取镜像，不拉源码、不安装依赖、不构建管理页面。
- **CMS release** → `main` → `mode=stage` 仅验证镜像、内容模型和数据库连接。预检不启动 Strapi，不同步数据库结构，不运行队列、定时任务或 bootstrap。
- `mode=deploy` 或 main 自动发布：再次预检 → 为本 CMS 数据库生成并验证压缩备份 → 停止旧实例 → 启动新实例 → 检查数据库健康、版本、管理页面、JS/CSS 和已有管理员。切换有短暂中断。
- **CMS rollback** 填写当前 `/healthz` 的 `releaseId`，恢复记录中的上一版本，无需重新构建。发布与回滚共用 concurrency 和服务器锁，禁止互相打断。
- `DEPLOY_ENABLED=false` 暂停上线切换，仍可运行 CI 和构建镜像。

健康接口：<https://intl-cms.fanruan.com/healthz>，包含 release ID、提交及数据库就绪状态。原有 `/_health` 继续可用。

首次迁移强制要求镜像的内容模型哈希及 Strapi 版本与旧容器一致。后续数据库结构变更必须单独审阅并保持对上一版的兼容；自动回滚仅恢复应用，不回滚数据库或用户新写入的数据。不要把删除字段、数据库升级与常规代码发布混在一起。

## 数据与运行配置

- 镜像包含构建好的管理页面和源码，以非 root 用户运行；生产不再挂载 `src`、`config` 或 `.env` 源文件。
- 上传目录保持为 `/home/ubuntu/fanruan-cloud-cms/public/uploads`，挂载到 `/app/public/uploads`；现有对象存储及数据库配置沿用。数据库和媒体不放在容器可写层。
- 运行目录：`/opt/fanruan/fanruan-cloud-cms/runtime`，root 管理，包含 `app.env`、`state.json`、`pending.json`、`transaction.json`、`releases/`、`backups/`、`database/` 和 `deploy.log`。
- 每次部署的数据库备份保留最近两份；独立每日备份流程继续运行。备份成功且完成标记通过后才允许停止旧 CMS；失败时保留旧服务。
- 日志限制为每份 20MB、最多 5 份。停止的回滚容器使用 `unless-stopped`，防止重启后和正式实例同时运行。
- Nginx 继续代理原端口 `1337`，上传大小、超时、HTTPS 与已有路由保持一致。

## 首次安装与迁移

```sh
python3 deploy/scripts/bootstrap.py --operator-key ~/.ssh/id_rsa --private-directory /安全目录/cms部署密钥
```

安装从旧容器捕获实际生效配置，不打印凭据。生成本仓库独立的 forced-command SSH key，写入 GitHub Secrets `DEPLOY_KEY`、`DEPLOY_KNOWN_HOSTS` 和 Variables `DEPLOY_TARGET`、`DEPLOY_ENABLED=false`。安装不会停止现有 CMS。首次安装拒绝覆盖已有状态，后续修改控制器由操作员审阅并更新 root 所有文件。

CI 完整通过后，停用本项目旧 GitHub webhook，并退役服务器旧 `deploy.sh`，然后开启新流程。共享 PM2 webhook 仍供其他项目使用，不应停止整个进程。旧容器及其源码挂载、原镜像在首次迁移期间保留，用于上一版回滚。

控制器：`/usr/local/sbin/fanruan-cloud-cms-deploy`，配置：`/etc/fanruan-cloud-cms/deploy.json`。SSH key 只允许 `status`、`stage`、`activate`、`restore`，不能执行任意 shell 或端口转发；只接受本仓库 GHCR digest。临时拉取凭据来自当前 job 的 `GITHUB_TOKEN`，不持久化。

激活和回滚均写入事务记录；SSH 中断自动恢复，强制终止后下次命令先恢复未完成事务。Actions 保存部署结果 artifact。失败时查看 `deploy.log` 和对应容器日志，禁止将含凭据的日志复制到公开位置。

不要运行全局 Docker prune。保留当前和上一版所需镜像；根目录 Compose 仅供明确指定镜像和配置的应急运行。

## 验证

```sh
node --test tests/*.test.js
python3 -m unittest discover -s deploy/tests
```

测试涵盖预检/备份失败、候选启动失败、公网或管理页面失败、失败回滚、连接中断、冷启动回滚、初次模型漂移、上传挂载和 SSH 命令限制。CI 同时验证无生产凭据构建及运行镜像中的管理页面。
