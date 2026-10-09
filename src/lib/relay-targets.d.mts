/** 中转站候选链纯函数（`src/lib/relay-targets.mjs`）的类型声明。
 *  ⛔ 与 .mjs 同目录同基名：`build.files` 收的是 `src/lib/*.mjs`，声明文件不参与打包但
 *     TS 编译需要它，否则 `import ... from "./relay-targets.mjs"` 会退化成 any。 */

/** 建密钥 / 选计费的候选：plan = 绑某个已生效套餐的分组；balance = 不绑分组走余额。 */
export type RelayCandidate = {
  mode: "plan" | "balance";
  groupId: number | null;
  groupName: string;
  /** 给用户看的名字（失败信息里逐个列出来，别只报"失败"） */
  label: string;
};

export declare const RELAY_STATUS_ACTIVE: "active";

/** 订阅是否已生效：状态 active（或未给）且未过期。 */
export declare function isSubscriptionEffective(sub: unknown, nowMs?: number): boolean;

/** 订阅的日/周/月额度窗口是否都还有余量。 */
export declare function hasQuotaLeft(sub: unknown): boolean;

/** 已生效订阅的尝试顺序：有额度 → 快到期的优先 → 无到期时间最后。 */
export declare function orderEffectiveSubscriptions(subs: unknown, nowMs?: number): any[];

/** 候选链：已生效套餐（顺序同上）→ 余额。至少含一个候选（余额）。 */
export declare function buildRelayCandidates(subs: unknown, nowMs?: number): RelayCandidate[];

/** 该候选能复用的已有密钥（active 且分组匹配）；没有返回 null。 */
export declare function pickReusableKey(keys: unknown, candidate: RelayCandidate | null): any | null;

/** 自动新建密钥的名字。 */
export declare function keyNameForCandidate(candidate: RelayCandidate | null): string;
