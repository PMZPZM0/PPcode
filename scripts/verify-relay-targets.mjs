/**
 * 中转站「候选链」判据（真跑，不是读代码）—— `src/lib/relay-targets.mjs`
 *
 * 起因（10-09 用户报障）：登录后自动生成供应商报「该网关没探测到可用模型」。
 * 根因是**只试了一个候选**（`subscriptions[0]`），那一个分组不可用就整链失败，
 * 且真实报错被通用文案吃掉。用户令：「自动新建密钥，分组选**已生效**的套餐，没有就用余额」。
 *
 * 跑法：node scripts/verify-relay-targets.mjs        （零依赖、不联网）
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RELAY_STATUS_ACTIVE,
  buildRelayCandidates,
  hasQuotaLeft,
  isSubscriptionEffective,
  keyNameForCandidate,
  orderEffectiveSubscriptions,
  pickReusableKey,
} from "../src/lib/relay-targets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
let fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log("  ✓ " + msg); }
  else { fail++; console.log("  ✗ " + msg); }
};
const section = (t) => console.log("\n" + t);

/** 固定的"现在"，避免用真实时间导致判据飘。 */
const NOW = Date.parse("2026-10-09T12:00:00Z");
const iso = (days) => new Date(NOW + days * 86_400_000).toISOString();
const sub = (over = {}) => ({
  id: 1, group_id: 11, group_name: "标准套餐", status: "active", expires_at: iso(30), ...over,
});

/* ── ① 「已生效」判定 ─────────────────────────────────────────────── */
section("① isSubscriptionEffective（已生效 = active 且未过期）");
ok(isSubscriptionEffective(sub(), NOW) === true, "active + 未过期 ⇒ 生效");
ok(isSubscriptionEffective(sub({ expires_at: iso(-1) }), NOW) === false, "active 但 expires_at 已过 ⇒ **不**生效（后台状态改写是异步的，不能只看 status）");
ok(isSubscriptionEffective(sub({ status: "expired" }), NOW) === false, "status=expired ⇒ 不生效");
ok(isSubscriptionEffective(sub({ status: "suspended" }), NOW) === false, "status=suspended ⇒ 不生效");
ok(isSubscriptionEffective(sub({ expires_at: null }), NOW) === true, "没写到期时间 ⇒ 按不过期处理（站点语义：缺省即有效）");
ok(isSubscriptionEffective(sub({ expires_at: "不是时间" }), NOW) === true, "时间解析不出来 ⇒ 不拿它当'已过期'的证据（宁可多试一个候选）");
ok(isSubscriptionEffective(null, NOW) === false && isSubscriptionEffective(undefined, NOW) === false, "null / undefined ⇒ 不生效（不抛异常）");
ok(SUBSCRIPTION_STATUS_ALIAS_CHECK(), "状态常量与上游 domain/constants.go 一致（active）");

function SUBSCRIPTION_STATUS_ALIAS_CHECK() { return RELAY_STATUS_ACTIVE === "active"; }

/* ── ② 额度窗口 ──────────────────────────────────────────────────── */
section("② hasQuotaLeft（日/周/月任一用满即视为当前打不动）");
ok(hasQuotaLeft({}) === true, "没有任何限额字段 ⇒ 不限量、有余量");
ok(hasQuotaLeft({ monthly_used_usd: 3, monthly_limit_usd: 10 }) === true, "月额度未用满 ⇒ 有余量");
ok(hasQuotaLeft({ monthly_used_usd: 10, monthly_limit_usd: 10 }) === false, "月额度用满 ⇒ 无余量");
ok(hasQuotaLeft({ daily_used_usd: 2, daily_limit_usd: 2 }) === false, "**日**额度用满也算无余量（只看月会漏判）");
ok(hasQuotaLeft({ weekly_used_usd: 9, weekly_limit_usd: 9 }) === false, "周额度用满也算无余量");
ok(hasQuotaLeft({ monthly_limit_usd: 0 }) === true, "limit=0 视为不限量（别把 0 当'用满'）");

