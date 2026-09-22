/* ============================================================
 *  筹码透视引擎单元测试  chip-test.js
 * ============================================================
 *  全部用**合成数据**跑，不依赖网络 —— 网络接口会抖，但口径不能抖。
 *  目标：把 chip-core.js 的每一条判定规则钉死，改算法时立刻知道坏了哪个。
 *
 *  运行：node _tests/chip-test.js
 * ============================================================ */
'use strict';

const path = require('path');
const C = require(path.join(__dirname, '..', 'stock-alert-cloud', 'chip-core.js'));
const S = require(path.join(__dirname, '..', 'stock-alert-cloud', 'signal-core.js'));

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + (a === b ? '' : '  （实际 ' + JSON.stringify(a) + '，期望 ' + JSON.stringify(b) + '）')); }
function near(a, b, tol, msg) {
  const good = isFinite(a) && Math.abs(a - b) <= tol;
  ok(good, msg + (good ? '' : '  （实际 ' + a + '，期望 ' + b + '±' + tol + '）'));
}
function sec(t) { console.log('\n── ' + t + ' ──'); }

/* ---------------- 合成数据工具 ---------------- */

/** 第 i 天的日期（从 2025-01-01 起，跳过周末无所谓，引擎只按顺序处理） */
function dt(i) {
  const d = new Date(Date.UTC(2025, 0, 1) + i * 86400000);
  return d.toISOString().slice(0, 10);
}

/**
 * 造一段等价格 K 线：价格恒定 p，量恒定 v
 */
function flat(from, n, p, v) {
  const out = [];
  for (let i = 0; i < n; i++) out.push([dt(from + i), p, p, p * 1.005, p * 0.995, v]);
  return out;
}

/**
 * 造一段线性走势：价格从 p0 走到 p1
 */
function ramp(from, n, p0, p1, v0, v1) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = n <= 1 ? 1 : i / (n - 1);
    const p = p0 + (p1 - p0) * t;
    const v = v0 + (v1 - v0) * t;
    out.push([dt(from + i), p * 0.998, p, p * 1.01, p * 0.99, v]);
  }
  return out;
}

/* 流通股本 1 亿股 = 100 万手。量 10000 手 → 日换手 1% */
const FS = 1e8;

/* ============================================================
 *  0. 解析层
 * ============================================================ */
sec('0. 解析层 normBars / normFlows');

{
  const bars = C.normBars([['2025-01-02', '10', '10.5', '10.6', '9.9', '100'],
    ['2025-01-01', '9', '10', '10.1', '8.9', '200']]);
  eq(bars.length, 2, '解析 2 根 K 线');
  eq(bars[0].d, '2025-01-01', '按日期升序排序');
  eq(bars[1].c, 10.5, '字段顺序：日期,开,收,高,低,量');
  eq(C.normBars([['2025-01-01', '10', '0', '11', '9', '100']]).length, 0, '收盘价 <=0 的脏行被丢弃');
  eq(C.normBars([['2025-01-01', '10', '10', '9', '11', '100']]).length, 0, '高低倒挂的脏行被丢弃');
}

{
  // 东财原始行：日期,主力,小单,中单,大单,超大单（实测闭合：主力=大单+超大单）
  const f = C.normFlows(['2026-09-17,-115136741,-160341,115297088,-120141776,5005035']);
  eq(f.length, 1, '解析 1 天资金流');
  eq(f[0].main, -115136741, '主力净额');
  const recomposed = f[0].big + f[0].huge;
  eq(recomposed, f[0].main, '★ 字段顺序校验：主力 === 大单 + 超大单');
  // 注：数据源本身有四舍五入，恒等式允许极小误差
  near(f[0].small + f[0].mid, -f[0].main, 10, '★ 恒等式：小单 + 中单 === −主力（同一笔钱的两面）');
}

/* ============================================================
 *  1. 筹码分布
 * ============================================================ */
sec('1. 筹码分布 chipsDistribution');

