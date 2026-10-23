/**
 * PPTokenEndpoints（从 src/App.tsx 原样搬来，实现未改）。
 * 搬到 lib：本域与 App 其它地方都要用，不能一边一份。
 */


export const PPTokenEndpoints = [
  { id: "pptoken", name: "PPcode", label: "API 端点默认（大陆优化线路）", url: "https://cn.pptoken.cc/v1" },
  { id: "pptoken-intl", name: "PPcode 国际线路", label: "国际线路 · 需要代理", url: "https://api.pptoken.cc/v1" },
  { id: "pptoken-us", name: "PPcode 北美线路", label: "北美线路 · 需要代理", url: "https://us.pptoken.cc/v1" },
  { id: "pptoken-claude", name: "PPcode Claude", label: "Claude 模型 · 专用地址", url: "https://api.pptoken.cc" },
];

