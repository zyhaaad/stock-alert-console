#!/usr/bin/env node
/* =========================================================
 * style.js 引擎单测（S1）· 2026-09-19
 * 只测纯函数（psGate/idxStyle/themeLeaders/classifyStyle/
 * scoreCandidate/guardCandidate），不联网。
 * 口径与控制台 PS v2.1 单测（position-dom-test.js）互为镜像：
 * 同样的输入必须得出同样的裁决，两端永远不许分叉。
 * ========================================================= */
const ST = require('../stock-alert-cloud/style.js')

let pass = 0, fail = 0
function ok(cond, msg) { if (cond) { pass++; console.log('  ✓ ' + msg) } else { fail++; console.log('  ✗ ' + msg) } }
function eq(a, b, msg) { ok(a === b, msg + '（期望 ' + b + '，实际 ' + a + '）') }

/* ---------- 构造 K 线底座（与 position-dom-test 同款：30 根多头排列 + 一根回调） ---------- */
function buildBars(spec) {
  const bars = []
  let px = spec.start || 20
  for (let i = 0; i < spec.base; i++) {
    const vol = spec.baseVol
    px = px * (1 + (spec.drift || 0.006))
    bars.push({ d: 'd' + i, o: px * 0.99, c: px, h: px * 1.012, l: px * 0.985, v: vol })
  }
  if (spec.last) {
    const L = spec.last
    bars[bars.length - 1] = Object.assign({ d: 'dL' }, bars[bars.length - 2], {
      o: L.o != null ? L.o : L.c, c: L.c, h: L.h != null ? L.h : Math.max(L.c, L.o || L.c) * 1.005,
      l: L.l != null ? L.l : Math.min(L.c, L.o || L.c) * 0.995, v: L.v != null ? L.v : spec.baseVol
    })
  }
  return bars
}

/* ---------------- psGate ---------------- */
console.log('== psGate（顶部结构闸门，与 PS v2.1 同口径） ==')
{
  const bars = buildBars({ base: 30, baseVol: 100000 })
  let g = ST.psGate(ST.psRow(bars), false)
  eq(g.verdict, 'ok', '多头排列温和走势 → 放行')
  ok(g.score >= 20 && g.score <= 40, '结构分在正常区间（' + g.score + '）')

  /* 破位：收盘跌破 MA20（多头底座直接砸穿） */
  const brokenBars = bars.slice(0, 29)
  brokenBars.push({ d: 'x', o: bars[28].c * 0.95, c: bars[28].c * 0.9, h: bars[28].c * 0.96, l: bars[28].c * 0.89, v: 120000 })
  g = ST.psGate(ST.psRow(brokenBars), false)
  eq(g.verdict, 'reject', '破 MA20 → 剔除')
  ok(g.flags.sell_bias, 'sell_bias 置位')

  /* 诱多：空头排列（温和阴跌）+ 缩量反弹 + 触 MA20 回落 */
  const shortBars = []
  let p = 30
  for (let i = 0; i < 30; i++) { p = p * (1 - 0.003); shortBars.push({ d: 'd' + i, o: p * 1.01, c: p, h: p * 1.012, l: p * 0.99, v: 100000 }) }
  /* 反弹日：+3% 收在 MA20 附近、缩量 0.5 */
  const L = shortBars[28]
  shortBars[29] = { d: 'x', o: L.c * 1.01, c: L.c * 1.03, h: L.c * 1.035, l: L.c, v: 50000 }
  g = ST.psGate(ST.psRow(shortBars), false)
  eq(g.verdict, 'reject', '诱多形态 → 剔除')
  ok(g.flags.force_no_trade, 'force_no_trade 置位（最高优先级）')

  /* 天量：VR>3.0 → pending，不 reject */
  const hugeBars = buildBars({ base: 30, baseVol: 100000 })
  const L2 = hugeBars[28]
  hugeBars[29] = { d: 'x', o: L2.c * 1.01, c: L2.c * 1.04, h: L2.c * 1.05, l: L2.c, v: 400000 }
  g = ST.psGate(ST.psRow(hugeBars), false)
  eq(g.verdict, 'pending', '天量 → 待确认（不剔除，只降级）')
  ok(g.vr > 3.0, 'VR>3.0（' + g.vr.toFixed(2) + '）')
  /* 同形态 + 板块共振 → 豁免为 ok（云端有板块数据，与线上保守口径不同步是设计内） */
  g = ST.psGate(ST.psRow(hugeBars), true)
  eq(g.verdict, 'ok', '板块共振豁免 → 天量不降级')
  ok(g.flags.sector_exempt, 'sector_exempt 置位')

  /* K 线不足：如实说，不硬算 */
  g = ST.psGate(ST.psRow(bars.slice(0, 15)), false)
  eq(g.verdict, 'nodata', 'K线不足 21 根 → nodata 不评分')
}