{
  // 低位横盘 150 天后拉到 15 元 —— 筹码应该大量堆在 10 元附近
  const bars = C.normBars(flat(0, 150, 10, 10000).concat(ramp(150, 30, 10, 15, 20000, 30000)));
  const dist = C.chipsDistribution(bars, FS);
  ok(!!dist, '生成筹码分布');
  eq(dist.days, 180, '天数 = 180');

  const a = C.analyzeChips(dist, 15);
  ok(!!a, '提取筹码结构');
  near(a.mainCost, 10, 1.2, '★ 主力成本落在低位吸筹区 10 元附近（实际 ' + a.mainCost.toFixed(2) + '）');
  ok(a.profitRatio > 0.85, '★ 拉升后获利盘 > 85%（实际 ' + (a.profitRatio * 100).toFixed(1) + '%）');
  ok(a.peaks.length >= 1, '至少识别出 1 个密集峰');
  // 筹码堆在低位（10 元），离现价 15 元很远 → 现价 ±10% 内本来就不该有多少筹码，
  // 这正是「底部筹码没走 = 抛压小」的意思，集中度低是对的
  ok(a.concentration < 0.5, '★ 底部筹码未上移 → 现价 ±10% 内筹码少（实际 ' + (a.concentration * 100).toFixed(1) + '%）');
  ok(a.spread > 0.25, '90% 筹码带宽较宽（底部到现价，实际 ' + (a.spread * 100).toFixed(1) + '%）');
}

{
  // 价格在 10 元窄幅震荡一年 → 筹码高度集中在现价附近
  const bars = C.normBars(flat(0, 220, 10, 12000));
  const dist = C.chipsDistribution(bars, FS);
  const a = C.analyzeChips(dist, 10);
  ok(a.concentration > 0.8, '★ 窄幅震荡 → 现价 ±10% 内筹码占比 > 80%（实际 ' + (a.concentration * 100).toFixed(1) + '%）');
  ok(a.spread < 0.2, '★ 90% 筹码带宽很窄（实际 ' + (a.spread * 100).toFixed(1) + '%）');
  near(a.mainCost, 10, 0.4, '主力成本 ≈ 现价（横盘区）');
}

{
  // 高位 20 元撑 60 天后腰斩到 10 元 —— 上方应形成套牢峰
  const bars = C.normBars(flat(0, 60, 20, 30000).concat(ramp(60, 60, 20, 10, 30000, 20000)));
  const dist = C.chipsDistribution(bars, FS);
  const a = C.analyzeChips(dist, 10);
  ok(a.profitRatio < 0.35, '★ 腰斩后获利盘 < 35%（实际 ' + (a.profitRatio * 100).toFixed(1) + '%）');
  ok(isFinite(a.retailCost) && a.retailCost > 13, '★ 散户成本（高位套牢峰）> 13（实际 ' + a.retailCost.toFixed(2) + '）');
  ok(isFinite(a.pressure) && a.pressure > 10, '★ 上方有压力位（实际 ' + a.pressure.toFixed(2) + '）');
}

{
  // 边界：股本为 0 / K 线不足 → 不能崩，返回 null
  const bars = C.normBars(flat(0, 100, 10, 10000));
  eq(C.chipsDistribution(bars, 0), null, '流通股本为 0 → 返回 null（不硬算）');
  eq(C.chipsDistribution(C.normBars(flat(0, 5, 10, 100)), FS), null, 'K 线不足 20 根 → 返回 null');
}

/* ============================================================
 *  2. 资金流统计
 * ============================================================ */
sec('2. 资金流统计 flowStats');

{
  // 造 20 天资金流：每天主力净流入 1 亿（正），最近 5 天也是正的
  const bars = C.normBars(flat(0, 100, 10, 10000));
  const flows = [];
  for (let i = 0; i < 20; i++) flows.push({ d: bars[80 + i].d, main: 1e8, huge: 6e7, big: 4e7, mid: -6e7, small: -4e7 });
  const f = C.flowStats(flows, bars, 10);
  eq(f.days, 20, '资金流天数 = 20');
  eq(f.main5, 5e8, '近 5 日主力净额 = 5 亿');
  eq(f.main20, 20e8, '近 20 日主力净额 = 20 亿');
  eq(f.retail5, -5e8, '★ 近 5 日散户净额 = −5 亿（与主力严格反号）');
  ok(f.dom5 > 0, '主力净额占比为正');
  eq(C.flowDir(f.dom5), 'strong-in', '★ 归类为「明显净流入」');
}

