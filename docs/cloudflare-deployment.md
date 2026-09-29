# Grounded Australia：Cloudflare 预览版

当前发布方案：**Cloudflare Workers + D1 访客预览**。新账号尚未启用 R2，也未配置 Turnstile 和账号邮件，因此直接上传、登录及注册明确关闭；不要用测试密钥或降低密码安全参数绕过这些限制。

## 资源与数据

- Worker：`grounded-australia`，目标地址 `https://grounded-australia.grounded-au.workers.dev`。
- D1：新账号内的 `grounded-australia-production`，区域提示为 Oceania。六个迁移已应用，随后导入下述演示内容；不导入登录凭据。
- 图片：当前生产环境不绑定 R2 或 Supabase Storage；外链示例图片仍可显示，直接上传返回明确的不可用提示。
- Turnstile：当前未配置，因此账号入口隐藏，认证 API 保持不可用。
- 本地仍使用模拟 D1/R2，不发送真实邮件；预发布配置保持单独资源。

2026-09-29 已在全新 Cloudflare 账号发布版本 `5aad4424-6e08-4b63-8231-4efb94b9b49f`。部署前创建并备份独立 D1，应用全部迁移，并导入 5 个明确标注的 Demo 用户、5 个问题、4 个回答和 2 条评论；没有账号凭据或人工认证标记。线上健康检查、主页、社区接口和访客账号页均返回 200，并保持 `noindex, nofollow`。

启用私有存储后，桶应限制为 JPEG、PNG、WebP，最大 5 MiB。应用会检查登录、已验证邮箱、文件签名、每日配额及对象归属。读取先查询 D1 中内容可见性，再由 Worker 流式返回；不公开 bucket URL 或签名链接。响应为 `private, no-store`，包含 `nosniff` 和 sandbox CSP，使审核下架后下一次媒体请求重新检查权限。

Supabase 控制台创建桶时设置 `public=false`、最大文件大小 `5242880`，允许类型为 `image/jpeg,image/png,image/webp`。不要添加允许匿名或普通用户直接访问该桶的 Storage RLS 策略。现代 `sb_secret_` 密钥仅通过 `apikey` 发送；旧 service-role JWT 兼容 `apikey` 和 Bearer。