/* ---------------- idxStyle ---------------- */
console.log('== idxStyle（大盘 vs 小微盘） ==')
{
  function mkIdx(c0, drift, n) {
    const bars = []; let px = c0
    for (let i = 0; i < (n || 30); i++) { px = px * (1 + drift); bars.push({ d: 'd' + i, o: px, c: px, h: px, l: px, v: 1 }) }
    return bars
  }
  let r = ST.idxStyle([mkIdx(3000, 0.001), mkIdx(4500, 0.001)], [mkIdx(7000, -0.0005), mkIdx(10000, -0.0005)])
  eq(r.dir, 'large', '大盘涨小微跌 → large')
  r = ST.idxStyle([mkIdx(3000, -0.001), mkIdx(4500, -0.001)], [mkIdx(7000, 0.001), mkIdx(10000, 0.001)])
  eq(r.dir, 'small', '小微涨大盘跌 → small')
  r = ST.idxStyle([mkIdx(3000, 0.0004), mkIdx(4500, 0.0004)], [mkIdx(7000, 0.0004), mkIdx(10000, 0.0004)])
  eq(r.dir, 'flat', '同涨同跌幅度近 → flat')
  r = ST.idxStyle([[null, null], [mkIdx(7000, 0.01), mkIdx(10000, 0.01)]])
  eq(r.dir, 'unknown', '大盘两条腿全缺 → unknown（不硬判）')
}

/* ---------------- themeLeaders ---------------- */
console.log('== themeLeaders（主线连庄判定） ==')
{
  function emoRow(theme, lbc) { return { code: '00000' + Math.floor(Math.random() * 9), name: 'x', pct: 10, ltsz: 50e8, lbc: lbc || 1, hybk: theme } }
  const hist = [
    { rows: [emoRow('半导体', 2), emoRow('半导体', 1), emoRow('券商', 1)] },
    { rows: [emoRow('半导体', 3), emoRow('半导体', 1), emoRow('光模块', 1)] },
    { rows: [emoRow('半导体', 4), emoRow('半导体', 2), emoRow('CPO', 1)] }
  ]
  let t = ST.themeLeaders(hist)
  eq(t.leadTheme, '半导体', '三连庄 → 主线=半导体')
  eq(t.leadDays, 3, '连庄 3 日')
  ok(t.themesToday.length >= 1 && t.themesToday[0].name === '半导体', '今日题材榜第一名=半导体')

  const rot = [
    { rows: [emoRow('半导体', 1), emoRow('券商', 1)] },
    { rows: [emoRow('券商', 1), emoRow('地产', 1)] },
    { rows: [emoRow('地产', 1), emoRow('白酒', 1)] }
  ]
  t = ST.themeLeaders(rot)
  ok(t.leadDays <= 1, '榜首日日换 → leadDays≤1（轮动市前提）')
}