{
  const bars = C.normBars(flat(0, 100, 10, 10000));
  const f = C.flowStats([], bars, 10);
  eq(f.days, 0, '无资金流 → days=0（不报错）');
  ok(!isFinite(f.main5), '无资金流 → main5 = NaN');
}

/* ============================================================
 *  3. 散户行为判定（用户最关心的一栏）
 * ============================================================
 *  核心：单看资金流分不出「割肉」和「追高」，必须叠加价格方向。
 *  主力净额与散户净额恒为反号，所以：
 *    散户净买 = 主力净卖；散户净卖 = 主力净买
 */
sec('3. 散户行为判定 judgeRetail（四象限）');

function retailCase(ret5, dom5) {
  const m = {
    price: 10,
    flows: { dom5: dom5, main5: -dom5 * 1e8, main20: -dom5 * 1e8 },
    vol: { ret5: ret5, ret20: ret5 },
    chips: null
  };
  return C.judgeRetail(m);
}

{
  // 跌 + 主力买（dom5 > 0）→ 散户在卖 → 割肉
  eq(retailCase(-0.06, 0.04).key, 'surrender', '★ 跌 6% + 主力净买 → 散户在割肉');
  // 跌 + 主力卖（dom5 < 0）→ 散户在买 → 抄底
  eq(retailCase(-0.06, -0.04).key, 'dip-buy', '★ 跌 6% + 主力净卖 → 散户在抄底');
  // 涨 + 主力买 → 散户在卖 → 获利了结
  eq(retailCase(0.06, 0.04).key, 'take-profit', '★ 涨 6% + 主力净买 → 散户在获利了结');
  // 涨 + 主力卖 → 散户在买 → 追高接筹码
  eq(retailCase(0.06, -0.04).key, 'chase', '★ 涨 6% + 主力净卖 → 散户在追高接筹码');
  // 横盘
  eq(retailCase(0.005, -0.04).key, 'slow-buy', '横盘 + 主力净卖 → 散户在慢慢买');
  eq(retailCase(0.005, 0.04).key, 'slow-sell', '横盘 + 主力净买 → 散户在磨走');
  eq(retailCase(0.005, 0.001).key, 'stalemate', '横盘 + 资金持平 → 散户在僵持');
  // 跌但资金无方向
  eq(retailCase(-0.06, 0.001).key, 'watch', '跌 6% 但资金无方向 → 散户在观望');
}

/* ============================================================
 *  4. 主力行为判定
 * ============================================================ */
sec('4. 主力行为判定 judgeMain');

function mainCase(o) {
  const m = {
    price: o.price || 10,
    flows: { dom5: o.dom5, dom20: o.dom20, main5: o.main5, main20: o.main20 },
    vol: { ret5: o.ret5, ret20: o.ret20, volRatio60: o.vr60, turnoverRank: o.trRank },
    chips: o.chips === null ? null : { mainCost: o.mainCost || NaN, profitRatio: o.profit }
  };
  return C.judgeMain(m);
}