[Supabase 私有桶](https://supabase.com/docs/guides/storage/buckets/fundamentals)、[服务端密钥](https://supabase.com/docs/guides/getting-started/api-keys)

## 环境配置

`wrangler.jsonc` 根配置仅供本地；发布时必须选择 `production` 或 `staging`。

| 配置 | 当前生产用途 |
|---|---|
| `APP_ENV` | `production` |
| `SITE_URL` | 实际 HTTPS origin，不含路径 |
| `SUPABASE_URL` | 空字符串；当前未启用直接上传 |
| `SUPABASE_STORAGE_BUCKET` | 空字符串；当前未启用直接上传 |
| `r2_buckets` | `[]`，不绑定 R2 |
| `REGISTRATION_OPEN` | `false`，API 拒绝注册，页面显示预览说明 |
| `send_email` / `EMAIL_FROM` | 空数组 / 空字符串，当前不发送账号邮件 |
| `TURNSTILE_SITE_KEY` | 空字符串；账号入口关闭 |

仅将密钥写入 Cloudflare secret：

```bash
pnpm exec wrangler secret put SUPABASE_SECRET_KEY --config wrangler.jsonc --env production
pnpm exec wrangler secret put TURNSTILE_SECRET_KEY --config wrangler.jsonc --env production
```

密钥不进入源码、浏览器、构建产物或提交历史。不要将其他项目的环境文件整体复制到本项目。`.dev.vars*`、`.env*`、备份及构建产物已忽略。

## 验证与发布

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
pnpm build
pnpm test:preview
pnpm test:preview --without-media
pnpm test:preview --closed-registration

pnpm cf:check production
pnpm cf:build production
pnpm cf:dry-run production
pnpm cf:deploy production
```

`cf:build` 固定目标环境并记录源码/产物摘要；变更后须重新构建。`cf:deploy` 先导出 D1 备份并验证文件非空，再应用迁移，最后上传相同产物。备份文件在 `.wrangler/backups`；导出下载链接不打印到控制台。本地迁移记录与远程 Wrangler 的迁移记录不同，不要将本地 SQLite 导入生产再重跑远程迁移。

发布后检查 `/api/health`（D1 表结构及 Supabase 私有桶配置）、主页、静态资源、预览提示，以及注册 API 返回 403。预览返回 `X-Robots-Tag: noindex, nofollow`，robots 禁止索引。新用户注册关闭期间，游客可以浏览；发帖、回答和上传仍要求登录及邮箱验证。

## 预览演示数据

2026-09-14 按用户要求导入 5 个演示用户、5 个问题、4 个回答和 2 条评论，包含 2 个已采纳回答和 2 张原有 Unsplash 外链图片。来源为 `scripts/demo-seed.sql`，先在独立 SQLite 中应用现有迁移与 `scripts/local-db.mjs seed` 的清理逻辑，再导出四张内容表；额外清零旧回答基准分。实际导入文件为本机 `work/demo-preview-import.sql`。

导入前确认线上库为空并导出备份；导入使用普通 INSERT，遇到重复键会报错，不覆盖已有记录。所有用户均为 `demo=1`、未认证、非管理员；没有账号密码、会话或虚构浏览/点赞/关注计数。问题及个人资料显示 Demo 标记，演示用户不能被匹配为已认证专家。

关闭注册的预览与本地环境允许浏览这些内容；正式开放注册后，线上问题正文、用户目录和演示个人资料会隐藏。数据库中的演示记录保留，便于后续按需清理。示例图片沿用外链，不占 Supabase 存储。

展示更新已发布，版本 `e1df5026-0997-4f19-b64e-10b26445a8c3`。线上核验通过：内容数量、Demo 标识、分类搜索、详情回答/评论、个人资料、两张示例图片及存储健康状态。演示用户未进入认证专家目录，注册与账号邮件继续关闭。

## 开放注册

1. 为 Cloudflare Email Service 配置实际发信域名，完成 DNS 验证并确认账户方案支持发信；或先接入选定的其他邮件服务。当前账户未提供发信域名。
2. 设置真实 `EMAIL_FROM`，恢复 `send_email: [{"name":"EMAIL"}]`。
3. 在测试环境验证实际邮件投递、一次性邮箱验证及重置、HTTPS cookie、Turnstile、提问/回答/上传和审核流程。
4. 将 `REGISTRATION_OPEN` 改为 `true`，重新验证、构建、发布。发布脚本拒绝在邮件配置为空时开放注册。
5. 为已注册且已验证邮箱的真实账号授予审核员：`pnpm cf:admin production reviewer@your-real-domain.com`。命令结果 `granted` 应为 1；首个注册者不会自动成为管理员。

[Cloudflare 邮件配置](https://developers.cloudflare.com/email-service/get-started/send-emails/)

## 运维边界

- 密码使用 scrypt，会话及账号链接只保存哈希；密码重置撤销所有会话。预览不会绕过邮箱验证或创建演示管理员。
- 每日清理过期会话和 token；不自动删除用户图片、上传记录或内容。
- 图片删除/下架依赖内容权限；已被第三方下载的副本无法撤回。
- 线上限流：读取 120 次、认证 10 次、写入 30 次、上传 10 次/分钟；按数据中心执行。上传另有每用户每日 100 张限制。
- 数据库数据与图片分属 D1 和 Supabase，备份/恢复分别管理。代码回滚不会回滚数据库迁移。
- GitHub Actions 执行类型、配置、迁移、存储适配器和本地 Worker 检查，不自动发布。

## 本次验证记录

2026-09-14 已发布至 [Grounded Australia](https://grounded-australia.pathfive.workers.dev/)，版本 `3b1a1e62-8e95-43cc-b725-d3ef79e83993`。经用户确认，Supabase 服务密钥已写入该 Worker secret；Turnstile secret 也已配置。

已通过类型检查、四项配置/迁移/存储测试，以及普通、无图片、关闭注册三种本地 Worker 流程检查。真实 Supabase 私有桶上传/下载往返成功，匿名及 public URL 拒绝访问，测试对象已删除。存储请求使用 `redirect: "manual"` 并拒绝重定向响应，已在实际 Workers 运行时验证连接成功。

首轮线上验收通过：`/api/health` 返回 200，主页和 JavaScript 资源正常，注册返回 403，邮件请求返回 503，游客上传返回 401，无权读取的图片返回 404。浏览器确认首页预览提示、统一的 Sign in 入口和账号页关闭注册说明。预览禁止搜索引擎索引。

真实会员登录后的完整上传流程、Turnstile 提交及邮件投递留待开放注册前验收；当前验证不替代这些流程。

## 积分兑换发布记录

2026-09-15 已发布 [积分兑换页](https://grounded-australia.pathfive.workers.dev/rewards)，Worker 版本 `1ab3fbff-7bb5-4626-a1e9-400c4374440d`。先导出并验证 D1 备份，再应用 `0004_rewards.sql`、`0005_reward_revision.sql`；现有演示内容和存储配置保留。

类型检查、4 项基础测试、8 项本地集成测试通过。浏览器验证会员预留/取消和审核员履约；本地临时夹具已清理。手机导航标签已缩短以适配五个入口。线上 `/api/health`、`/rewards`、`/api/rewards` 返回 200；目录有 3 件 Demo 奖励且不可兑换；游客兑换 401、管理目录 403，私有钱包及订单不对游客展示。原有 5 个演示问题保留，注册和邮件继续关闭。

积分规则、权限、履约方式和后续运营说明见 [rewards.md](./rewards.md)。实际奖品履约和真实账号邮件流程尚未上线联调。

## 管理员知识分享（2026-09-24）

已部署版本 `f68d2019-6c5c-44dc-bde5-d7d6ac9a4992`，部署前已备份 D1，无新增迁移。为用户指定账号创建管理员权限，并通过本地私有文件交付一次性密码设置链接；凭据不写入文档。公众注册和邮件仍关闭。

管理员从 `/me` → Publish knowledge 发布；知识分享在 `/search?type=knowledge` 和社区列表展示，详情页支持再次编辑。复用现有内容表，通过后端保护的 context.kind 区分知识分享；管理员编辑保留审核记录。

类型检查、5 项基础测试、8 项集成测试、构建和部署预检通过。ESLint 仍报告 community.tsx 既有链接及 Hooks 规则问题；未把这些全站旧问题计作通过。新管理员需要本人完成密码设置后登录。

## 管理员发布页改版（2026-09-24）

已发布版本 `57bdc645-4e8b-41e4-8073-70ff2972189c`。知识分享编辑器采用正文优先的布局，桌面侧栏集中发布设置，窄屏按写作、选填素材、发布设置排序；图片/视频和全部六个背景字段保留在折叠区。显示本机新文章草稿恢复/保存状态，已发布编辑不宣称自动保存。个人中心的管理员操作移至单独工作区。

类型检查、构建、8 项集成测试通过；首轮测试出现一次临时 503，重跑完整集成通过。本地浏览器验证新建、草稿恢复、发布、编辑保存，以及桌面、390px 手机和 768px 平板布局；临时账号和测试文章已清理。发布前已备份 D1，无数据库迁移。
