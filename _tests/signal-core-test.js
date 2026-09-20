/* 信号引擎核心算法 · 单元测试（私有）
 * 覆盖 signal-core.js 的全部对外函数，并校验「注入到 console.html 的那一份」逐字一致。
 * 运行：node _tests/signal-core-test.js
 */
'use strict';
const fs = require('fs');
const S = require('D:/mywork/stock-alert-cloud/signal-core.js');

let pass = 0, fail = 0; const fails = [];
function ok(cond, name) { if (cond) pass++; else { fail++; fails.push(name); } }
function eq(a, b, name) { ok(a === b, name + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）'); }
function near(a, b, name, tol) { ok(Math.abs(a - b) <= (tol || 1e-9), name + '（期望≈' + b + '，实际 ' + a + '）'); }

/* ---------------- 测试数据构造 ---------------- */
// 生成连续交易日字符串（只用字符串相等来对齐，格式不重要）
const dates = (() => {
  const out = []; const d = new Date(2026, 0, 5);
  for (let i = 0; i < 200; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
})();

/** 由收盘价数组造 K 线；open 默认=收盘（不开盘缺口，避免误触发开盘类规则），high/low 包住开收 */
function mkBars(closes, opens, vols, startIdx) {
  const out = [];
  for (let i = 0; i < closes.length; i++) {
    const c = closes[i];
    const o = (opens && opens[i] !== undefined) ? opens[i] : c;
    const v = (vols && vols[i] !== undefined) ? vols[i] : 1000;
    out.push({
      d: dates[(startIdx || 0) + i], o: o, c: c,
      h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, v: v
    });
  }
  return out;
}
const flat = (n, p) => new Array(n).fill(p);
const findSig = (r, rule) => (r && r.signals) ? r.signals.find(s => s.rule === rule) : undefined;

/* ---------------- num / normBars ---------------- */
ok(isNaN(S.num('')), 'num("") → NaN');
ok(isNaN(S.num(null)), 'num(null) → NaN');
eq(S.num('3.5'), 3.5, 'num("3.5") → 3.5');

{
  const nb = S.normBars([
    ['2026-01-03', 10, 10.5, 10.6, 9.9, 100],
    ['2026-01-01', 9, 9.2, 9.4, 8.8, 80],
    ['2026-01-02', 0, 0, 0, 0, 0],            // 收盘 0 → 丢弃（停牌）
    ['2026-01-04', 11, 10.8, 10.5, 11.2, 90], // 高低倒挂 → 丢弃
    ['2026-01-05', 11, 11.2, 11.4, 10.9, 120],
    null
  ]);
  eq(nb.length, 3, 'normBars 丢弃停牌/倒挂行，剩 3 根');
  eq(nb[0].d, '2026-01-01', 'normBars 按日期升序排列');
  eq(nb[2].d, '2026-01-05', '第三根是 01-05');
  eq(S.normBars(null).length, 0, 'normBars(null) → []');
  eq(S.normBars([]).length, 0, 'normBars([]) → []');
}

/* ---------------- sma / maAt / bias ---------------- */
{
  const r = S.sma([1, 2, 3, 4, 5], 3);
  ok(isNaN(r[0]) && isNaN(r[1]), 'sma 前 n-1 位为 NaN');
  eq(r[2], 2, 'sma[2] = (1+2+3)/3');
  eq(r[4], 4, 'sma[4] = (3+4+5)/3');
}
{
  const bars = mkBars([1, 2, 3, 4, 5]);
  eq(S.maAt(bars, 4, 3), 4, 'maAt(末位,3) = (3+4+5)/3');
  eq(S.maAt(bars, 4, 5), 3, 'maAt(末位,5) = 全均值');
  ok(isNaN(S.maAt(bars, 1, 3)), 'maAt 数据不足 → NaN');
  ok(isNaN(S.maAt(null, 4, 3)), 'maAt(null,...) → NaN 不抛异常');
}
ok(Math.abs(S.bias(11, 10) - 0.1) < 1e-9, 'bias(11,10) = +10%（浮点容差）');
ok(Math.abs(S.bias(9, 10) + 0.1) < 1e-9, 'bias(9,10) = −10%');
ok(isNaN(S.bias(11, NaN)), 'bias 均线 NaN → NaN');
ok(isNaN(S.bias(11, 0)), 'bias 均线 0 → NaN');

/* ---------------- highestHigh / highestClose（必须不含当日） ---------------- */
{
  const bars = mkBars([10, 10, 10, 12, 11]);
  bars[3].h = 12; bars[4].h = 11;
  eq(S.highestHigh(bars, 4, 2), 12, 'highestHigh(2根) 取前一日 12（不含当日 11）');
  eq(S.highestHigh(bars, 4, 1), 11, 'highestHigh(1根) 就是当日');
  eq(S.highestClose(bars, 4, 4), 12, 'highestClose(4根) = 12');
  ok(isNaN(S.highestHigh([], 0, 5)), 'highestHigh 空数组 → NaN');
}

/* ---------------- indicatorsAt：数据不足必须返回 null ---------------- */
eq(S.indicatorsAt(mkBars(flat(15, 10)), 14), null, '不足 20 根 → 不硬给指标');
eq(S.indicatorsAt(null, 0), null, 'indicatorsAt(null) → null');

/* ---------------- 规则1 HOT_MA5_BIAS：连续2日站上5日线 + 乖离 ≥6% ---------------- */
{
  // 20 根横盘 10 元，最后 5 根拉升：10 → 10.8 → 11.6 → 12.4 → 13.2
  const closes = flat(20, 10).concat([10, 10.8, 11.6, 12.4, 13.2]);
  const opens = flat(20, 10).concat([10, 11.5, 11.6, 12.9, 13.0]);
  const bars = mkBars(closes, opens);
  const r = S.evaluate(bars);
  const s = findSig(r, 'HOT_MA5_BIAS');
  ok(!!s, '连续2日站上5日线且乖离 +13.8% → 触发「短线过热」');
  eq(s && s.side, 'sell', '短线过热是卖出方向');
  ok(String(s && s.detail).indexOf('5 日乖离') >= 0, '详情里带乖离率数值');

  // 乖离只有 +3.8%，不够热 → 不触发
  const closes2 = flat(20, 10).concat([10, 10.2, 10.4, 10.6, 10.8]);
  const opens2 = flat(20, 10).concat([10, 10.5, 10.4, 10.7, 10.7]);
  eq(findSig(S.evaluate(mkBars(closes2, opens2)), 'HOT_MA5_BIAS'), undefined, '乖离 +3.8% 不足阈值 → 不触发');

  // 乖离够大，但这 2 天里有 1 天开盘没站上自己的 5 日线 → 不触发（连续性被打破）
  const closes3 = flat(20, 10).concat([10, 10.8, 11.6, 12.4, 13.2]);
  const opens3 = flat(20, 10).concat([10, 11.5, 11.6, 10.0, 13.0]);  // 倒数第 2 天低开破线
  eq(findSig(S.evaluate(mkBars(closes3, opens3)), 'HOT_MA5_BIAS'), undefined, '倒数第 2 天开盘在 5 日线下 → 不触发');

  // 3 天前断过、但最近 2 天连续站上 → 触发（规则只看最近 N 天的连续性）
  const closes5 = flat(20, 10).concat([10, 10.8, 9.0, 12.4, 13.2]);
  const opens5 = flat(20, 10).concat([10, 11.5, 9.2, 12.9, 13.0]);
  ok(!!findSig(S.evaluate(mkBars(closes5, opens5)), 'HOT_MA5_BIAS'), '断口在 3 天前、最近 2 天连续站上 → 仍触发');
}

/* ---------------- 规则1b MA5_STREAK_EXIT：连续 ≥2 天开收盘站上 5 日线（**不加乖离条件**）
     用户 2026-09-17 指定；与 HOT_MA5_BIAS 的唯一区别就是「不看乖离」

     ★ 同日追加前提（用户原话）：「当 5 日线大于 10 日线，10 日线大于 20 日线，
       20 日线大于 30 日线情况下才有效，其他情况不触发判断。」
       → 所以下面造 K 线时必须先有一段够长（≥30 根）的多头排列底仓，
         否则 days 恒为 0，用例就没有意义了。 */
/** 多头排列底仓：线性缓涨 9.00 → 10.00（45 根），短均线必然大于长均线；
    末尾再来一根回落到 5 日线下方当**断口** —— 没有它的话，底仓尾部那几天
    自己也站在 5 日线上，会被算进"连续天数"里。 */
function alignedBase() {
  const out = [];
  for (let i = 0; i < 45; i++) out.push(9 + i / 44);
  out.push(9.70);
  return out;
}
/** 空头排列底仓：线性阴跌 12.00 → 10.00（45 根），短均线必然小于长均线 */
function bearBase() {
  const out = [];
  for (let i = 0; i < 45; i++) out.push(12 - 2 * i / 44);
  return out;
}

/* ---- 1b-0 maAlign：多头排列判定本身（单一真源，规则与界面都走它） ---- */
{
  const bOK = mkBars(alignedBase());
  const a1 = S.maAlign(bOK);
  ok(a1.ok, '★ 线性缓涨（9→10，45 根）→ 判定为多头排列');
  ok(a1.ma5 > a1.ma10 && a1.ma10 > a1.ma20 && a1.ma20 > a1.ma30, '★ 逐级递减：MA5 > MA10 > MA20 > MA30');
  ok(Math.abs(a1.ma5 - S.maAt(bOK, bOK.length - 1, 5)) < 1e-9, 'maAlign 用的是「截止当日」的均线（与 maAt 同源）');

  ok(!S.maAlign(mkBars(flat(40, 10))).ok, '完全横盘（四条均线相等）→ 不算多头排列（要求严格大于）');
  ok(!S.maAlign(mkBars(bearBase())).ok, '空头排列（MA5 < MA10 < MA20 < MA30）→ 不算多头排列');
  ok(!S.maAlign(mkBars(new Array(25).fill(10).concat([10.6, 11.2]))).ok,
    '★ K 线不足 30 根（次新股）→ 算不出 30 日线 → 前提不成立（不硬算）');
  ok(!S.maAlign(null).ok && !S.maAlign([]).ok, 'maAlign(null / []) → ok=false，不抛异常');
  eq(typeof S.maAlign, 'function', 'maAlign 已导出（两端同源）');
}

{
  // 多头排列 + 连续站上 3 天、但 5 日乖离只有 +3.5%：HOT 不触发，MA5_STREAK_EXIT 要触发
  const tail = [10.4, 10.5, 10.6];
  const bars2 = mkBars(alignedBase().concat(tail), alignedBase().concat(tail));
  ok(S.maAlign(bars2).ok, '（前置）这段 K 线确实是多头排列');
  const r2 = S.evaluate(bars2);
  eq(findSig(r2, 'HOT_MA5_BIAS'), undefined, '乖离 +3.5% 不足 → HOT_MA5_BIAS 不触发');
  const e2 = findSig(r2, 'MA5_STREAK_EXIT');
  ok(!!e2, '★ 多头排列 + 连续站上 → MA5_STREAK_EXIT 触发（新规则的意义：门槛比 HOT 更低）');
  eq(e2 && e2.side, 'sell', 'MA5_STREAK_EXIT 是卖出方向');
  ok(String(e2 && e2.detail).indexOf('连续 3 天') >= 0, '详情写出真实天数（3 天，不是写死的 2）');
  ok(String(e2 && e2.detail).indexOf('多头排列') >= 0, '★ 详情说明这是在多头排列前提下成立的（让用户看懂为什么这次会推）');
  ok(String(e2 && e2.detail).indexOf('不是必须清仓') >= 0, '详情说清是减仓提示、不是必须清仓');
  const st2 = S.ma5Streak(bars2);
  eq(st2.days, 3, '★ 推送天数与持仓页标识天数同源（都是 3 天）');
  eq(st2.aligned, true, 'ma5Streak 回报 aligned=true');

  // 只有最后 1 天站上 → 不触发（用户口径：1 天只标天数、不提醒卖出）
  const bars1 = mkBars(alignedBase().concat([11.0]));
  ok(S.maAlign(bars1).ok, '（前置）只站上 1 天的这段也是多头排列');
  eq(findSig(S.evaluate(bars1), 'MA5_STREAK_EXIT'), undefined, '只站上 1 天 → 不触发卖出提醒');
  eq(S.ma5Streak(bars1).days, 1, '同一条 K 线 ma5Streak 给出 1 天');
  eq(S.ma5Streak(bars1).sig, 'watch', '1 天 → sig=watch（界面只标天数）');

  // 倒数第 2 天开盘破线 → 连续性断在那里，只剩 1 天 → 不触发
  const c3 = alignedBase().concat([11.0, 12.0]);
  const o3 = alignedBase().concat([9.0, 12.0]);       // 倒数第 2 天开盘砸到 5 日线下
  const bars3 = mkBars(c3, o3);
  ok(S.maAlign(bars3).ok, '（前置）这段仍是多头排列（前提只看收盘均线）');
  eq(findSig(S.evaluate(bars3), 'MA5_STREAK_EXIT'), undefined,
    '倒数第 2 天开盘在 5 日线下 → 连续天数退回 1 → 不触发');

  // 断口在 3 天前、最近 2 天连续站上 → 触发（只看最近这段连续性）
  const bars5 = mkBars(alignedBase().concat([10.5, 9.9, 12.0, 12.2]));
  ok(S.maAlign(bars5).ok, '（前置）这段是多头排列');
  const e5 = findSig(S.evaluate(bars5), 'MA5_STREAK_EXIT');
  ok(!!e5, '断口在前几天、最近 2 天连续站上 → 触发');
  ok(String(e5 && e5.detail).indexOf('连续 2 天') >= 0, '天数按「最近连续段」算 = 2 天');
}

/* ---- 1b-1 ★ 新前提的核心用例：非多头排列时，即使连续站上 5 日线也不触发 ---- */
{
  /* 空头排列（12 → 10 阴跌）+ 最后 3 天反弹。
     前置检查会证明「最后两天确实站在各自的 5 日线上」，
     所以能挡住它的只可能是多头排列前提，而不是"本来就没站上"。 */
  const barsZ = mkBars(bearBase().concat([9.6, 10.6, 10.8]));
  const n0 = barsZ.length - 1;
  ok(barsZ[n0].c > S.maAt(barsZ, n0, 5) && barsZ[n0 - 1].c > S.maAt(barsZ, n0 - 1, 5),
    '（前置）最后两天确实收在各自的 5 日线上 —— 原本够触发连续天数');
  ok(!S.maAlign(barsZ).ok, '★ 但均线是空头排列（MA5 < 10 < 20 < 30）');
  const stZ = S.ma5Streak(barsZ);
  eq(stZ.days, 0, '★ 空头排列 → days 直接 0（用户："其他情况不触发判断"）');
  eq(stZ.sig, null, '★ sig=null → 持仓页不渲染任何 5 日线标识');
  eq(stZ.aligned, false, 'ma5Streak 回报 aligned=false');
  eq(findSig(S.evaluate(barsZ), 'MA5_STREAK_EXIT'), undefined, '★ 空头排列 → 推送也不触发');

  // 一路阴跌、连 5 日线都没站上 → 同样不触发，天数 0
  const barsD = mkBars([12, 11.8, 11.6, 11.4, 11.2, 11.0, 10.8, 10.6, 10.4, 10.2].concat(flat(20, 10)));
  eq(findSig(S.evaluate(barsD), 'MA5_STREAK_EXIT'), undefined, '跌势中没站上 5 日线 → 不触发');
  eq(S.ma5Streak(barsD).days, 0, '没站上 → ma5Streak 天数 0');

  // 多头排列但当天没站上 → days=0（前提成立也不该硬给天数）
  // 9.90：仍满足 MA5>MA10>MA20>MA30（多头排列），但收盘落在 5 日线下方
  const barsN = mkBars(alignedBase().concat([9.90]));
  ok(S.maAlign(barsN).ok, '（前置）这段是多头排列');
  eq(S.ma5Streak(barsN).days, 0, '多头排列 + 当天收在 5 日线下 → days=0');
}

/* ---------------- 版本与阈值：新增规则必须升版本（胜率按版本分开统计） ---------------- */
eq(S.RULE_VERSION, 'R3', 'RULE_VERSION 已升到 R3（R2 → R3 是多头排列前提这一版；改规则必须升版本）');
eq(S.P.ma5ExitDays, 2, 'MA5_STREAK_EXIT 阈值 = 连续 2 天（用户 2026-09-17 指定）');
eq(JSON.stringify(S.P.alignMas), '[5,10,20,30]', '★ 多头排列要比较的均线 = 5/10/20/30（用户 2026-09-17 指定）');

/* ---------------- signalsForList：清单语义（卖出提醒只对持仓股发） ---------------- */
{
  const sigs = [
    { rule: 'MA5_STREAK_EXIT', side: 'sell' },
    { rule: 'HOT_MA5_BIAS', side: 'sell' },
    { rule: 'BOTTOM_RECLAIM', side: 'buy' }
  ];
  const mon = S.signalsForList(sigs, 'monitor');
  eq(mon.length, 2, '监控清单：5 日线连续站上被滤掉，剩 2 条');
  eq(mon.find(s => s.rule === 'MA5_STREAK_EXIT'), undefined, '★ 只监控、还没买的票不收「连续站上 5 日线 → 卖出」');
  ok(!!mon.find(s => s.rule === 'BOTTOM_RECLAIM'), '监控清单仍收介入类信号');
  eq(S.signalsForList(sigs, 'holdings').length, 3, '持仓清单：全收（含 5 日线卖出提醒）');
  eq(S.signalsForList(sigs, 'both').length, 3, '"持仓+监控" 按持仓算，全收');
  eq(S.signalsForList(null, 'holdings').length, 0, 'signalsForList(null) → []');
  const copy = S.signalsForList(sigs, 'holdings');
  copy.pop();
  eq(sigs.length, 3, '返回的是副本，改它不会动原数组');
}


/* ---------------- 规则2 NEAR_PREV_HIGH：触及 60 日前高压力位 ---------------- */
{
  // 60 日内：前段 12 元平台（high 12.12）→ 回落到 10 → 现价 11.95（距前高 1.4%）
  const closes = flat(40, 12).concat(flat(15, 10)).concat([10.2, 10.6, 11.0, 11.4, 11.95]);
  const bars = mkBars(closes);
  const s = findSig(S.evaluate(bars), 'NEAR_PREV_HIGH');
  ok(!!s, '收盘距 60 日前高不足 2% → 触发「触及前高压力位」');
  ok(String(s && s.detail).indexOf('前高 12.12') >= 0, '详情带前高价位');
  ok(String(s && s.detail).indexOf('套牢盘') >= 0, '详情解释了为什么是压力');

  // 离前高还有 8% → 不触发
  const closes2 = flat(40, 12).concat(flat(15, 10)).concat([10.2, 10.6, 11.0, 11.4, 11.1]);
  eq(findSig(S.evaluate(mkBars(closes2)), 'NEAR_PREV_HIGH'), undefined, '距前高 8% → 不触发');

  // 已有效突破前高 5% 以上 → 不再提示（那不是压力，是新高）
  const closes3 = flat(40, 12).concat(flat(15, 10)).concat([10.2, 10.6, 11.0, 11.4, 12.9]);
  eq(findSig(S.evaluate(mkBars(closes3)), 'NEAR_PREV_HIGH'), undefined, '已突破前高 5% 以上 → 不触发');

  // 一路缓慢新高：现价只比"前高"高 1.9%（在 2% 容差内）→ 仍提示（贴着前高震荡）
  const closes4 = flat(59, 10).concat([10.3]);
  ok(!!findSig(S.evaluate(mkBars(closes4)), 'NEAR_PREV_HIGH'), '贴着前高（+1.9%）→ 仍触发');
}

/* ---------------- 规则3 TREND_BREAK：跌破 20 日线且趋势线向下 ---------------- */
{
  // 上升段后回落：close 10.5 < MA20，MA20 走平向下
  const closes = flat(30, 12).concat([11.8, 11.5, 11.2, 10.9, 10.6, 10.3]);
  const bars = mkBars(closes);
  const s = findSig(S.evaluate(bars), 'TREND_BREAK');
  ok(!!s, '收盘跌破 20 日线且均线向下 → 触发「跌破 20 日线」');
  eq(s && s.side, 'sell', '跌破 20 日线是卖出方向');

  // 均线仍在上行（升势中的回踩）→ 不触发
  const closes2 = flat(30, 9).concat(flat(9, 14)).concat([11.0]);
  eq(findSig(S.evaluate(mkBars(closes2)), 'TREND_BREAK'), undefined, '20 日线仍在上行 → 不触发（升势回踩不算离场）');
}

/* ---------------- 规则4 GRIND_DOWN：持续阴跌（用户点名要杜绝的） ---------------- */
{
  // 50 根横盘 10 元 + 最后 10 根每天 −2.5%（无反弹）→ 区间 −22%，逐日都在 20 日线下
  const closes = flat(50, 10);
  let p = 10;
  for (let i = 0; i < 10; i++) { p = p * 0.975; closes.push(Number(p.toFixed(4))); }
  const s = findSig(S.evaluate(mkBars(closes)), 'GRIND_DOWN');
  ok(!!s, '连续 10 日收在 20 日线下、区间 −22%、无反弹 → 触发「持续阴跌」');
  ok(String(s && s.detail).indexOf('20 日线下方') >= 0, '详情说明连续天数');

  // 跌幅只有 −5%，够不上"阴跌" → 不触发
  const closes2 = flat(50, 10);
  p = 10;
  for (let i = 0; i < 10; i++) { p = p * 0.994; closes2.push(Number(p.toFixed(4))); }
  eq(findSig(S.evaluate(mkBars(closes2)), 'GRIND_DOWN'), undefined, '10 日只跌 5.8% → 不触发（正常回调范围）');

  // 跌幅够，但期间有 2 天单日 +4% 的反弹 → 不是阴跌，是宽幅震荡 → 不触发
  const closes3 = flat(50, 10);
  p = 10;
  for (let i = 0; i < 10; i++) { p = p * 0.975; closes3.push(Number(p.toFixed(4))); }
  closes3[53] = Number((closes3[52] * 1.04).toFixed(4));   // +4% 反弹①
  closes3[57] = Number((closes3[56] * 1.04).toFixed(4));   // +4% 反弹②
  eq(findSig(S.evaluate(mkBars(closes3)), 'GRIND_DOWN'), undefined, '期间有 2 天 +4% 反弹 → 不算阴跌，不触发');

  // 期间只有 1 天反弹 → 仍触发（1 天在容忍范围内）
  const closes4 = flat(50, 10);
  p = 10;
  for (let i = 0; i < 10; i++) { p = p * 0.975; closes4.push(Number(p.toFixed(4))); }
  closes4[57] = Number((closes4[56] * 1.04).toFixed(4));   // 只有 1 天反弹
  const s4 = findSig(S.evaluate(mkBars(closes4)), 'GRIND_DOWN');
  ok(!!s4, '只有 1 天反弹 → 仍触发「持续阴跌」');
}

/* ---------------- 规则5 BOTTOM_RECLAIM：超跌后重新站上 20 日线 ---------------- */
{
  // 20 根 13 元平台 → 一路跌到 9.4 → 横 14 天 → 今天放量收 10.3 站上 20 日线
  const closes = flat(20, 13);
  for (let i = 0; i < 25; i++) closes.push(Number((13 - 0.14 * (i + 1)).toFixed(4)));   // 12.86 → 9.5
  closes.push(9.4, 9.4, 9.4, 9.4, 9.4, 9.4, 9.4, 9.4, 9.4, 9.4, 9.4, 9.4, 9.4, 9.4);   // 横 14 天
  closes.push(10.3);
  const vols = flat(closes.length - 1, 1000).concat([1600]);
  const bars = mkBars(closes, null, vols);
  const r = S.evaluate(bars);
  const s = findSig(r, 'BOTTOM_RECLAIM');
  ok(!!s, '回撤 −20.8% 后重新站上 20 日线且放量 → 触发「超跌企稳」');
  eq(s && s.side, 'buy', '超跌企稳是介入方向');
  ok(String(s && s.detail).indexOf('回撤') >= 0, '详情带回撤幅度');

  // 没跌够（回撤 −5%）→ 不触发
  const closes2 = flat(20, 10.9);
  for (let i = 0; i < 25; i++) closes2.push(Number((10.9 - 0.06 * (i + 1)).toFixed(4)));
  closes2.push(9.4, 9.4, 9.4, 9.4, 9.4, 9.4, 9.4, 9.4, 9.4, 9.4, 9.4, 9.4, 9.4, 9.4);
  closes2.push(10.3);
  eq(findSig(S.evaluate(mkBars(closes2, null, vols)), 'BOTTOM_RECLAIM'), undefined, '回撤只有 −5% → 不算超跌，不触发');

  // 缩量站上（量能没有恢复）→ 不触发
  const vols2 = flat(closes.length - 1, 1600).concat([800]);
  eq(findSig(S.evaluate(mkBars(closes, null, vols2)), 'BOTTOM_RECLAIM'), undefined, '量能萎缩 → 不触发（防止是下跌中继）');
}

/* ---------------- evaluate：数据不足 / 多规则并存 ---------------- */
eq(S.evaluate(mkBars(flat(15, 10))), null, '不足 20 根 → evaluate 返回 null，绝不硬给信号');
eq(S.evaluate(null), null, 'evaluate(null) → null');
eq(S.evaluate([]), null, 'evaluate([]) → null');
{
  // 一只深跌后反弹到前高的股票，可能同时触发多条——结构必须都带齐字段
  const closes = flat(50, 10);
  let p = 10;
  for (let i = 0; i < 10; i++) { p = p * 0.975; closes.push(Number(p.toFixed(4))); }
  const r = S.evaluate(mkBars(closes));
  ok(Array.isArray(r.signals), 'evaluate 返回 signals 数组');
  r.signals.forEach(s => {
    ok(s.rule && s.side && s.title && s.detail && isFinite(s.price) && s.at,
      '信号 ' + (s.rule || '?') + ' 字段齐全（rule/side/title/detail/price/at）');
  });
}

/* ---------------- evaluateRange：回看 N 天 ---------------- */
{
  const closes = flat(50, 10);
  let p = 10;
  for (let i = 0; i < 10; i++) { p = p * 0.975; closes.push(Number(p.toFixed(4))); }
  const days = S.evaluateRange(mkBars(closes), 10);
  ok(days.length >= 5, 'evaluateRange(10) 能逐日回看并捕获多天信号（实际 ' + days.length + ' 天）');
  ok(days.every(d => d.at && d.signals.length), '每天结果都带日期和信号数组');
  eq(S.evaluateRange(mkBars(flat(15, 10)), 5).length, 0, '数据不足时 evaluateRange 返回空');
}

/* ---------------- 胜负判定：10 个交易日 ±2% ---------------- */
{
  // 55 根：30 根 10 元 + 25 根起伏，保证信号日 +10 根仍在数组里
  const bars = mkBars(flat(30, 10).concat([
    10, 10.5, 11, 11.5, 12, 12.5, 13, 12.4, 11.8, 11.2,
    10.6, 10.4, 10.2, 10.0, 9.9, 10.0, 10.2, 10.5, 10.8, 11.0,
    11.2, 11.4, 11.6, 11.8, 12.0
  ]));
  eq(bars.length, 55, '测试数据 55 根');
  eq(bars[34].c, 12, '第 34 根收盘 12');
  eq(bars[44].c, 9.9, '第 44 根收盘 9.9（即第 34 根的 +10 个交易日）');

  const sig = { rule: 'X', side: 'sell', price: 12, at: bars[34].d };
  const j = S.judgeOutcome(sig, bars);
  eq(j.state, 'win', '卖出信号后 10 日 −17.5% → 判胜（提示对了）');
  eq(j.resolveDate, bars[44].d, '判定日期是第 10 个交易日');
  ok(Math.abs(j.ret - (9.9 / 12 - 1)) < 1e-9, '收益率算得对');

  // 卖出信号但之后反而大涨 → 判负
  const sig2 = { rule: 'X', side: 'sell', price: 9.9, at: bars[44].d };
  eq(S.judgeOutcome(sig2, bars).state, 'lose', '卖出信号后 10 日 +21% → 判负');

  // 介入信号之后涨了 → 判胜（同一段行情，方向相反结论相反）
  const sig3 = { rule: 'X', side: 'buy', price: 9.9, at: bars[44].d };
  eq(S.judgeOutcome(sig3, bars).state, 'win', '介入信号后 10 日 +21% → 判胜');

  // 涨跌都在 ±2% 之内 → 平
  const bars2 = mkBars(flat(30, 10).concat([10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10.1]));
  const sig4 = { rule: 'X', side: 'sell', price: 10, at: bars2[30].d };
  eq(S.judgeOutcome(sig4, bars2).state, 'flat', '10 日后只涨 1% → 平（不算胜也不算负）');

  // 还没到 10 个交易日 → 未判定
  const sig5 = { rule: 'X', side: 'sell', price: 12, at: bars[54].d };
  const j5 = S.judgeOutcome(sig5, bars);
  eq(j5.state, 'pending', '不足 10 个交易日 → 未判定');
  eq(j5.resolveDate, null, '未判定时不编造日期');

  // 信号日期在 K 线里找不到 → 不崩，给 pending
  eq(S.judgeOutcome({ rule: 'X', side: 'sell', price: 10, at: '2099-01-01' }, bars).state, 'pending',
    '信号日期对不上 → pending（不崩）');
  eq(S.closeAfter(bars, '2099-01-01', 10), null, 'closeAfter 找不到日期 → null');
}

/* ---------------- winrateStats：按规则汇总 ---------------- */
{
  const rows = [
    { rule: 'A', verdict: { state: 'win', ret: 0.05 } },
    { rule: 'A', verdict: { state: 'win', ret: 0.03 } },
    { rule: 'A', verdict: { state: 'lose', ret: -0.06 } },
    { rule: 'A', verdict: { state: 'flat', ret: 0.001 } },
    { rule: 'A', verdict: { state: 'pending', ret: NaN } },
    { rule: 'B', verdict: { state: 'lose', ret: -0.05 } },
    { rule: 'B', verdict: { state: 'lose', ret: -0.07 } }
  ];
  const st = S.winrateStats(rows);
  eq(st.length, 2, '两条规则各一行');
  const a = st.find(x => x.rule === 'A'), b = st.find(x => x.rule === 'B');
  eq(a.n, 5, 'A 的样本数 5');
  eq(a.win, 2, 'A 胜 2');
  eq(a.done, 4, 'A 已判定 4（pending 不算）');
  near(a.winRate, 0.5, 'A 胜率 = 2/4 = 50%');
  near(a.avgRet, (0.05 + 0.03 - 0.06 + 0.001) / 4, 'A 平均收益按全部已判定的 4 条算（含平局）');
  eq(b.done, 2, 'B 已判定 2');
  eq(b.winRate, 0, 'B 胜率 0%');
  eq(S.winrateStats([]).length, 0, '空输入 → 空结果');
  eq(S.winrateStats(null).length, 0, 'null → 空结果，不抛异常');
}

/* ---------------- ★ winrateStats 按版本隔离（2026-09-17 用户选「只统计当前版本」） ----------------
   背景：改规则必须升 RULE_VERSION，升了版本判断口径就变了；新旧口径的胜负混在一个胜率里，
   正好抹掉"改完到底变好没有"这个唯一有价值的结论。这里把隔离口径钉死。 */
{
  const rows = [
    { rule: 'X', ruleVersion: 'R2', verdict: { state: 'win', ret: 0.05 } },
    { rule: 'X', ruleVersion: 'R2', verdict: { state: 'win', ret: 0.04 } },
    { rule: 'X', ruleVersion: 'R3', verdict: { state: 'lose', ret: -0.06 } },
    { rule: 'Y', ruleVersion: 'R3', verdict: { state: 'win', ret: 0.03 } },
    { rule: 'Y', verdict: { state: 'win', ret: 0.03 } }            // 未标版本（老数据）
  ];

  const all = S.winrateStats(rows);
  eq(all.length, 2, '不传 opt → 仍按规则全量汇总（向后兼容）');
  eq(all.find(x => x.rule === 'X').n, 3, '不传 opt 时 X 有 3 条（含 R2）');

  const cur = S.winrateStats(rows, { onlyVersion: 'R3' });
  eq(cur.length, 2, '传 onlyVersion:R3 → 两条规则都在');
  eq(cur.find(x => x.rule === 'X').n, 1, '★ X 只算 R3 的 1 条，R2 的两条被排除');
  eq(cur.find(x => x.rule === 'X').done, 1, '★ 且是那条 lose（已判定）');
  eq(cur.find(x => x.rule === 'X').winRate, 0, '★ X 在 R3 口径下胜率按 0/1 算，不与 R2 的 2 胜混算');
  eq(cur.find(x => x.rule === 'Y').n, 1, '★ 未标版本的老数据也算不进来（宁可不算，不要算错）');

  eq(S.winrateStats(rows, { onlyVersion: 'R9' }).length, 0, '★ 换成还没出现过的版本 → 空结果，不崩');
  eq(S.winrateStats([], { onlyVersion: 'R3' }).length, 0, '空输入 + 隔离 → 空结果');
  eq(S.winrateStats(null, { onlyVersion: 'R3' }).length, 0, 'null + 隔离 → 空结果，不抛异常');

  /* 被排除的条数 = 总条数 − 统计到的条数（调用方靠这个把"排除了多少"如实打出来） */
  const counted = cur.reduce((a, s) => a + s.n, 0);
  eq(rows.length - counted, 3, '★ 被隔离条数可算出来（5 条里排除 3 条）—— 报告里必须说出来');
}

/* ---------------- 常量 ---------------- */
eq(typeof S.VERSION, 'number', 'VERSION 是数字');
eq(typeof S.RULE_VERSION, 'string', 'RULE_VERSION 是字符串（胜率按版本分开统计的前提）');
ok(S.P.winDays === 10 && S.P.winBand === 0.02, '胜负口径 = 10 个交易日 ±2%（用户 2026-09-16 指定）');
ok(S.P.grindDays >= 5 && S.P.biasHoldDays >= 2, '阴跌/过热的最小持续天数已设防');

/* ---------------- 注入一致性：console.html 里的那份必须与云端文件逐字一致 ---------------- */
{
  const B = '/* ==== SIGNAL-CORE-BEGIN ==== */', E = '/* ==== SIGNAL-CORE-END ==== */';
  const htmlPath = 'D:/mywork/stock-alert-console/console.html';
  if (fs.existsSync(htmlPath) && fs.readFileSync(htmlPath, 'utf8').indexOf('SIGNAL-CORE-BEGIN') >= 0) {
    const html = fs.readFileSync(htmlPath, 'utf8');
    const i = html.indexOf(B), j = html.indexOf(E);
    ok(i >= 0 && j > i, 'console.html 含 SIGNAL-CORE 标记对');
    if (i >= 0 && j > i) {
      const inner = html.slice(i + B.length, j).trim();
      const core = fs.readFileSync('D:/mywork/stock-alert-cloud/signal-core.js', 'utf8').trim();
      eq(inner, core, '注入块内容与 signal-core.js 逐字一致');
    }
    eq((html.match(/SIGNAL-CORE-BEGIN/g) || []).length, 1, 'BEGIN 标记只有一个');
    eq((html.match(/SIGNAL-CORE-END/g) || []).length, 1, 'END 标记只有一个');
  } else {
    console.log('（console.html 尚未注入 SIGNAL-CORE，跳过注入一致性检查）');
  }
}

/* ---------------- 汇总 ---------------- */
console.log('signal-core 单元测试：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('ALL GREEN');
process.exit(0);