{
  // 低位横盘 + 主力持续净流入 → 建仓/吸筹
  const a = mainCase({ dom5: 0.03, dom20: 0.03, main5: 3e7, main20: 1e8, ret5: 0.01, ret20: 0.03, vr60: 1.1, trRank: 0.6, mainCost: 9.5 });
  eq(a.key, 'accumulate', '★ 横盘 + 主力持续净流入 → 建仓/吸筹');
  // 已高出主力成本 20% → 拉升中
  const b = mainCase({ dom5: 0.03, dom20: 0.03, main5: 3e7, main20: 1e8, ret5: 0.03, ret20: 0.15, vr60: 1.2, trRank: 0.7, mainCost: 8 });
  eq(b.key, 'lift', '★ 已高出主力成本 20% → 拉升中');
  // 上涨 + 主力净流出 → 高位派发
  const c = mainCase({ dom5: -0.04, dom20: -0.04, main5: -4e7, main20: -1.5e8, ret5: 0.04, ret20: 0.12, vr60: 1.2, trRank: 0.7 });
  eq(c.key, 'distribute', '★ 上涨 + 主力净流出 → 高位派发');
  // 下跌 + 主力净流出 → 下跌中减仓
  const d = mainCase({ dom5: -0.04, dom20: -0.03, main5: -4e7, main20: -1.5e8, ret5: -0.06, ret20: -0.13, vr60: 1.0, trRank: 0.6 });
  eq(d.key, 'driftdown', '★ 下跌 + 主力净流出 → 下跌中减仓');
  // 极度缩量 + 资金无方向 → 锁仓
  const e = mainCase({ dom5: 0.001, dom20: 0.002, main5: 1e5, main20: 2e5, ret5: -0.01, ret20: -0.02, vr60: 0.4, trRank: 0.2 });
  eq(e.key, 'lock', '★ 极度缩量 + 资金无方向 → 锁仓');
  // 缩量但主力在猛买 → 不能判锁仓（必须走吸筹）
  const f = mainCase({ dom5: 0.05, dom20: 0.05, main5: 5e7, main20: 2e8, ret5: 0.005, ret20: 0.02, vr60: 0.4, trRank: 0.2, mainCost: 9.5 });
  ok(f.key !== 'lock', '★ 缩量 + 主力猛买 → 不判锁仓（判「' + f.tag + '」）');
}

/* ============================================================
 *  5. 站队结论
 * ============================================================ */
sec('5. 站队结论 judgeStance');

function stanceCase(mainKey, retailKey, o) {
  o = o || {};
  const m = {
    price: o.price || 10,
    chips: o.chips === null ? null : { mainCost: o.mainCost === undefined ? 9.5 : o.mainCost, profitRatio: o.profit === undefined ? 0.5 : o.profit },
    flows: { dom5: o.dom5 === undefined ? 0.03 : o.dom5, dom20: o.dom20 === undefined ? 0.03 : o.dom20 },
    vol: {},
    mainBehavior: { key: mainKey, tag: mainKey },
    retailBehavior: { key: retailKey, tag: retailKey }
  };
  return C.judgeStance(m);
}

{
  eq(stanceCase('accumulate', 'surrender').tag, '跟主力站一起', '★ 主力吸筹 + 散户割肉 → 跟主力站一起');
  eq(stanceCase('inflow', 'take-profit').tag, '跟主力站一起', '★ 主力流入 + 散户获利了结 → 跟主力站一起');
  eq(stanceCase('lift', 'chase').tag, '跟但别追', '★ 主力拉升 + 散户追高 → 持有但不加仓');
  eq(stanceCase('distribute', 'chase').tag, '别当接棒的', '★ 主力派发 + 散户追高 → 逢高减仓');
  eq(stanceCase('driftdown', 'dip-buy', { dom5: -0.03, dom20: -0.03 }).tag, '别去抄底', '★ 主力撤离 + 散户抄底 → 别去抄底');
  eq(stanceCase('lock', 'watch').tag, '等风来', '★ 锁仓 → 拿住不动');
  eq(stanceCase('outflow', 'watch', { dom5: -0.03, dom20: -0.03 }).tag, '主力在撤', '★ 主力流出、散户没接 → 减仓');

  // 主力在吸筹但价格已高出成本 30% → 不能再说"跟主力站一起"
  const over = stanceCase('accumulate', 'surrender', { price: 13, mainCost: 10, dom5: 0.03, dom20: 0.03 });
  ok(over.tag !== '跟主力站一起', '★ 已高出主力成本 30% → 不再无条件"跟主力"（实际「' + over.tag + '」）');
}

/* ============================================================
 *  6. 5 日线连续站上（用户 2026-09-17 指定口径）
 *     ★ 同日追加前提（用户原话）：「当 5 日线大于 10 日线，10 日线大于 20 日线，
 *       20 日线大于 30 日线情况下才有效，其他情况不触发判断。」
 *       → 非多头排列（或 K 线不足 30 根）时必须一律 days=0 / sig=null。
 * ============================================================ */
