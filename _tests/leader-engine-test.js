#!/usr/bin/env node
/* eslint-disable */
/**
 * 龙头战法引擎单测（不联网）——测 screener.js 导出的纯函数。
 * 口径见总纲「二·补3」。跑法：node _tests/leader-engine-test.js
 */
const E = require('../stock-alert-cloud/screener.js')

let pass = 0, fail = 0
const F = []
function ok(cond, msg) { if (cond) { pass++ } else { fail++; F.push(msg) } }
function eq(a, b, msg) { ok(a === b, msg + '（期望 ' + b + '，实际 ' + a + '）') }

/* ---------- limitPrice / isLimitUpBar ---------- */
eq(E.limitPrice('600519', 10.00), 11.00, '主板涨停价 = 前收 ×1.1（两位小数）')
eq(E.limitPrice('000001', 9.87), 10.86, '主板涨停价四舍五入到分')
eq(E.limitPrice('300750', 10.00), 12.00, '创业板涨停价 = 前收 ×1.2')
const barZt = { d: '2026-09-17', o: 10.50, c: 11.00, h: 11.00, l: 10.40, v: 1000 }
ok(E.isLimitUpBar('600519', barZt, 10.00), '收盘=涨停价 → 判涨停')
ok(!E.isLimitUpBar('600519', { d: 'x', o: 10.5, c: 10.98, h: 11.02, l: 10.4, v: 1 }, 10.00), '收盘差 2 分 → 不是涨停（容差 0.005）')

/* ---------- analyzeBars ---------- */
// 构造 80 根日线：缓涨，最后一天涨停；其中第一天起有 3 连板后回调（二波结构）
function mkBars(n, start, drift) {
  const bars = []
  let p = start
  for (let i = 0; i < n; i++) { const c = p * (1 + drift); bars.push({ d: 'd' + i, o: p, c: c, h: c * 1.005, l: p * 0.995, v: 1000 }); p = c }
  return bars
}
const base = mkBars(70, 10, 0.002)
// 末根：涨停
const prev = base[base.length - 1].c
const lim = E.limitPrice('600519', prev)
base.push({ d: 'dLast', o: prev * 1.01, c: lim, h: lim, l: prev * 1.005, v: 2000 })
const feat = E.analyzeBars('600519', base, true)
ok(feat.ok, 'analyzeBars：70 根以上正常')
ok(feat.isZt, 'analyzeBars：knownLimitUp=true → isZt')
eq(feat.streak, 1, 'analyzeBars：前一天没涨停 → 连板数 1')
eq(feat.isOneWord, false, 'analyzeBars：低开高走涨停 ≠ 一字板')
ok(isFinite(feat.gain20) && feat.gain20 > 0, 'analyzeBars：20 日涨幅可算')
// 一字板
const base2 = mkBars(70, 10, 0.002)
const prev2 = base2[base2.length - 1].c
const lim2 = E.limitPrice('600519', prev2)
base2.push({ d: 'dLast', o: lim2, c: lim2, h: lim2, l: lim2, v: 100 })
eq(E.analyzeBars('600519', base2, true).isOneWord, true, 'analyzeBars：开高低收全在涨停价 = 一字板')
// 连板数：末尾连着 3 根涨停
const base3 = mkBars(70, 10, 0.001)
for (let k = 0; k < 3; k++) {
  const p3 = base3[base3.length - 1].c
  const l3 = E.limitPrice('600519', p3)
  base3.push({ d: 'z' + k, o: p3 * 1.005, c: l3, h: l3, l: p3, v: 1500 })
}
eq(E.analyzeBars('600519', base3, true).streak, 3, 'analyzeBars：连续 3 根涨停 → streak=3')

