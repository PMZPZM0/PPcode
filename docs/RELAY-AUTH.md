# 中转站注册/登录（sub2api 兼容）

> 10-09 落地。**做在 PPcode 客户端里**：客户端只负责「界面 + 归因 + 把请求发给站点」，
> 账号库、计费、套餐、邀请返利全在站点侧（sub2api 后端，pptoken 实测就是 sub2api 部署）。

## 一、整体实现方案

### 1. 分层（沿用本仓既有形态）

| 层 | 落点 | 职责 |
|---|---|---|
| 站点协议 | `electron/features/relay-ipc.ts` | 所有 HTTP 出网都在主进程（**没有 CORS**，也不需要渲染层拿 token） |
| 纯逻辑 | `src/lib/relay-affiliate.ts` | 邀请归因：URL → 本地(30天) → 内置默认码；**唯一真相源** |
| 编排 | `src/lib/relay.ts` | `performRelayLogin` / `performRelayRegister`：注册/登录 → 选计费 → 生成供应商 → 生效 |
| 界面 | `src/features/auth/` | `LoginScreen`（登录/注册页签）+ `RegisterPanel`；样式 `src/styles/33-relay-auth.css` |

### 2. 用到的 sub2api 接口（全部免鉴权或在客户端侧完成）

| 用途 | 方法 | 路径 |
|---|---|---|
| 站点能力（注册流程是否要验证码/邀请码） | GET | `/api/v1/settings/public` |
| 注册邮箱验证码 | POST | `/api/v1/auth/send-verify-code` `{email}` |
| 注册（**带邀请归因**） | POST | `/api/v1/auth/register` `{email,password,verify_code?,aff_code?}` |
| 登录 | POST | `/api/v1/auth/login` `{email,password}` |
| 余额/分组/密钥 | GET/POST | `/api/v1/user/*`、`/api/v1/keys/*`（既有实现） |

⛔ **站点能力必须真读、不能写死**：pptoken 实测 `email_verify_enabled=true`、`affiliate_enabled=true`，
三种图形验证码全关 —— 换一个站点这些值就可能全变（写死＝注册整条失效）。

### 3. 关键页面实现思路

- **登录（默认页签）**：邮箱 + 密码 → `performRelayLogin`。网关地址放进「高级设置」（默认 pptoken，
  用户改过就用 localStorage 记住）。视觉：极光光斑 + 细网格背景、玻璃卡片、品牌渐变主按钮、
  页签滑动指示条；全部动效包在 `prefers-reduced-motion` 里可关。
- **注册（同卡片第二页签）**：邮箱 → 「发送验证码」（倒计时）→ 验证码 → 密码/确认 → 提交。
  提交前按公开设置校验（站点是否开放注册、是否必须邮箱验证码、邮箱后缀白名单）。
  **图形验证码站点**：本仓没有内置 widget，检测到就给「去网页注册（已带邀请码）」出口 ——
  不假装能注册。
- **首屏只保留一个入口**（用户 10-09 要求）：原先的「PPtoken 粘贴 Key / OpenAI 官方订阅 /
  自定义 API」三个入口已移除；注册不是第二种登录方式，而是同一方法的起手式。

### 4. 邀请链接在注册流程中的接入方式（核心）

```
① 用户从邀请链接进入  https://<站点>/register?aff=X82JSNVC3W3S
        │
        ├─ 网页端：sub2api 前端 RegisterView 读 route.query.aff → formData.aff_code
        │
        └─ 客户端 PPcode：LoginScreen 挂载时 captureAffiliateFromUrl(location.search)
                          → normalizeAffCode → localStorage(`relay_aff_code`, 30 天 TTL)

② 注册提交：resolveAffiliateCode(urlCode)  // 顺序：实参(URL/表单) → 本地存储 → 内置默认码
        → performRelayRegister({ affCode }) → 主进程 POST /api/v1/auth/register { ..., aff_code }
        → 站点后端 RegisterWithVerification(..., AffCode) 绑定邀请人

③ 注册成功：主进程立刻用同套凭据登录 + 落多账号库 → 再走「选计费 → 生成供应商 → 生效」
        → 用户直接进主界面开聊（注册即用，无需二次登录）
```

三条设计要点：
1. **默认就带归因**：没有任何 URL 参数时回落到内置 `DEFAULT_AFF_CODE`（`relay-affiliate.ts`），
   所以「下载即归因」，用户不必点链接、不必填码。
2. **「点过链接」比「默认」优先，且能覆盖**：URL 命中的码会落本地 30 天；内置默认码**不落库**，
   于是用户日后点别人的邀请链接时，仍能正确把归因改到自己名下。
3. **只有一处码字面量**：全仓 `X82JSNVC3W3S` 只出现在 `relay-affiliate.ts`；
   中转站面板、模型设置页的注册入口都从它取（原先散落 3 处，迟早漂移）。

## 二、验证

`tsc -b` / `tsc -p electron` 0 错；`npm run build` 通过；`check-dead-imports` 0 条。
IPC 三件套：manifest → `npm run gen:ipc`（434 通道）→ `ipc-registry.ts` relay 域 14 → 16。

## 三、已知待办

- 图形验证码站点（turnstile/腾讯/阿里）目前只给外链注册出口；要原生支持需内置对应 widget。
- 私有仓库（PPcode repo）下，应用内「检查更新」走匿名 Releases API 会 404 ⇒ 需要一条带凭证的
  分发链路才能恢复自动更新。