sec('6. ma5Streak（多头排列前提 + 连续天数：≥2 提示卖出 / 1 天只标天数 / 0 天不显示）');

/* 多头排列底仓：40 根线性缓涨 9.00 → 10.00，末尾 1 根回落到 9.70 当**断口**
   （没有这根断口，底仓尾部自己就站在 5 日线上，会被算进"连续天数"）。
   底仓共 41 根（下标 0..40），下面所有"多头排列"用例都从 dt(41) 往后接。 */
const MB = ramp(0, 40, 9, 10, 10000, 10000).concat(flat(40, 1, 9.70, 10000));
const MB_N = MB.length;   // 41
/** 把尾部 K 线接到多头排列底仓之后；每行 = [相对序号, 开, 收, 高, 低] */
function maTail(rows) {
  return MB.concat(rows.map(r => [dt(MB_N + r[0]), r[1], r[2], r[3], r[4], 10000]));
}

/* --- 6.0 ★ 新前提：非多头排列 → 一律不判断 --- */
{
  // 20 根横盘（既不足 30 根、四条均线也相等）+ 连续 3 天跳空站上
  const rawFlat = flat(0, 20, 10, 10000).concat([
    [dt(20), 11, 11, 11.2, 10.8, 10000],
    [dt(21), 11.5, 11.5, 11.6, 11.4, 10000],
    [dt(22), 12, 12, 12.1, 11.9, 10000]
  ]);
  const bFlat = C.normBars(rawFlat);
  const nF = bFlat.length - 1;
  ok(bFlat[nF].c > S.maAt(bFlat, nF, 5), '（前置）末根收在 5 日线上 —— 老口径下会算成 3 天');
  eq(S.maAlign(bFlat).ok, false, '★ 但它不是多头排列（K 线不足 30 根）');
  eq(S.ma5Streak(bFlat).days, 0, '★ 非多头排列 → days=0（"其他情况不触发判断"）');
  eq(S.ma5Streak(bFlat).sig, null, '★ sig=null → 持仓页不渲染任何 5 日线标识');

  // 45 根阴跌（空头排列 MA5 < MA10 < MA20 < MA30）+ 最后 2 天反弹站上
  const rawBear = ramp(0, 45, 12, 10, 10000, 10000).concat([
    [dt(45), 9.6, 9.6, 9.8, 9.5, 10000],
    [dt(46), 10.6, 10.6, 10.7, 10.5, 10000],
    [dt(47), 10.8, 10.8, 10.9, 10.7, 10000]
  ]);
  const bBear = C.normBars(rawBear);
  const nB = bBear.length - 1;
  ok(bBear[nB].o > S.maAt(bBear, nB, 5) && bBear[nB].c > S.maAt(bBear, nB, 5) &&
     bBear[nB - 1].o > S.maAt(bBear, nB - 1, 5) && bBear[nB - 1].c > S.maAt(bBear, nB - 1, 5),
    '（前置）最后两天确实开收盘都站上 5 日线 —— 挡住它的只可能是多头排列前提');
  eq(S.maAlign(bBear).ok, false, '★ 均线空头排列（MA5 < 10 < 20 < 30）');
  eq(S.ma5Streak(bBear).days, 0, '★ 空头排列 → days=0');
  eq(S.ma5Streak(bBear).sig, null, '★ 空头排列 → sig=null');
}

/* --- 6.1 多头排列 + 连续 3 天开收盘站上 --- */
{
  const raw = maTail([
    [0, 11, 11, 11.2, 10.8],
    [1, 11.5, 11.5, 11.6, 11.4],
    [2, 12, 12, 12.1, 11.9]
  ]);
  const bars = C.normBars(raw);
  eq(S.maAlign(bars).ok, true, '（前置）这段是多头排列');
  const st = S.ma5Streak(bars);
  eq(st.days, 3, '★ 连续 3 天开收盘都站上 5 日线 → days=3');
  eq(st.sig, 'sell', '★ days>=2 → sig=\'sell\'（提醒卖出）');
  ok(isFinite(st.ma5), 'MA5 有值');
  eq(st.to, dt(MB_N + 2), '区间终点 = 最后一根日期');
}

