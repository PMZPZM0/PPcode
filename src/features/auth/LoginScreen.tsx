/**
 * 登录域（从 src/App.tsx 原样搬来；10-09 按用户要求**收敛为单一入口**并升级视觉）。
 *
 * 用户要求（10-09）：
 *   「登录界面只保留一个就行」+「设计得更高级、更有质感」+「使用 PPtoken 的中转站账户登录」。
 * ⇒ 只留**中转站账户**（sub2api 网关账号：邮箱 + 密码），原先的
 *   「PPtoken 粘贴 Key / OpenAI 官方订阅 / 自定义 API」三个入口整块移除；
 *   注册作为**同一个方法的另一半**（页签切换），不是第二种登录方式。
 *
 * 10-22 用户：「登录选项加一套云管理账号登录功能」——在登录页增加第二种**账号体系**：
 *   中转站账号（原有）与云管理账号（cloud-* 域 + provisionCloud 自动配置）。
 *   ⛔ 不是把 OpenAI/自定义 API 那些旧入口搬回来；云账号同样只有「账号 + 密码」。
 *
 * ⛔ 为什么登录/注册都走 `lib/relay.ts` 的 performRelay*：那是全应用唯一的
 *   「登录/注册 → 选计费 → 生成供应商 → 生效」实现（引导弹窗共用）。这里只做界面与归因。
 * ⛔ 邀请归因的单一真相源是 `lib/relay-affiliate.ts`（URL ?aff= → 本地 30 天 → 内置默认码），
 *   本文件**不写死**任何邀请码字面量。
 *
 * 公开面见同目录 index.ts。
 */

import { Wallet, WifiOff, Mail, Lock, UserRound, Eye, EyeOff, Loader2, Sparkles, KeyRound, Cloud } from "lucide-react";
import { createPortal } from "react-dom";
import { performRelayLogin, writeRelayActive } from "../../lib/relay";
import { provisionCloud } from "../../lib/cloud-provision.mjs";
import { ProviderSetupDialog, type ProviderSetupCompleted, type ProviderSetupIntent } from "../provider-setup";
import { cloudUserCenterUrl } from "../../lib/cloud-links.mjs";
import { describeCredentialFix, normalizeCredential } from "../../lib/relay-input.mjs";
import { captureAffiliateFromUrl } from "../../lib/relay-affiliate";
import { RegisterPanel } from "./RegisterPanel";
import { useRef, useState, useLayoutEffect, useEffect, useCallback, KeyboardEvent } from "react";