/* ── ③ 排序 ──────────────────────────────────────────────────────── */
section("③ orderEffectiveSubscriptions（有额度 → 快到期的优先 → 无到期时间最后）");
{
  const exhausted = sub({ group_id: 21, group_name: "已用满", monthly_used_usd: 9, monthly_limit_usd: 9, expires_at: iso(1) });
  const fresh = sub({ group_id: 22, group_name: "有额度", expires_at: iso(9) });
  const order = orderEffectiveSubscriptions([exhausted, fresh], NOW);
  ok(order[0].group_id === 22, "还有额度的排在用满的前面（用满的仍留在候选里，只是靠后）");
  const soon = sub({ group_id: 31, expires_at: iso(2) });
  const late = sub({ group_id: 32, expires_at: iso(60) });
  ok(orderEffectiveSubscriptions([late, soon], NOW)[0].group_id === 31, "都还有额度时，**快到期的优先**（先把要过期的用掉）");
  const forever = sub({ group_id: 41, expires_at: null });
  const dated = sub({ group_id: 42, expires_at: iso(30) });
  ok(orderEffectiveSubscriptions([forever, dated], NOW)[0].group_id === 42, "没写到期时间的排最后（不限量/永久不急着用）");
  const a = sub({ id: 1, group_id: 51 }); const b = sub({ id: 2, group_id: 52 });
  const stable1 = orderEffectiveSubscriptions([a, b], NOW).map((s) => s.group_id).join(",");
  const stable2 = orderEffectiveSubscriptions([a, b], NOW).map((s) => s.group_id).join(",");
  ok(stable1 === stable2 && stable1 === "51,52", "同权重时保持站点返回顺序（稳定排序，两次结果一致）");
  ok(orderEffectiveSubscriptions([sub({ status: "expired" })], NOW).length === 0, "已过期的订阅不进候选（不会被误用）");
  ok(orderEffectiveSubscriptions(null, NOW).length === 0, "非数组入参 ⇒ 空数组（不抛异常）");
}

/* ── ④ 候选链 ────────────────────────────────────────────────────── */
section("④ buildRelayCandidates（用户令：分组选已生效的套餐，没有就用余额）");
{
  const onlyBalance = buildRelayCandidates([], NOW);
  ok(onlyBalance.length === 1 && onlyBalance[0].mode === "balance" && onlyBalance[0].groupId === null,
    "没有任何套餐 ⇒ 候选只有「余额」（不绑分组）");

  const withPlan = buildRelayCandidates([sub({ group_id: 7, group_name: "Pro" })], NOW);
  ok(withPlan.length === 2 && withPlan[0].mode === "plan" && withPlan[0].groupId === 7 && withPlan[1].mode === "balance",
    "有一个生效套餐 ⇒ 候选 = [该套餐分组, 余额]（**套餐优先**，余额兜底）");

  const mixed = buildRelayCandidates([sub({ status: "expired", group_id: 99 }), sub({ group_id: 7 })], NOW);
  ok(mixed.length === 2 && mixed[0].groupId === 7, "过期套餐不进候选（只有 生效套餐 + 余额 两项）");

  const exhausted = sub({ group_id: 8, group_name: "用满", monthly_used_usd: 5, monthly_limit_usd: 5 });
  const two = buildRelayCandidates([exhausted, sub({ group_id: 7, group_name: "有额度" })], NOW);
  ok(two[0].groupId === 7 && two[1].groupId === 8, "多个套餐：有余量的在前，用满的排后但仍保留（用满可能只是暂时）");

  const dup = buildRelayCandidates([sub({ group_id: 7 }), sub({ group_id: 7, expires_at: iso(90) })], NOW);
  ok(dup.filter((c) => c.groupId === 7).length === 1, "同一分组的多条订阅只出一个候选（去重，不重复建 key）");

  const noId = buildRelayCandidates([sub({ group_id: null, group_name: "无分组套餐" })], NOW);
  ok(noId.length === 1 && noId[0].mode === "balance", "订阅缺 group_id ⇒ 跳过（宁可走余额，也不建一把绑定不了的 key）");
}

/* ── ⑤ 复用已有密钥 ──────────────────────────────────────────────── */
section("⑤ pickReusableKey（复用优先于新建，且分组必须对得上）");
{
  const plan7 = { mode: "plan", groupId: 7, groupName: "Pro" };
  const keys = [
    { id: 1, name: "Harness-Pro", key: "sk-a", group_id: 7, status: "active" },
    { id: 2, name: "Harness-余额", key: "sk-b", group_id: null, status: "active" },
    { id: 3, name: "旧套餐组", key: "sk-c", group_id: 9, status: "active" },
    { id: 4, name: "停用的", key: "sk-d", group_id: 7, status: "disabled" },
  ];
  ok(pickReusableKey(keys, plan7)?.id === 1, "套餐候选复用**同分组**的 active key");
  ok(pickReusableKey(keys, { mode: "balance", groupId: null, groupName: "" })?.id === 2, "余额候选复用**无分组**的 active key");
  ok(pickReusableKey([keys[3]], plan7) === null, "非 active 的 key 不复用（会被网关拒，不如新建）");
  ok(pickReusableKey(keys.filter((k) => k.id !== 1), plan7) === null,
    "⛔ 余额 key 不会被套餐候选复用（否则套餐额度记到余额账上，用户查账对不上）");
  ok(pickReusableKey([], plan7) === null && pickReusableKey(null, plan7) === null, "空列表 / null ⇒ null（交给调用方新建）");
}