/* --- 6.2 多头排列 + 只有最后 1 天站上 --- */
{
  const raw = maTail([
    [0, 9.55, 9.55, 9.7, 9.5],      // 收在均线下（拖低均线）
    [1, 11, 11, 11.1, 10.9]         // 站上
  ]);
  const bars = C.normBars(raw);
  eq(S.maAlign(bars).ok, true, '（前置）这段是多头排列');
  const st = S.ma5Streak(bars);
  eq(st.days, 1, '★ 只有 1 天站上 → days=1');
  eq(st.sig, 'watch', '★ days===1 → sig=\'watch\'（只标天数）');
}

/* --- 6.3 多头排列 + 最后一天开盘在均线下 → 不算站上 --- */
{
  const raw = maTail([[0, 9.0, 11.0, 11.2, 8.9]]);
  const bars = C.normBars(raw);
  eq(S.maAlign(bars).ok, true, '（前置）这段仍是多头排列（前提只看收盘均线）');
  const st = S.ma5Streak(bars);
  eq(st.days, 0, '★ 开盘在均线下 → 不算站上，days=0');
  eq(st.sig, null, '★ days=0 → sig=null（不显示）');
}

/* --- 6.4 多头排列 + 中间断一天 → 只数最近连续段 --- */
{
  const raw = maTail([
    [0, 12, 12, 12.1, 11.9],
    [1, 8, 8.2, 8.5, 7.9],        // 掉下去，断链
    [2, 12, 12, 12.1, 11.9],
    [3, 12.2, 12.2, 12.3, 12.1]
  ]);
  const bars = C.normBars(raw);
  eq(S.maAlign(bars).ok, true, '（前置）中间断一天不改前提（仍多头排列）');
  const st = S.ma5Streak(bars);
  eq(st.days, 2, '★ 中间断过 → 只数最近连续段（days=2）');
}

/* --- 6.5 多头排列 + 缓涨两天：逐日各用「截止当日」的均线 --- */
{
  const raw = maTail([
    [0, 10.1, 10.1, 10.2, 10.0],
    [1, 10.2, 10.2, 10.3, 10.1]
  ]);
  const bars = C.normBars(raw);
  eq(S.maAlign(bars).ok, true, '（前置）这段是多头排列');
  const st = S.ma5Streak(bars);
  eq(st.days, 2, '★ 缓涨两天（当日均线口径）→ days=2');
}

/* ============================================================
 *  7. 总入口 analyze（含降级）
 * ============================================================ */
sec('7. 总入口 analyze（数据缺失时的降级）');

{
  const bars = C.normBars(flat(0, 100, 10, 10000).concat(ramp(100, 40, 10, 16, 30000, 60000)));
  const flows = [];
  for (let i = 0; i < 40; i++) {
    // 后 40 天：跌了不？这里价格是涨的，主力净买 → 散户在获利了结
    flows.push({ d: bars[100 + i].d, main: 2e7, huge: 1.2e7, big: 8e6, mid: -1.2e7, small: -8e6 });
  }
  const r = C.analyze({ code: '600000', name: '测试股', bars, flows, floatShares: FS });
  ok(r.ok, '分析成功');
  eq(r.ruleVersion, 'C1', '带规则版本号（改算法必须升，别跨版本比）');
  ok(!!r.chips, '有筹码结构');
  ok(!!r.stance && !!r.stance.tag, '有站队结论：' + (r.stance && r.stance.tag));
  ok(r.notes.length === 0, '数据齐全 → 无降级提示');
}

{
  // 只给 K 线，不给资金流和股本 → 必须降级而不是报错
  const bars = C.normBars(flat(0, 100, 10, 10000));
  const r = C.analyze({ code: '600001', bars });
  ok(r.ok, '★ 只有 K 线也能出结果（降级不报错）');
  eq(r.chips, null, '无股本源 → chips 为 null');
  ok(r.notes.length >= 2, '给出降级说明：' + r.notes.join('；'));
  ok(!!r.stance.tag, '仍然给出结论：' + r.stance.tag + '（基于量价近似）');
}