export function FieldHelp({ text }: { text: string }) {
  const anchorRef = useRef<HTMLElement | null>(null);
  const popRef = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState<{ anchorTop: number; anchorBottom: number; left: number; up: boolean } | null>(null);
  const TIP_W = 300;
  const open = () => {
    const el = anchorRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.min(TIP_W, window.innerWidth - 24);
    // 水平方向贴 ? 的左边缘，再夹进视口（不越界，也就不会伸到左侧列表头上）
    const left = Math.max(12, Math.min(r.left, window.innerWidth - width - 12));
    // 先按「向下」渲染，真正的上下翻转交给下面的布局副作用按实测高度决定
    setBox({ anchorTop: r.top, anchorBottom: r.bottom, left, up: false });
  };
  const close = () => setBox(null);
  // ⛔ 翻转必须按**实测高度**决定，不能写死阈值估算：说明文字长短差很多（「上游协议」那段实测
  //    294px），按 190 估就会向下弹、底部被视口切掉 50px，用户看不到后一半说明。
  //    useLayoutEffect 在浏览器绘制前执行，翻转过程用户看不到。
  useLayoutEffect(() => {
    const el = popRef.current;
    if (!box || !el || box.up) return;
    const h = el.offsetHeight;
    const below = window.innerHeight - box.anchorBottom - 7 - 12;
    const above = box.anchorTop - 7 - 12;
    // 下方装得下就保持向下；装不下才向上，且上方必须比下方更宽裕（两边都紧就选大的那侧）
    if (below < h && above > below) setBox((prev) => (prev ? { ...prev, up: true } : prev));
  }, [box]);
  useEffect(() => {
    if (!box) return;
    // 滚动/改窗口后锚点会移动，而 fixed 浮层不跟随 —— 直接收起比错位好
    const dismiss = () => setBox(null);
    // 形参用 Event + 断言：本文件的 KeyboardEvent 是 React 类型（导入遮蔽了 DOM 那个），
    // 直接标它会让 addEventListener("keydown") 的重载匹配失败（同 18082 既有写法）
    const onKey = (event: Event) => {
      if (String((event as unknown as { key?: string }).key ?? "") === "Escape") setBox(null);
    };
    window.addEventListener("scroll", dismiss, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("scroll", dismiss, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("keydown", onKey);
    };
  }, [box]);
  return (
    <>
      <i
        ref={anchorRef}
        className="field-help"
        tabIndex={0}
        role="note"
        aria-label={text}
        onMouseEnter={open}
        onMouseLeave={close}
        onFocus={open}
        onBlur={close}
      >?</i>
      {box && createPortal(
        <div
          ref={popRef}
          className="field-help-pop"
          role="tooltip"
          style={{
            top: box.up ? undefined : box.anchorBottom + 7,
            bottom: box.up ? window.innerHeight - box.anchorTop + 7 : undefined,
            left: box.left,
            maxWidth: Math.min(TIP_W, window.innerWidth - 24),
          }}
        >{text}</div>,
        document.body,
      )}
    </>
  );
}

/** 默认网关（sub2api 站点根地址，不带 /v1）。10-24 品牌特供款：恒为 pptoken，⛔ 不再提供改网关入口。 */
const DEFAULT_GATEWAY = "https://api.pptoken.cc";
const LOGO_SRC = `${import.meta.env.BASE_URL}pptoken-logo.png`;

export function LoginScreen({ onSkip, onLogin, onCloudReady }: { onSkip: () => void; onLogin: (info: { provider: string; name: string; baseUrl: string; apiKey: string; model: string; username?: string; saved?: any; models?: string[] }) => Promise<boolean>; onCloudReady?: (info: { username?: string }) => Promise<boolean> }) {
  const [tab, setTab] = useState<"login" | "register">("login");
  /* 10-31 用户：「ppcode 也是一样，做这种两段效果」—— 默认只列登录方式，点一条展开表单；
     点卡片外面收起（与桌面版同一套交互）。 */
  const [expanded, setExpanded] = useState(false);
  const cardRef = useRef<HTMLDivElement | null>(null);
  /* 展开态点卡片外面 ⇒ 收起（与桌面版同一规则） */
  useEffect(() => {
    if (!expanded) return;
    const onDown = (event: MouseEvent) => {
      const el = cardRef.current;
      if (!el || el.contains(event.target as Node)) return;
      setExpanded(false);
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [expanded]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [username, setUsername] = useState(() => localStorage.getItem("username") || "");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  /* 10-24：中转站 / 云账号登录后统一进「自动配置」弹窗 —— 检测模型 → 勾选 → 保存启用 → 重启。 */
  const [setupIntent, setSetupIntent] = useState<ProviderSetupIntent | null>(null);
  /** 提交时净化了什么（全角→半角 / 去空白……）；没改就为空。 */
  const [fixNote, setFixNote] = useState("");
  /* ── 登录方式（10-22 用户：「登录选项加一套云管理账号登录功能」）──
     中转站是原有的 sub2api 网关账号；云管理账号走主进程 cloud-* 域，登录后由
     `provisionCloud` 自动配好模型 / 知识库 / 记忆，最后交给 onLogin 保存并重启引擎。 */
  const [method, setMethod] = useState<"relay" | "cloud">("relay");
  const [cloudAccount, setCloudAccount] = useState(() => {
    try { return localStorage.getItem("ppcode-cloud-account") || ""; } catch { return ""; }
  });
  const [cloudPassword, setCloudPassword] = useState("");
  const [showCloudPw, setShowCloudPw] = useState(false);
  const [cloudCenterUrl, setCloudCenterUrl] = useState("");
  /** 本机已保存的中转站会话（同网关 + 同邮箱且有效时，允许不重输密码直接继续）。 */
  const [savedSession, setSavedSession] = useState<{ baseUrl: string; email: string } | null>(null);
  /* 进页面先吃 URL 上的 ?aff=（外链带进来的归因）落本地 30 天 —— 注册时静默带上。
     ⛔ 只是**捕获**、不显示：本页与注册页都不出现任何归因字样（10-09 用户令）。 */
  useEffect(() => { captureAffiliateFromUrl(window.location.search); }, []);
  /* 摸一下本机有没有已保存的会话（失败后也会再摸一次 —— 用户不用为一次配置反复赌密码） */
  const refreshSavedSession = useCallback(() => {
    void window.codex.relayLoadAccount().then((acc) => {
      if (acc?.loggedIn && acc.email && acc.baseUrl) setSavedSession({ baseUrl: acc.baseUrl, email: acc.email });
      else setSavedSession(null);
    }).catch(() => undefined);
  }, []);
  useEffect(() => { refreshSavedSession(); }, [refreshSavedSession]);
  /* 云账号服务基址 → 用户中心注册链接；已登录过就把账号回填（密码永远不落盘）。
     ⛔ 链接由 `cloud-links.mjs` 按账号服务基址派生，不写死云端域名。 */
  useEffect(() => {
    let alive = true;
    void (window.codex as any).cloudAuthStatus?.().then((s: any) => {
      if (!alive) return;
      setCloudCenterUrl(cloudUserCenterUrl(String(s?.defaultBaseUrl || s?.active?.baseUrl || "")));
      const activeName = String(s?.active?.username || "").trim();
      if (activeName) setCloudAccount((prev) => prev || activeName);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  /* 弹窗完成后：中转站走 onLogin 的预保存收尾；云账号走 onCloudReady 接生效供应商。 */
  const finishSetup = async ({ result, intent }: ProviderSetupCompleted, options: { restart: boolean }) => {
    const saved = result.saved;
    const models = result.models ?? [];
    let ok = false;
    if (intent.source === "cloud") {
      ok = Boolean(await onCloudReady?.({ username: intent.account || username.trim() || undefined }));
    } else {
      ok = await onLogin({
        provider: saved?.provider || intent.provider,
        name: saved?.name || intent.name,
        baseUrl: saved?.baseUrl || intent.baseUrl,
        apiKey: "",
        model: saved?.model || models[0] || "",
        username: intent.account || username.trim() || undefined,
        saved,
        models,
      });
      if (ok && intent.relayActive) writeRelayActive({ ...intent.relayActive, switchedAt: Date.now() });
    }
    setSetupIntent(null);
    if (!ok) { setStatus("供应商已保存，但进入主界面失败 —— 请重启应用后重试"); return; }
    if (options.restart) window.setTimeout(() => { void window.codex.relaunchApp().catch(() => undefined); }, 900);
  };

  /* 中转站账户登录：登录 → 自动选计费（有套餐用套餐，否则余额）→ 生成供应商进主界面 */
  const relayLogin = async (opts: { skipLogin?: boolean } = {}) => {
    setBusy(true); setStatus(""); setFixNote("");
    const base = DEFAULT_GATEWAY;
    /* ⛔ 提交前净化：中文输入法的全角 `＠`、粘贴带进来的尾随空格/换行，肉眼一样、字节不同，
         站点一律回 invalid email or password（10-09 实测：同一套凭据 curl 200、应用里 invalid）。 */
    const cleanEmail = normalizeCredential(email);
    const cleanPw = normalizeCredential(password);
    const fix = describeCredentialFix(email) || describeCredentialFix(password);
    if (cleanEmail !== email) setEmail(cleanEmail);
    if (cleanPw !== password) setPassword(cleanPw);
    if (fix) setFixNote(fix);
    if (username.trim()) { try { localStorage.setItem("username", username.trim()); } catch { /* 忽略 */ } }
    const result = await performRelayLogin({
      baseUrl: base,
      email: cleanEmail,
      password: cleanPw,
      username: username.trim() || undefined,
      skipLogin: opts.skipLogin,
      onLogin,
      deferActivation: true,
    });
    setBusy(false);
    if (!result.ok) {
      setStatus(result.message ?? "登录失败");
      refreshSavedSession();
      return;
    }
    if (!result.pending) { setStatus("登录成功，但没有解析到可用供应商 —— 请稍后重试"); return; }
    /* 模型列表交给弹窗拉取并展示进度；勾选后由弹窗落盘，取消则供应商不写进档案。 */
    setSetupIntent({
      provider: result.pending.provider,
      name: result.pending.name,
      baseUrl: result.pending.baseUrl,
      apiKey: result.pending.apiKey,
      source: "relay",
      editable: false,
      autoStart: true,
      /* 10-24 品牌特供款：登录即用 —— 检测完自动全选保存，不人工勾选。 */
      autoAll: true,
      account: username.trim() || result.active?.email,
      relayActive: result.active,
    });
  };

  /**
   * 云管理账号登录（复用主进程 cloud-* 域与 `provisionCloud` 编排，⛔ 不另写一套）：
   *   账号密码 → 云端会话令牌 → 自动同步模型 / 知识库 / 记忆 → 生效位（需要时重启引擎）
   *   → `onCloudReady` 把当前供应商接进 UI。
   * ⛔ 不再走 onLogin 的「裸 /models 探测 + 再存一遍」：云端代理不一定支持裸探测，用户要的是
   *   「登录好自动配置好」；保存与重启由 `cloud-models:activate` 统一完成。
   */
  const cloudLogin = async () => {
    setBusy(true); setStatus("");
    try {
      const api = window.codex as any;
      if (!api.cloudAuthLogin) { setStatus("当前构建未包含云账号接口，请更新后再试"); return; }
      const r = await api.cloudAuthLogin({
        username: cloudAccount.trim(),
        password: cloudPassword,
      });
      if (!r?.ok) { setStatus(r?.error || "云账号登录失败"); return; }
      try { localStorage.setItem("ppcode-cloud-account", cloudAccount.trim()); } catch { /* 忽略 */ }
      /* 自动配置；令牌失效的 401 由 sync 内部自愈，仍失败才 force 重签一次（与设置页同口径）。
         ⛔ 生效位交给统一弹窗：勾选模型 → 保存并启用 → 旧供应商自动停用 → 重启。
         这里不再 activate（否则会先偷偷切一次生效位、多重启一次引擎）。 */
      let report = await provisionCloud(api, { activate: false });
      if (!report.models?.ok) {
        const forced = await api.cloudModelsSync?.({ force: true });
        if (forced?.ok) report = await provisionCloud(api, { activate: false });
      }
      if (!report.models?.ok) {
        setStatus(`已登录，但云端模型同步失败：${report.models?.error || "未知原因"} —— 可到 设置 → 云账号 点「一键同步」重试`);
        onSkip();
        return;
      }
      /* count=0 也让弹窗打开：云端可能列出了模型但都没勾选，弹窗里可以直接全选。 */
      setBusy(false);
      setSetupIntent({
        provider: "cloud",
        name: "云端模型",
        baseUrl: "",
        apiKey: "",
        source: "cloud",
        autoStart: true,
        /* 10-24 品牌特供款：登录即用（与中转站同口径）。 */
        autoAll: true,
        account: cloudAccount.trim() || username.trim() || undefined,
      });
    } catch (error: any) {
      setStatus("云账号登录失败：" + (error?.message ?? error));
    } finally {
      setBusy(false);
    }
  };

  /** 本机已保存的会话是否正好对应「当前填的邮箱」（网关恒为 pptoken）⇒ 才允许跳过登录直接继续。 */
  const savedSessionMatches = Boolean(savedSession
    && savedSession.baseUrl.replace(/\/$/, "") === DEFAULT_GATEWAY
    && savedSession.email === normalizeCredential(email));

  /* ⛔ 邀请归因**不进界面**（10-09 用户令：「不要透出来，默认用我的邀请码注册就行」）：
     码只在注册请求体里静默带上，界面一个字都不显示。 */
  const canSubmit = Boolean(email.trim() && password && !busy);

  return (
    <div className="login-screen authx-screen">
      {/* 装饰层：极光光斑 + 细网格（纯装饰，pointer-events:none，不参与任何交互） */}
      <div className="authx-aurora" aria-hidden="true" />
      <div className="authx-grid" aria-hidden="true" />

      <div
        ref={cardRef}
        className="authx-card"
        onClick={() => { if (!expanded) setExpanded(true); }}
      >
        <header className="authx-brand">
          <span className="authx-logo"><img src={LOGO_SRC} alt="" /></span>
          <span className="authx-brand-text">
            <strong>PPcode</strong>
            <em>中转线路 · 一个账号开聊</em>
          </span>
        </header>

        <div className="authx-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "login"} className={tab === "login" ? "on" : ""}
            onClick={() => { setTab("login"); setStatus(""); setExpanded(false); }}>登录</button>
          <button type="button" role="tab" aria-selected={tab === "register"} className={tab === "register" ? "on" : ""}
            onClick={() => { setTab("register"); setStatus(""); setExpanded(true); }}>注册</button>
          <span className="authx-tab-ink" data-tab={tab} aria-hidden="true" />
        </div>

        {/* 登录方式：中转站 / 云管理账号（10-22 用户：「登录选项加一套云管理账号登录功能」）。
            两条线互不影响：中转站走 sub2api 网关，云账号走 cloud-* 域 + 自动配置。 */}
        {tab === "login" && (
          <div className="authx-method" role="tablist" aria-label="登录方式">
            <button type="button" role="tab" aria-selected={expanded && method === "relay"} className={expanded && method === "relay" ? "on" : ""}
              onClick={() => { setMethod("relay"); setStatus(""); setFixNote(""); setExpanded((v) => (method === "relay" ? !v : true)); }}>
              <Wallet size={16} />
              <span><b>中转站账号</b><small>仅支持 pptoken · 余额 / 套餐</small></span>
            </button>
            <button type="button" role="tab" aria-selected={expanded && method === "cloud"} className={expanded && method === "cloud" ? "on" : ""}
              onClick={() => { setMethod("cloud"); setStatus(""); setFixNote(""); setExpanded((v) => (method === "cloud" ? !v : true)); }}>
              <Cloud size={16} />
              <span><b>云管理账号</b><small>登录即用 · 自动配置</small></span>
            </button>
          </div>
        )}

        <div className={`authx-form-wrap${expanded ? " is-open" : ""}`}>
        <div className="authx-form-inner">
          {tab === "register" ? (
              <RegisterPanel
                baseUrl={DEFAULT_GATEWAY}
                username={username.trim() || undefined}
                onUsernameChange={(v) => setUsername(v)}
                cloudCenterUrl={cloudCenterUrl}
                onLogin={onLogin}
                onBack={() => setTab("login")}
              />
            ) : (
              <div className="authx-panel">
                {method === "relay" ? (<>
                <label className="authx-field">
                  <span>账号邮箱</span>
                  <div className="authx-input">
                    <Mail size={14} />
                    <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="你在中转站注册的邮箱"
                      autoComplete="username" spellCheck={false}
                      onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) void relayLogin(); }} />
                  </div>
                </label>

                <label className="authx-field">
                  <span>密码</span>
                  <div className="authx-input">
                    <Lock size={14} />
                    <input type={showPw ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)}
                      placeholder="中转站账号密码" autoComplete="current-password"
                      onKeyDown={(e) => { if (e.key === "Enter" && canSubmit) void relayLogin(); }} />
                    <button type="button" className="authx-eye" onClick={() => setShowPw((v) => !v)} title={showPw ? "隐藏密码" : "显示密码"}>
                      {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </label>

                {/* 10-24 品牌特供款：用户名（界面昵称）从「高级设置」提为正常字段；
                    网关恒为 pptoken（⛔ 不再提供改网关的入口 —— 只保留 pptoken 中转站登录）。 */}
                <label className="authx-field">
                  <span>用户名（选填）</span>
                  <div className="authx-input">
                    <UserRound size={14} />
                    <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="登录后显示在左上角" />
                  </div>
                </label>

                {status && <div className="authx-error">{status}</div>}
                {fixNote && <div className="authx-ok">{fixNote}</div>}

                <button type="button" className="authx-primary" disabled={!canSubmit} onClick={() => void relayLogin()}>
                  {busy ? <><Loader2 size={15} className="authx-spin" />正在登录并配置…</> : <><Sparkles size={15} />登录并开始使用</>}
                </button>

                {/* 本机已保存过同一网关+邮箱的有效会话 ⇒ 不必为一次配置反复赌密码（10-09 用户被
                    「invalid email or password」卡住时，机器里明明躺着一个 24h 的有效 token）。 */}
                {savedSessionMatches && (
                  <button type="button" className="authx-ghost" disabled={busy}
                    title="用本机上一次成功登录留下的会话继续（不发送密码）"
                    onClick={() => void relayLogin({ skipLogin: true })}>
                    <KeyRound size={14} />用本机已保存的登录状态继续（不重输密码）
                  </button>
                )}

                <p className="authx-note">
                  没有账号？切到上方「注册」——只需邮箱验证码，注册完自动登录并接好模型供应商。
                </p>
                </>) : (<>
                <label className="authx-field">
                  <span>云账号</span>
                  <div className="authx-input">
                    <Mail size={14} />
                    <input value={cloudAccount} onChange={(e) => setCloudAccount(e.target.value)}
                      placeholder="你在云端注册的账号（与网页端同一个）" autoComplete="username" spellCheck={false}
                      onKeyDown={(e) => { if (e.key === "Enter" && cloudAccount.trim() && cloudPassword && !busy) void cloudLogin(); }} />
                  </div>
                </label>

                <label className="authx-field">
                  <span>密码</span>
                  <div className="authx-input">
                    <Lock size={14} />
                    <input type={showCloudPw ? "text" : "password"} value={cloudPassword} onChange={(e) => setCloudPassword(e.target.value)}
                      placeholder="云账号密码" autoComplete="current-password"
                      onKeyDown={(e) => { if (e.key === "Enter" && cloudAccount.trim() && cloudPassword && !busy) void cloudLogin(); }} />
                    <button type="button" className="authx-eye" onClick={() => setShowCloudPw((v) => !v)} title={showCloudPw ? "隐藏密码" : "显示密码"}>
                      {showCloudPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </label>

                {/* 10-24 品牌特供款：云端服务地址折叠已隐藏 —— 云端基址由账号服务派生，特供款用户不需要也不该改。 */}

                {status && <div className="authx-error">{status}</div>}

                <button type="button" className="authx-primary" disabled={!cloudAccount.trim() || !cloudPassword || busy} onClick={() => void cloudLogin()}>
                  {busy ? <><Loader2 size={15} className="authx-spin" />正在登录并自动配置…</> : <><Cloud size={15} />登录并自动配置</>}
                </button>

                <p className="authx-note">
                  登录后自动同步云端模型并接通云端知识库与记忆，随后打开模型配置：勾选要用的模型 → 保存并启用 → 重启。
                </p>
                {/* ⛔ 10-31 用户：「云管理这里不要在这个界面加注册跳转，注册界面有就行」
                    —— 登录页不放外链注册入口（注册走上方「注册」标签）。 */}
                </>)}
              </div>
            )}
        </div>
      </div>

        <button className="ghost login-skip authx-skip" onClick={onSkip}><WifiOff size={14} />暂时不登录，直接进入</button>
      </div>
      {setupIntent && (
        <ProviderSetupDialog
          intent={setupIntent}
          onClose={() => setSetupIntent(null)}
          onCompleted={finishSetup}
        />
      )}
    </div>
  );
}