/* ---------------- classifyStyle ---------------- */
console.log('== classifyStyle（七档判定与优先级） ==')
{
  const emoBase = { zt: 60, dt: 3, zb: 10, zbRate: 0.15, maxLbc: 4, twoPlus: 6, prem: 0.01, rows: [] }
  /* 1. 冰点 */
  let r = ST.classifyStyle({ cycle: { cycle: '冰点', why: ['涨停 12 家 ≤ 25'] }, emo: Object.assign({}, emoBase, { zt: 12, maxLbc: 2 }), fng: 20, idx: { dir: 'flat', gap: 0.001 }, themes: { leadSeq: ['', '', ''], leadTheme: '', leadDays: 0, themesToday: [] } })
  eq(r.id, 'defense', '冰点 → defense（优先级最高）')
  ok(r.guide.indexOf('空仓观望') >= 0, '指南明确说空仓观望')
  /* 修复日例外要提到 */
  r = ST.classifyStyle({ cycle: { cycle: '退潮', why: [], repaired: true }, emo: Object.assign({}, emoBase, { zt: 30, maxLbc: 3 }), fng: 30, idx: { dir: 'flat', gap: 0 }, themes: { leadSeq: [], leadTheme: '', leadDays: 0, themesToday: [] } })
  eq(r.id, 'defense', '退潮 → defense')
  ok(r.guide.indexOf('修复日') >= 0 && r.guide.indexOf('翻红') >= 0, '退潮但溢价翻红 → 指南写明修复日可小仓试错')

  /* 2. 主升浪 */
  r = ST.classifyStyle({ cycle: { cycle: '发酵', why: [] }, emo: Object.assign({}, emoBase, { maxLbc: 4 }), fng: 55, idx: { dir: 'flat', gap: 0.005 }, themes: { leadSeq: ['半导体', '半导体', '半导体'], leadTheme: '半导体', leadDays: 3, themesToday: [{ name: '半导体', count: 9, maxLbc: 4 }] } })
  eq(r.id, 'theme-run', '题材三连庄+高度4 → theme-run')
  ok(r.name.indexOf('半导体') >= 0, '点名题材（' + r.name + '）')
  ok(r.guide.indexOf('15%') >= 0 && r.guide.indexOf('过热') >= 0, '指南含防过热接盘（20日涨幅>15%不新开仓）')

  /* 3. 妖股 */
  r = ST.classifyStyle({ cycle: { cycle: '高潮', why: [] }, emo: Object.assign({}, emoBase, { maxLbc: 6 }), fng: 70, idx: { dir: 'flat', gap: 0 }, themes: { leadSeq: ['半导体', '券商', '地产'], leadTheme: '地产', leadDays: 1, themesToday: [] } })
  eq(r.id, 'short-term', '空间板6且无连庄主线 → short-term')

  /* 4. 轮动 */
  r = ST.classifyStyle({ cycle: { cycle: '分歧', why: [] }, emo: Object.assign({}, emoBase, { maxLbc: 3, zt: 48 }), fng: 50, idx: { dir: 'flat', gap: 0 }, themes: { leadSeq: ['半导体', '券商', '地产'], leadTheme: '地产', leadDays: 1, themesToday: [] } })
  eq(r.id, 'rotation', '题材日日换+涨停48家 → rotation')

  /* 5. 机构抱团（轮动优先级更高，故题材榜首不能三连换） */
  r = ST.classifyStyle({ cycle: { cycle: '分歧', why: [] }, emo: Object.assign({}, emoBase, { maxLbc: 3, zt: 40 }), fng: 50, idx: { dir: 'large', gap: 0.031 }, themes: { leadSeq: ['半导体', '半导体', '券商'], leadTheme: '券商', leadDays: 1, themesToday: [] } })
  eq(r.id, 'crowd-large', '大盘超额 3.1% → crowd-large')
  ok(r.why.join('').indexOf('代理指标') >= 0, '如实标注「代理指标」缺真实基金持仓')

  /* 6. 小微盘 */
  r = ST.classifyStyle({ cycle: { cycle: '分歧', why: [] }, emo: Object.assign({}, emoBase, { maxLbc: 3, zt: 40 }), fng: 50, idx: { dir: 'small', gap: -0.028 }, themes: { leadSeq: [], leadTheme: '', leadDays: 0, themesToday: [] } })
  eq(r.id, 'small-cap', '小微超额 2.8% → small-cap')

  /* 7. 兜底 */
  r = ST.classifyStyle({ cycle: { cycle: '分歧', why: [] }, emo: emoBase, fng: 50, idx: { dir: 'flat', gap: 0.004 }, themes: { leadSeq: ['半导体', '券商', '半导体'], leadTheme: '半导体', leadDays: 2, themesToday: [] } })
  /* 注意：leadDays=2 但 maxLbc=4 ≥ runMinLbc → 其实应进 theme-run；此用例改为高度不足 */
  r = ST.classifyStyle({ cycle: { cycle: '分歧', why: [] }, emo: Object.assign({}, emoBase, { maxLbc: 2 }), fng: 50, idx: { dir: 'flat', gap: 0.004 }, themes: { leadSeq: ['半导体', '券商', '半导体'], leadTheme: '半导体', leadDays: 2, themesToday: [] } })
  eq(r.id, 'mixed', '题材连庄但高度≤2 且大小盘均衡 → mixed（题材高度不足不成主升浪）')
}