{
  // K 线太少 → 明确失败
  const r = C.analyze({ bars: C.normBars(flat(0, 10, 10, 10000)) });
  eq(r.ok, false, 'K 线不足 21 根 → ok=false');
  ok(/K线/.test(r.msg), '给出原因：' + r.msg);
}

/* ============================================================
 *  股东人数序列归一化（2026-09-22 新增，供详情页趋势图）
 *  ⚠️ 只测纯函数 normHolders —— 它把东财 F10 的 gdrs[] 变成
 *     「升序、截断到最近 N 期」的序列；网络部分（fetchHolders）不测，
 *     否则网络一抖单测就红。
 * ============================================================ */
sec('股东人数序列（normHolders）');
{
  const CH = require(path.join(__dirname, '..', 'stock-alert-cloud', 'chips.js'));
  ok(typeof CH.normHolders === 'function', 'chips.js 导出 normHolders（可单测、不联网）');
  ok(CH.HOLDER_KEEP === 12, 'HOLDER_KEEP=12（季报口径 ≈3 年，够看趋势）');

  eq(CH.normHolders(null).length, 0, 'null → 空（不炸）');
  eq(CH.normHolders([]).length, 0, '空数组 → 空');
  eq(CH.normHolders([{ END_DATE: '2026-06-30', HOLDER_TOTAL_NUM: 0 }]).length, 0,
    '户数为 0 的脏数据 → 过滤掉（不把 0 当真实值画出来）');
  eq(CH.normHolders([{ HOLDER_TOTAL_NUM: 12345 }]).length, 0, '没有日期 → 过滤掉（日期是季度口径的命根子）');

  /* 东财返回是**倒序**（新→旧），必须翻成升序，否则趋势图左右颠倒 */
  const raw = [
    { END_DATE: '2026-06-30 00:00:00', HOLDER_TOTAL_NUM: 580535, TOTAL_NUM_RATIO: 41.6516, HOLD_FOCUS: '非常分散' },
    { END_DATE: '2026-03-31 00:00:00', HOLDER_TOTAL_NUM: 409833, TOTAL_NUM_RATIO: 8.0151, HOLD_FOCUS: '非常分散' },
    { END_DATE: '2025-12-31 00:00:00', HOLDER_TOTAL_NUM: 379422, TOTAL_NUM_RATIO: -0.0579, HOLD_FOCUS: '非常分散' }
  ];
  const rows = CH.normHolders(raw);
  eq(rows.length, 3, '三条 → 三条（none 被丢）');
  eq(rows[0].date, '2025-12-31', '★ 升序：最旧的一期排在最前（东财给的是倒序，不翻就画反）');
  eq(rows[2].date, '2026-06-30', '最新一期排在最后');
  eq(rows[0].num, 379422, '户数原样取（不做任何换算，换算留给展示层）');
  eq(rows[2].ratio, 41.65, '环比保留两位（41.6516 → 41.65）');
  eq(rows[1].focus, '非常分散', '集中度描述原样带上');

  /* 超长序列要截断，存档不许无限膨胀 —— 且截的是**最近的**那批 */
  const many = [];
  for (let i = 0; i < 40; i++) {
    many.push({ END_DATE: '20' + (10 + Math.floor(i / 4)) + '-0' + (i % 4 + 1) + '-01', HOLDER_TOTAL_NUM: 100000 + i * 1000, TOTAL_NUM_RATIO: 1.1 });
  }
  const cut = CH.normHolders(many);
  eq(cut.length, CH.HOLDER_KEEP, '超长序列截断到 HOLDER_KEEP 期（存档不膨胀）');
  eq(cut[cut.length - 1].num, 139000, '★ 保留的是最近那批（最后一条=原序列最后一条，不是最旧的）');
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(56));
console.log('筹码透视引擎单元测试：' + pass + ' 通过 / ' + fail + ' 失败');
console.log('='.repeat(56));
process.exit(fail ? 1 : 0);
