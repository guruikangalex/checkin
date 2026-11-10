# GLaDOS 自动签到｜GitHub Actions 零基础部署指南

通过 GitHub Actions 每天自动执行 GLaDOS 签到。无需电脑常开，也不需要自己购买服务器。

> **项目来源与说明：** 本仓库基于 [integration-intelligent/checkin](https://github.com/integration-intelligent/checkin) 修改，增加了签到错误如实反馈、支持 `GLADOS_UA` 与每月 keepalive。GLaDOS 可能修改接口或限制自动化，不能保证永久有效。使用前请阅读代码，并遵守服务条款。

## 2026-11-10 签到协议与监测修复

GLaDOS 在 2026-11-07 改用 challenge/proof 签到协议。旧脚本仍可能显示 `Checkin OK`，但每次只得到 1 分。本仓库现在先获取服务端 challenge，再按公开前端协议提交 `nonce` 和 SHA-256 `proof`。程序也会查询积分、套餐、连续签到和 IQI（可用时），对“接口成功但积分低于可验证下限”报告错误；不自动兑换积分，也不会绕过额外的 CAPTCHA 验证。

新增独立的 **GLaDOS Protocol Guard**，每日 UTC 15:00（北京时间 23:00）检查前端的 proof 盐、签到端点、关键协议字段和第三方验证变化；如发生重要变化，工作流会失败并在 GitHub Actions 显示。只有在 GitHub 账号开启 Actions 失败通知时才会收到邮件。签到前还会运行一次非阻断式检查，以免监测的暂时性失败造成漏签。

- 签到工作流：`.github/workflows/run.yml`
- 监测工作流：`.github/workflows/guard.yml`
- 监测基线：`.github/guard-baseline.json`
- 原有 `GLADOS`、`GLADOS_UA`、`NOTIFY` 等配置不变。

**验证方法：** 在 Actions 中手动运行 `GLaDOS Protocol Guard` 检查是否 PASS，再查看 `run` 的日志。一天只能获得一次积分；当天已经签到的再次运行不代表新协议已恢复正常积分，需要在下次未签到时核对实际得分。

## 第 1 步：准备账号

你需要：
- 一个 GitHub 账号：<https://github.com/>
- 一个可正常登录的 GLaDOS 账号：<https://glados.cloud/>

**所有操作都在你自己的 GitHub 仓库中完成。不要把 GLaDOS Cookie 发给项目作者、朋友，或填进公开文件/Issue。**

## 第 2 步：Fork 本仓库

1. 打开 <https://github.com/guruikangalex/checkin>。
2. 点击右上角的 **Fork**。
3. Owner 选择你自己的 GitHub 账号，仓库名可保持 `checkin`。
4. 点击 **Create fork**。
5. 进入你自己的仓库：`https://github.com/你的用户名/checkin`。

Fork 后请确认仓库中存在 `main.js`、`.github/workflows/run.yml` 和 `.github/workflows/keepalive.yml`。如果你已有同一 fork 网络中的仓库，GitHub 可能要求使用已有 fork；请确认你的副本包含这些改动。

**说明：** Fork 只复制代码，不会复制原仓库的 Cookie 或其他 Actions Secrets；每个人都必须自己配置。GitHub 对新 Fork 的 Actions 也通常默认禁用。

## 第 3 步：从自己的浏览器获取 Cookie

1. 用 Chrome 或 Edge 打开 <https://glados.cloud/> 并登录你自己的 GLaDOS 账号。
2. 在控制台页面按 **F12** 打开开发者工具（Mac Chrome 可按 **⌘ + Option + I**）。
3. 选择 **Network / 网络**，刷新页面。
4. 在请求列表中找到发往 `glados.cloud` 的 API 请求（例如 `/api/user/status`）。
5. 点击请求，在 **Headers → Request Headers → Cookie** 找到 Cookie 请求头。
6. 复制 `Cookie:` 后面的**完整内容**，不要把 `Cookie:` 字样一起复制。

格式示意（不是有效凭据）：

```text
koa:sess=示例值; koa:sess.sig=示例值
```

**注意：** 复制的是 **Request Headers 中的 Cookie**，不是响应里的 `Set-Cookie`。请勿公开、截图分享或发送给他人。获取后不要主动点击 GLaDOS 的“退出登录”，否则会话可能失效。Safari 用户可先在设置中开启开发者功能，再通过“开发”菜单打开网页检查器。

## 第 4 步：把 Cookie 存入 GitHub Secret

1. 回到**自己的 fork 仓库**。
2. 点击 **Settings → Secrets and variables → Actions**。
3. 在 **Secrets** 中点击 **New repository secret**。
4. **Name** 精确填写：

```text
GLADOS
```

5. **Secret** 填入上一步复制的完整 Cookie，点击 **Add secret**。

如果你有多个 GLaDOS 账号，就在同一个 `GLADOS` Secret 中**每行放一个账号的完整 Cookie**，不能把两个账号的 Cookie 拼在同一行。

```text
第一个账号的完整Cookie
第二个账号的完整Cookie
```

> **务必确认**：这一步必须在你自己的仓库中设置 `GLADOS`，不能直接修改原作者的仓库，也不需要把 Cookie 提供给原作者。

## 第 5 步（可选，但推荐）：设置浏览器 User-Agent

GLaDOS 可能校验签到请求的 User-Agent（UA）。本项目支持 `GLADOS_UA`，未设置时会使用内置默认值，但默认 UA **不保证始终有效**。

在你登录 GLaDOS 的同一个浏览器中：
1. 打开开发者工具的 **Console / 控制台**。
2. 输入 `navigator.userAgent` 并回车（浏览器可能要求先允许在控制台粘贴）。
3. 复制返回的完整 UA 字符串。
4. 回到 **Settings → Secrets and variables → Actions → New repository secret**。
5. **Name** 填 `GLADOS_UA`，**Secret** 填完整 UA。

如果两个账号使用同一种浏览器登录，通常一行 UA 即可；使用不同浏览器/设备登录，则每行一个 UA，和 `GLADOS` 中的账号顺序对应。

**安全提示：** UA 不是 Cookie；Cookie 是敏感登录凭据，不能发给别人。即使 UA 一致，GLaDOS 也可能采取其他会话验证或自动化限制，请遵守其服务规则。

## 第 6 步：启用 GitHub Actions

1. 打开自己的 fork，点击顶部 **Actions**。
2. 若看到 **I understand my workflows, go ahead and enable them** 或类似提示，阅读代码后点击启用。
3. 在左侧找到两个工作流，并确保均已启用：

| 工作流 | 用途 |
| --- | --- |
| `run` | 每天执行签到 |
| `Keep GitHub Actions Active` | 每月提交一次时间戳，降低公开仓库因 60 天无代码活动而自动停用定时任务的风险 |

如果某个工作流页面出现 **Enable workflow**，请点击它。Fork 中的定时工作流可能默认关闭。

## 第 7 步：手动运行一次，确认是否成功

1. 点击 **Actions → run**。
2. 点击右侧 **Run workflow → Run workflow**，分支选择 `main`。
3. 打开新出现的运行记录，进入 **run → Run npm run main**。
4. 根据日志确认结果：

**签到成功：**

```text
Checkin OK
Checkin! Got N Points
Left Days 135
```

**当天已经签到过（也是正常情况）：**

```text
Checkin OK
Today's observation logged. Return tomorrow for more points.
```

**签到失败：**

```text
Checkin Error
Error: ...
```

本项目会将真正的签到错误和可验证的异常低积分反映为 GitHub Actions 的失败状态，便于排查。请同时看**日志内容**，不要只看绿色或红色图标。

## 第 8 步：确认自动签到、协议监测与保活设置

`run.yml` 中目前安排每天 **UTC 16:10**，即北京时间**次日 00:10**附近执行签到；GitHub 的 scheduled workflow 可能延迟，不保证准点。

`keepalive.yml` 安排每月 1 日 **UTC 01:00**（北京时间 09:00 附近）更新 `.github/keepalive.txt` 并由机器人提交一次 commit，以减少长期无仓库活动导致定时 workflow 被禁用的风险。

如需手动验证保活：
1. **Actions → Keep GitHub Actions Active → Run workflow**。
2. 查看任务是否显示 success。
3. 查看仓库内的 `.github/keepalive.txt` 是否被更新。
4. 如果日志提示 `Permission denied` 或 `Resource not accessible by integration`，检查 **Settings → Actions → General → Workflow permissions**，以及工作流里的 `contents: write` 权限。保活任务需要向自己的仓库写入文件。

如果工作流由于 60 天不活跃或其他原因被禁用，请在对应的 Actions 页面点击 **Enable workflow** 重新启用。保活是缓解机制，不是永久运行保证。

## 可选配置与常见问题

| 名称 | 类型 | 是否必须 | 用途 |
| --- | --- | --- | --- |
| `GLADOS` | Actions Secret | **必须** | 你的 GLaDOS 登录 Cookie；多账号按行填写 |
| `GLADOS_UA` | Actions Secret | 可选、推荐 | 登录浏览器完整 User-Agent；多账号可按行对应 |
| `NOTIFY` | Actions Secret | 可选 | 推送通知设置；不填也能在 Actions 日志中查看结果 |
| `DOMAIN` | Actions Variable | 可选 | 域名，默认 `glados.cloud`，只填域名、不加 `https://` |

**常见错误：**

- `GLADOS secret is missing`：未新建 `GLADOS`，或 Secret 名称填错。
- `没有权限`：Cookie 可能失效、会话已退出，或 GLaDOS 拒绝此请求；先确认网页登录状态，再重新获取 Cookie。
- `Automated check-in detected`：GLaDOS 检测到自动化请求；可能需要重新登录，也可能是服务端限制，不保证仅更换 UA 能解决。
- `Today's observation logged. Return tomorrow for more points.`：今天已经签到，不属于失败。
- **Actions 一直没有新记录**：先检查是否启用 `run` 与 `Keep GitHub Actions Active` 两个工作流，及是否被 GitHub 自动禁用。
- **Keepalive 提交失败**：检查工作流写权限；不要为了签到设置多余的仓库访问令牌。

## 分享方式

把下面这条项目链接发给朋友即可，他们按本 README 操作，使用**自己的账号、自己的 fork、自己的 Cookie**：

**<https://github.com/guruikangalex/checkin>**

如需查看原始项目或后续修复，也可以访问上游仓库：<https://github.com/integration-intelligent/checkin>。