/* ---------------- scoreCandidate / guardCandidate ---------------- */
console.log('== scoreCandidate / guardCandidate（优选打分与硬剔除） ==')
{
  const c = { code: '300308', name: '中际旭创', sector: '通信设备', pct: 4.2, ltsz: 60e8, mainNet: 5e8, mainStreak: 5, mainSum5: 18e8, ret20: 12, ps: { score: 26, why: ['放量 VR 1.8'] }, sectorRank: 2 }
  let s = ST.scoreCandidate(c)
  ok(s.pass, '连续 5 日净流入 → pass')
  ok(s.score >= 60 && s.score <= 100, '分数在合理区间（' + s.score + '）')
  ok(s.reasons.length >= 3, '理由齐全（资金/板块/结构/位置）')

  const c2 = Object.assign({}, c, { mainStreak: 1 })
  s = ST.scoreCandidate(c2)
  ok(!s.pass && s.why.indexOf('连续不足') >= 0, '连续 1 日净流入 → 不通过且写明原因')

  eq(ST.guardCandidate({ code: '600519', name: '贵州茅台', ltsz: 100e8, pct: 3 }), null, '正常主板股放行')
  ok(ST.guardCandidate({ code: '600519', name: 'ST贵人', ltsz: 50e8, pct: 3 }) !== null, 'ST 剔除')
  ok(ST.guardCandidate({ code: '830799', name: '北交所股', ltsz: 10e8, pct: 3 }) !== null, '北交所剔除')
  ok(ST.guardCandidate({ code: '688981', name: '中芯国际', ltsz: 100e8, pct: 3 }) !== null, '科创板剔除（与龙头战法口径一致）')
  ok(ST.guardCandidate({ code: '300308', name: 'X', ltsz: 10e8, pct: 3 }) !== null, '流通市值不足剔除')
  ok(ST.guardCandidate({ code: '300308', name: 'X', ltsz: 100e8, pct: 19.9 }) !== null, '创业板 20cm 已涨停剔除（不追板）')
  ok(ST.guardCandidate({ code: '600519', name: 'X', ltsz: 100e8, pct: 9.6 }) !== null, '主板 9.6% 已涨停剔除')
  ok(ST.guardCandidate({ code: '600519', name: 'X', ltsz: 100e8, pct: -4 }) !== null, '当日大跌 -4% 剔除')
}

/* ---------------- passFlow（资金连续性闸门） ---------------- */
console.log('== passFlow（资金连续性闸门，含缺史降级） ==')
{
  let r = ST.passFlow({ mainStreak: 4, flowDays: 6 })
  ok(r.pass && !r.degraded, '连续 4 日（史 6 天）→ 放行不降级')
  r = ST.passFlow({ mainStreak: 1, flowDays: 6 })
  ok(!r.pass, '连续 1 日（史 6 天）→ 拦下')
  r = ST.passFlow({ mainStreak: 1, flowDays: 1 })
  ok(r.pass && r.degraded, '连续 1 日但史仅 1 天 → 当日口径放行 + 降级标注')
  r = ST.passFlow({ mainStreak: 0, flowDays: 1 })
  ok(!r.pass, '当日净流出 → 拦下')
  r = ST.passFlow({ mainStreak: NaN, flowDays: 0 })
  ok(!r.pass, '史为 0 → 拦下')
}

/* ---------------- 版本常量 ---------------- */
console.log('== 版本 ==')
eq(ST.STYLE_VERSION, 'S1', 'STYLE_VERSION=S1')

console.log('\n结果：' + pass + ' 通过 / ' + fail + ' 失败')
process.exit(fail ? 1 : 0)