/* ---------- guardReject（防接盘硬过滤） ---------- */
const goodCand = { code: '600721', name: '百花医药', ltsz: 5e9, hs: 8, zbc: 0, fbt: 93500, lbc: 1, hybk: '医疗服务' }
ok(E.guardReject(goodCand, feat, { isMaxBoard: false, wasZbYesterday: false }) === null, 'guardReject：正常票放行')
eq(E.guardReject({ ...goodCand, name: 'ST百花' }, feat, {}), 'ST/退市', 'guardReject：ST 拦')
eq(E.guardReject({ ...goodCand, code: '688478' }, feat, {}), '非沪深主板/创业板', 'guardReject：科创板拦')
eq(E.guardReject({ ...goodCand, ltsz: 15e8 }, feat, {}), '流通市值 15 亿在游资甜区外', 'guardReject：市值下限拦')
eq(E.guardReject({ ...goodCand, ltsz: 400e8 }, feat, {}), '流通市值 400 亿在游资甜区外', 'guardReject：市值上限拦')
eq(E.guardReject({ ...goodCand, hs: 50 }, feat, {}), '换手 50% 末日轮', 'guardReject：末日换手拦')
eq(E.guardReject({ ...goodCand, zbc: 2 }, feat, {}), '今日炸板 2 次', 'guardReject：炸板 2 次拦')
eq(E.guardReject({ ...goodCand, fbt: 143500 }, feat, {}), '尾盘偷袭板（首封 14:30 后）', 'guardReject：尾盘板拦')
eq(E.guardReject({ ...goodCand, lbc: 6 }, feat, { isMaxBoard: false }), '6 板鱼尾接力', 'guardReject：6 板非空间板拦')
eq(E.guardReject({ ...goodCand, lbc: 5 }, feat, { isMaxBoard: false, isDip: true }), '5 板高位大分歧（负反馈开端，不接）', 'guardReject：低吸路径 5 板高位分歧拦')
ok(E.guardReject({ ...goodCand, lbc: 5 }, feat, { isMaxBoard: false }) === null, 'guardReject：5 板打板路径不受 isDip 影响')
ok(E.guardReject({ ...goodCand, lbc: 6 }, feat, { isMaxBoard: true }) === null, 'guardReject：6 板但是全场空间板 → 放行')
const oneWordFeat = { ...feat, isOneWord: true }
eq(E.guardReject(goodCand, oneWordFeat, {}), '一字板买不进', 'guardReject：一字板拦')
ok(E.guardReject({ ...goodCand, zbc: NaN }, feat, {}) === null, 'guardReject：zbc 缺失（降级路径）不误杀')

/* ---------- classifyCycle（情绪周期） ---------- */
function emoOf(o) {
  return { date: 'd', zt: o.zt, dt: o.dt || 0, zb: o.zb || 0, zbRate: o.zbRate || 0, maxLbc: o.lbc, twoPlus: o.two || 0, threePlus: o.three || 0, prem: o.prem, rows: [], zbCodes: [] }
}
eq(E.classifyCycle([emoOf({ zt: 20, lbc: 4, prem: 0.01 })]).cycle, '冰点', 'classifyCycle：涨停 20 家 → 冰点')
eq(E.classifyCycle([emoOf({ zt: 40, lbc: 5, prem: -0.05 })]).cycle, '冰点', 'classifyCycle：溢价 -5% → 冰点')
eq(E.classifyCycle([emoOf({ zt: 40, lbc: 5, prem: -0.03 })]).cycle, '退潮', 'classifyCycle：溢价 -3% → 退潮')
eq(E.classifyCycle([emoOf({ zt: 60, lbc: 6, prem: 0.01, zbRate: 0.1, two: 8 })]).cycle, '高潮', 'classifyCycle：涨停 60 且 6 板 → 高潮')
eq(E.classifyCycle([emoOf({ zt: 60, lbc: 5, prem: 0.06, zbRate: 0.1, two: 4 })]).cycle, '高潮', 'classifyCycle：溢价 +6% → 高潮')
eq(E.classifyCycle([emoOf({ zt: 60, lbc: 5, prem: 0.01, zbRate: 0.2, two: 6 })]).cycle, '发酵', 'classifyCycle：涨停 60+梯队完整 → 发酵')
eq(E.classifyCycle([emoOf({ zt: 40, lbc: 4, prem: 0.01, zbRate: 0.2 })]).cycle, '启动', 'classifyCycle：涨停 40+溢价正 → 启动')
{
  // 退潮但溢价翻红 → 修复日（用炸板率触发退潮，而不是溢价——溢价已翻红）
  const h = [emoOf({ zt: 45, lbc: 5, prem: -0.03 }), emoOf({ zt: 45, lbc: 3, prem: 0.01, zbRate: 0.45 })]
  const cc = E.classifyCycle(h)
  eq(cc.cycle, '退潮', 'classifyCycle：炸板率 45% → 退潮档')
  eq(cc.repaired, true, 'classifyCycle：溢价由负翻红 = 修复日')
}
// 空间板断崖：4 日峰值 ≥5 掉到 ≤3 → 退潮
eq(E.classifyCycle([emoOf({ zt: 60, lbc: 6, prem: 0.02, zbRate: 0.1 }), emoOf({ zt: 55, lbc: 5, prem: 0.01, zbRate: 0.1 }), emoOf({ zt: 45, lbc: 3, prem: 0.005, zbRate: 0.2 })]).cycle, '退潮', 'classifyCycle：空间板 6→3 断崖 → 退潮')

