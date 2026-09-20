/* 推送链路端到端（**不联网**）：合成 K 线 → 算信号 → 按清单过滤 → 拼推送文案
 *
 * 为什么要这一层：单测只能证明"规则算对了"，证明不了"用户收到的消息是对的"。
 * 用户唯一直接看到的就是那条微信消息，所以从 K 线一路走到文案，必须整条链路都验。
 * 覆盖用户 2026-09-17 的需求：
 *   「持仓股……日线开盘、收盘价格连续 2 天及以上都高于 5 日线价格，就提醒卖出显示及信息提示」
 *   ——即：持仓股的这类信号要进【卖出/离场提醒】；只监控还没买的票不该收到"卖出"。
 *
 * 运行：node _tests/signals-push-test.js
 */
'use strict';
const S = require('D:/mywork/stock-alert-cloud/signal-core.js');
const SG = require('D:/mywork/stock-alert-cloud/signals.js');

let pass = 0, fail = 0; const fails = [];
function ok(cond, name) { if (cond) pass++; else { fail++; fails.push(name); } }
function eq(a, b, name) { ok(a === b, name + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）'); }
function has(text, sub, name) { ok(String(text).indexOf(sub) >= 0, name + '（没找到「' + sub + '」）'); }
function notHas(text, sub, name) { ok(String(text).indexOf(sub) < 0, name + '（不该出现「' + sub + '」）'); }

/* ---------------- 合成 K 线（与 signal-core-test 同构） ---------------- */
const dates = (() => {
  const out = []; const d = new Date(2026, 0, 5);
  for (let i = 0; i < 200; i++) { out.push(d.toISOString().slice(0, 10)); d.setDate(d.getDate() + 1); }
  return out;
})();
function mkBars(closes, opens) {
  return closes.map((c, i) => {
    const o = (opens && opens[i] !== undefined) ? opens[i] : c;
    return { d: dates[i], o: o, c: c, h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, v: 1000 };
  });
}
const flat = (n, p) => new Array(n).fill(p);

/* ★ 底座必须是**多头排列**（MA5 > MA10 > MA20 > MA30）：
   用户 2026-09-17 追加的前提 ——「5 日线大于 10 日线，10 日线大于 20 日线，
   20 日线大于 30 日线情况下才有效，其他情况不触发判断」。
   因此改用 40 根缓涨（9.00 → 10.00）+ 1 根回落到 9.70 当断口当底仓；
   原来那 20 根横盘底座现在会让 ma5Streak 恒返回 0，规则永远不触发。 */
function rampBase() {
  const out = [];
  for (let i = 0; i < 40; i++) out.push(9 + i / 39);
  return out.concat([9.70]);               // 断口：这根收在 5 日线下
}
/** 反例底座：40 根阴跌 12.00 → 10.00（空头排列），用来证明前提真的在挡 */
function bearBase() {
  const out = [];
  for (let i = 0; i < 40; i++) out.push(12 - 2 * i / 39);
  return out;
}
const TAIL_C = [9.90, 10.20, 10.40, 10.60, 10.80];
const TAIL_O = [9.85, 10.50, 10.40, 10.70, 10.70];

/* 多头排列底仓 + 最后 5 根温和上行 → 最近连续 4 天开收盘都站在各自 5 日线上，
   且 5 日乖离只有 +4.05%（**不足以触发 HOT_MA5_BIAS**）——
   正好证明新规则的价值：门槛更低，用户口径的"连续 2 天以上"就能提醒。 */
const BARS = mkBars(rampBase().concat(TAIL_C), rampBase().concat(TAIL_O));
const LAST_DAY = BARS[BARS.length - 1].d;
const TODAY = '2026-09-17';

/* ---------------- ① 规则本身 ---------------- */
const r = S.evaluate(BARS);
ok(!!r, 'evaluate 有结果（K 线足够）');
eq(!!r.signals.find(s => s.rule === 'MA5_STREAK_EXIT'), true, '★ 触发 MA5_STREAK_EXIT');
eq(!!r.signals.find(s => s.rule === 'HOT_MA5_BIAS'), false, '乖离不足 → HOT_MA5_BIAS 不触发（两个规则互不干扰）');
eq(S.ma5Streak(BARS).days, 4, 'ma5Streak 天数 = 4');
eq(S.maAlign(BARS).ok, true, '★ 这段是多头排列（MA5 > MA10 > MA20 > MA30）');

/* ★ 同一条尾巴、只把底座换成空头排列 → 一律不触发、天数 0。
   证明用户新加的「多头排列才有效」前提是**真的在链路上生效**，不是只写在注释里。 */
const BEAR_BARS = mkBars(bearBase().concat(TAIL_C), bearBase().concat(TAIL_O));
eq(S.maAlign(BEAR_BARS).ok, false, '★ 阴跌底座 → 空头排列，前提不成立');
eq(!!S.evaluate(BEAR_BARS).signals.find(s => s.rule === 'MA5_STREAK_EXIT'), false,
  '★ 空头排列 → 同一条尾巴也不推 MA5_STREAK_EXIT');
eq(S.ma5Streak(BEAR_BARS).days, 0, '★ 空头排列 → 天数 0（持仓页同样不显示）');

/* 模拟 signals.js main() 里把信号装进存档条目的过程 */
function toFresh(sigs, list, name, code) {
  return S.signalsForList(sigs, list).map(s => ({
    id: code + '|' + s.rule + '|' + s.at, code: code, name: name, list: list,
    rule: s.rule, side: s.side, title: s.title, detail: s.detail,
    price: s.price, at: s.at, ruleVersion: S.RULE_VERSION, verdict: null
  }));
}

/* ---------------- ② 持仓股：要进「卖出提醒」栏 ---------------- */
const holdFresh = toFresh(r.signals, 'holdings', '贵州茅台', '600519');
{
  const ex = holdFresh.find(s => s.rule === 'MA5_STREAK_EXIT');
  ok(!!ex, '★ 持仓股 → MA5_STREAK_EXIT 被保留');
  eq(ex && ex.side, 'sell', '方向是卖出');
  eq(ex && ex.at, LAST_DAY, '信号日期 = 最后一根 K 线（今天）');
  eq(ex && ex.price, 10.8, '信号价 = 最后一根收盘价');
  has(ex && ex.detail, '连续 4 天', '详情写出真实的连续天数（不是写死 2）');
  has(ex && ex.detail, '不是必须清仓', '详情说清是减仓提示，不是必须清仓的硬指令');

  const msg = SG.buildMessage(holdFresh, TODAY);
  eq(msg.title, '持仓信号 09-17 · ' + holdFresh.length + ' 条', '推送标题：日期 + 条数');
  has(msg.content, '【卖出/离场提醒】', '★ 进了「卖出/离场提醒」栏');
  has(msg.content, '贵州茅台 600519（持仓）', '文案带股票名 + 代码 + 清单归属');
  has(msg.content, '连续站上 5 日线', '文案带信号标题');
  has(msg.content, '连续 4 天', '文案带天数（和持仓页显示同一个数）');
  has(msg.content, '非投资建议', '保留免责声明');
  notHas(msg.content, '【企稳/介入观察】', '没有介入类信号就不该出现介入栏标题');
}

/* ---------------- ③ 只监控、还没买：不该收到「卖出」 ---------------- */
{
  const monFresh = toFresh(r.signals, 'monitor', '贵州茅台', '600519');
  eq(!!monFresh.find(s => s.rule === 'MA5_STREAK_EXIT'), false, '★ 对没买的票不喊卖出');
  eq(monFresh.length, holdFresh.length - 1, '监控清单只少了「连续站上 5 日线」这一条（其它信号照发）');
  eq(!!monFresh.find(s => s.rule === 'NEAR_PREV_HIGH'), true, '同一条 K 线的其它卖出信号不受影响（过滤是定向的）');
  const oth = S.signalsForList([{ rule: 'TREND_BREAK' }, { rule: 'BOTTOM_RECLAIM' }], 'monitor');
  eq(oth.length, 2, '监控清单仍收其它规则（过滤只针对 5 日线卖出提醒）');
}

/* ---------------- ④ 卖出 + 介入同时有：两栏都在，卖出在前 ---------------- */
{
  const m = SG.buildMessage([
    { name: '甲', code: '600000', list: 'holdings', side: 'sell', title: '连续站上 5 日线', detail: 'D1' },
    { name: '乙', code: '000001', list: 'monitor', side: 'buy', title: '超跌企稳', detail: 'D2' },
    { name: '丙', code: '600036', list: 'both', side: 'sell', title: '跌破 20 日线', detail: 'D3' }
  ], TODAY);
  eq(m.title, '持仓信号 09-17 · 3 条', '标题条数按全部新信号算');
  has(m.content, '【卖出/离场提醒】', '有卖出栏');
  has(m.content, '【企稳/介入观察】', '有介入栏');
  ok(m.content.indexOf('【卖出/离场提醒】') < m.content.indexOf('【企稳/介入观察】'), '卖出栏排在介入栏之前');
  has(m.content, '甲 600000（持仓）', '清单归属：持仓');
  has(m.content, '丙 600036（持仓+监控）', '清单归属：持仓+监控');
  has(m.content, '乙 000001（监控）', '清单归属：监控');
  has(m.content, 'D1', '卖出条目的详情带上了');
  has(m.content, 'D2', '介入条目的详情带上了');
}

/* ---------------- ⑤ 边界 ---------------- */
{
  const m0 = SG.buildMessage([], TODAY);
  eq(m0.title, '持仓信号 09-17 · 0 条', '空列表也能拼出标题（main 里会先拦掉，不会推）');
  eq(!!SG.buildMessage, true, 'buildMessage 已导出（可被测试直接调用）');
  eq(SG.buildMessage([{ name: 'x', code: 'x', list: 'weird', side: 'sell', title: 't', detail: 'd' }], TODAY)
    .content.indexOf('（weird）') >= 0, true, '未知清单类型兜底显示原值，不显示 undefined');
}

console.log('');
console.log('========================================================');
console.log('推送链路端到端测试：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  ✗ ' + f)); }
else console.log('ALL GREEN');
console.log('========================================================');
process.exit(fail ? 1 : 0);
