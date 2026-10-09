/**
 * 登录域（从 src/App.tsx 原样搬来；10-09 按用户要求**收敛为单一入口**并升级视觉）。
 *
 * 用户要求（10-09）：
 *   「登录界面只保留一个就行」+「设计得更高级、更有质感」+「使用 PPtoken 的中转站账户登录」。
 * ⇒ 只留**中转站账户**（sub2api 网关账号：邮箱 + 密码），原先的
 *   「PPtoken 粘贴 Key / OpenAI 官方订阅 / 自定义 API」三个入口整块移除；
 *   注册作为**同一个方法的另一半**（页签切换），不是第二种登录方式。
 *
 * ⛔ 为什么登录/注册都走 `lib/relay.ts` 的 performRelay*：那是全应用唯一的
 *   「登录/注册 → 选计费 → 生成供应商 → 生效」实现（引导弹窗共用）。这里只做界面与归因。
 * ⛔ 邀请归因的单一真相源是 `lib/relay-affiliate.ts`（URL ?aff= → 本地 30 天 → 内置默认码），
 *   本文件**不写死**任何邀请码字面量。
 *
 * 公开面见同目录 index.ts。
 */

import { Wallet, WifiOff, Mail, Lock, UserRound, Eye, EyeOff, Loader2, Gift, Sparkles } from "lucide-react";
import { createPortal } from "react-dom";
import { performRelayLogin } from "../../lib/relay";
import { captureAffiliateFromUrl, maskAffCode, resolveAffiliateCode } from "../../lib/relay-affiliate";
import { RegisterPanel } from "./RegisterPanel";
import { useRef, useState, useLayoutEffect, useEffect, KeyboardEvent } from "react";

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

/** 默认网关（sub2api 站点根地址，不带 /v1）。用户改过就记住。 */
const DEFAULT_GATEWAY = "https://api.pptoken.cc";
const GATEWAY_KEY = "relay-gateway";
const LOGO_SRC = `${import.meta.env.BASE_URL}pptoken-logo.png`;

export function LoginScreen({ onSkip, onLogin }: { onSkip: () => void; onLogin: (info: { provider: string; name: string; baseUrl: string; apiKey: string; model: string; username?: string }) => Promise<boolean> }) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [gateway, setGateway] = useState(() => window.localStorage.getItem(GATEWAY_KEY) || DEFAULT_GATEWAY);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [username, setUsername] = useState(() => localStorage.getItem("username") || "");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  /* 进页面先吃 URL 上的 ?aff=（浏览器/外链带进来的归因），落本地 30 天 */
  const [urlCode] = useState(() => captureAffiliateFromUrl(window.location.search));

  /* 中转站账户登录：登录 → 自动选计费（有套餐用套餐，否则余额）→ 生成供应商进主界面 */
  const relayLogin = async () => {
    setBusy(true); setStatus("");
    const base = (gateway.trim() || DEFAULT_GATEWAY).replace(/\/$/, "");
    try { window.localStorage.setItem(GATEWAY_KEY, base); } catch { /* 忽略 */ }
    if (username.trim()) { try { localStorage.setItem("username", username.trim()); } catch { /* 忽略 */ } }
    const result = await performRelayLogin({
      baseUrl: base,
      email: email.trim(),
      password,
      username: username.trim() || undefined,
      onLogin,
    });
    if (!result.ok) setStatus(result.message ?? "登录失败");
    setBusy(false);
  };

  const affiliate = resolveAffiliateCode(urlCode || undefined);
  const affSource = affiliate.source === "input" ? "来自邀请链接" : affiliate.source === "stored" ? "本机已记录" : "默认邀请码";
  const canSubmit = Boolean(email.trim() && password && !busy);

  return (
    <div className="login-screen authx-screen">
      {/* 装饰层：极光光斑 + 细网格（纯装饰，pointer-events:none，不参与任何交互） */}
      <div className="authx-aurora" aria-hidden="true" />
      <div className="authx-grid" aria-hidden="true" />

      <div className="authx-card">
        <header className="authx-brand">
          <span className="authx-logo"><img src={LOGO_SRC} alt="" /></span>
          <span className="authx-brand-text">
            <strong>PPcode</strong>
            <em>中转线路 · 一个账号开聊</em>
          </span>
        </header>

        <div className="authx-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "login"} className={tab === "login" ? "on" : ""}
            onClick={() => { setTab("login"); setStatus(""); }}>登录</button>
          <button type="button" role="tab" aria-selected={tab === "register"} className={tab === "register" ? "on" : ""}
            onClick={() => { setTab("register"); setStatus(""); }}>注册</button>
          <span className="authx-tab-ink" data-tab={tab} aria-hidden="true" />
        </div>

        {tab === "register" ? (
          <RegisterPanel
            baseUrl={(gateway.trim() || DEFAULT_GATEWAY).replace(/\/$/, "")}
            username={username.trim() || undefined}
            onLogin={onLogin}
            onBack={() => setTab("login")}
          />
        ) : (
          <div className="authx-panel">
            <div className="authx-aff" title={`邀请码 ${affiliate.code}`}>
              <Gift size={13} />
              <span>邀请归因：<b>{maskAffCode(affiliate.code)}</b></span>
              <em>{affSource}</em>
            </div>

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

            <details className="authx-adv">
              <summary>高级设置</summary>
              <label className="authx-field">
                <span>网关地址（sub2api 站点根地址，不带 /v1）</span>
                <div className="authx-input">
                  <Wallet size={14} />
                  <input value={gateway} onChange={(e) => setGateway(e.target.value)} placeholder={DEFAULT_GATEWAY} spellCheck={false} />
                </div>
              </label>
              <label className="authx-field">
                <span>界面昵称（选填）</span>
                <div className="authx-input">
                  <UserRound size={14} />
                  <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="登录后显示在左上角" />
                </div>
              </label>
            </details>

            {status && <div className="authx-error">{status}</div>}

            <button type="button" className="authx-primary" disabled={!canSubmit} onClick={() => void relayLogin()}>
              {busy ? <><Loader2 size={15} className="authx-spin" />正在登录并配置…</> : <><Sparkles size={15} />登录并开始使用</>}
            </button>

            <p className="authx-note">
              没有账号？切到上方「注册」——只需邮箱验证码，注册完自动登录并接好模型供应商。
            </p>
          </div>
        )}

        <button className="ghost login-skip authx-skip" onClick={onSkip}><WifiOff size={14} />暂时不登录，直接进入</button>
      </div>
    </div>
  );
}