/* ---------- scoreBoard / scoreDip / dipBuyPrice ---------- */
{
  const emo = emoOf({ zt: 60, lbc: 5, prem: 0.01, zbRate: 0.15, two: 8 })
  const thTop = { count: 6, maxLbc: 4, isThemeTop: true, isMaxBoard: false }
  const s1 = E.scoreBoard(goodCand, feat, emo, thTop)
  ok(s1.score >= E.P.boardMinScore, 'scoreBoard：低位首板+板块最高板+题材 6 家 → 应达标（实际 ' + s1.score + '）')
  const s2 = E.scoreBoard(goodCand, feat, emo, { count: 1, maxLbc: 1, isThemeTop: false, isMaxBoard: false })
  ok(s2.score < s1.score, 'scoreBoard：题材独苗分数 < 板块梯队完整')
}
{
  const featDip = { ok: true, close: 9.5, prevClose: 10, ma5: 9.6, ma10: 9.2, low: 9.3, high: 9.9, isZt: false, streak: 0, isOneWord: false, gain20: 0.2, dd60: -0.1, hadRun: false, isSecondWave: false, volNow: 900, volPrev: 1200, volRatio: 0.75 }
  const s = E.scoreDip({ pct: -0.05, ylbc: 3, volRatio: 0.9, feat: featDip, hybk: '半导体' }, { count: 3, maxLbc: 4 }, emoOf({ zt: 50, lbc: 5, prem: 0.01, zbRate: 0.2, two: 5 }))
  ok(s && s.score >= E.P.dipMinScore, 'scoreDip：3 板强势分歧缩量+题材仍有 3 板 → 应达标（实际 ' + (s && s.score) + '）')
  eq(E.scoreDip({ pct: -0.05, ylbc: 3, volRatio: 0.9, feat: featDip, hybk: '半导体' }, { count: 0, maxLbc: 0 }, emoOf({ zt: 50, lbc: 5, prem: 0.01, zbRate: 0.2, two: 5 })), null, 'scoreDip：题材今日 0 板（退潮）→ 拒绝')
  const bp = E.dipBuyPrice(featDip)
  eq(bp, Math.round(Math.min(9.3 * 1.02, 9.6 * 1.01) * 100) / 100, 'dipBuyPrice = min(低点×1.02, 5日线×1.01)')
  const featBreak = { ...featDip, low: 8.8 }
  ok(isNaN(E.dipBuyPrice(featBreak)), 'dipBuyPrice：买入价已低于 10 日线 ×0.98（破位）→ 不给买价')
}

/* ---------- 汇总 ---------- */
console.log('龙头战法引擎单测：' + pass + ' 通过 / ' + fail + ' 失败')
if (fail) { console.log('失败项：'); for (const m of F) console.log('  ✗ ' + m); process.exit(1) }
console.log('ALL GREEN')