/* ── ⑥ 新建密钥命名 ──────────────────────────────────────────────── */
section("⑥ keyNameForCandidate");
ok(keyNameForCandidate({ mode: "balance", groupId: null, groupName: "" }) === "Harness-余额", "余额候选 ⇒ Harness-余额");
ok(keyNameForCandidate({ mode: "plan", groupId: 7, groupName: "Pro" }) === "Harness-Pro", "套餐候选 ⇒ Harness-<套餐名>");
ok(keyNameForCandidate({ mode: "plan", groupId: 7, groupName: "" }) === "Harness-7", "套餐名为空 ⇒ 退回 Harness-<groupId>（不留空名）");

/* ── ⑦ 源码接线（负向断言前先剥注释，否则被自己的说明顶红）─────────── */
section("⑦ relay.ts 的接线（候选链真被用上 / 旧的单候选写法不许复活）");
{
  const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
  const relaySrc = strip(readFileSync(path.join(ROOT, "src", "lib", "relay.ts"), "utf8"));

  ok(/for \(const cand of candidates\)/.test(relaySrc),
    "performRelayLogin **遍历**候选链（只试一个是 10-09 报障的根因）");
  ok(!/subscriptions\s*\[\s*0\s*\]/.test(relaySrc),
    "⛔ 不许再出现 `subscriptions[0]` 这种「只取第一个套餐」的写法");
  ok(/buildRelayCandidates\(/.test(relaySrc) && /pickReusableKey\(/.test(relaySrc) && /keyNameForCandidate\(/.test(relaySrc),
    "分组挑选 / 密钥复用 / 命名三件事都来自 relay-targets（单一真相源，不在 relay.ts 里各写一份）");
  ok(/diagnoseRelayGateway\(/.test(relaySrc),
    "失败后做只读诊断探测，把网关原话带出来（否则用户只看到「没探测到可用模型」）");
  ok(/failures\.map\(\(f\) => f\.label\)/.test(relaySrc),
    "失败信息里逐个列出试过的候选（用户能看出是哪个分组不行）");
  ok(/type RelayCandidate/.test(readFileSync(path.join(ROOT, "src", "lib", "relay.ts"), "utf8")),
    "候选类型从声明文件引入（.d.mts 与 .mjs 同源，避免退化成 any）");
  ok(/isNetworkFailure\(reason\)/.test(relaySrc) && /const note = \(label/.test(relaySrc),
    "网络层失败（连不上/超时/DNS）立即收尾 —— 换候选也一样连不上，别在站点里白建一串密钥");

  /* ⛔ 第二处入口（中转站面板的「登录后自动配置」）曾自己写了一份 `subs[0]`。
     两处判定分家 ⇒ 「登录页选了 A 分组、面板却激活 B 分组」这类错位查不出原因。 */
  const panelSrc = strip(readFileSync(path.join(ROOT, "src", "features", "relay", "RelayCenterPage", "use-relay-center-page-state.tsx"), "utf8"));
  ok(/buildRelayCandidates\(/.test(panelSrc),
    "中转站面板的「登录后自动配置」也走同一条候选链（不再自己写一份分组挑选）");
  ok(!/subs\s*\[\s*0\s*\]/.test(panelSrc),
    "⛔ 面板里也不许再出现 `subs[0]`（同一份规则只许有一个实现）");
}

/* ── ⑧ 全仓扫描：三处入口都必须同源，且不许再有「只取第一个订阅」────────── */
section("⑧ 全仓扫描（防止第 N 处又自己写一份分组挑选）");
{
  const walk = (dir, out = []) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, out);
      else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
    }
    return out;
  };
  const strip = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("//") && !line.trim().startsWith("*"))
    .join("\n");
  const files = walk(path.join(ROOT, "src"));
  const offenders = files.filter((file) => /subs\s*\[\s*0\s*\]|subscriptions\s*\[\s*0\s*\]/.test(strip(readFileSync(file, "utf8"))));
  ok(offenders.length === 0,
    `全仓 src/ 下不再有「只取第一个订阅」的写法（${files.length} 个文件已扫，命中 ${offenders.length}`
    + (offenders.length ? "：" + offenders.map((f) => path.relative(ROOT, f)).join("、") : "") + "）");

  const consumers = [
    "src/lib/relay.ts",
    "src/features/relay/RelayCenterPage/use-relay-center-page-state.tsx",
    "src/features/app-state/parts/part03/03-restart-file-model-editor/01-restart-file-preview.tsx",
  ].filter((rel) => /from\s+"[^"]*relay-targets\.mjs"/.test(readFileSync(path.join(ROOT, rel), "utf8")));
  ok(consumers.length === 3, `三个入口（登录链 / 中转站面板 / 模型页一键切换）都从 relay-targets 取规则（${consumers.length}/3）`);
}

console.log(`\n【中转站候选链】${pass}/${pass + fail} 通过`);
process.exit(fail ? 1 : 0);