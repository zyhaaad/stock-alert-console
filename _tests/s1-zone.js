/* S1 · 波段级（区间）评估 —— 全 17 只，不针对单只股票调参
 *
 * 用户 2026-09-20 指导：
 *   「不要对一个股票过度拟合，要整体去思考去判断，你改后其他股票有没有影响；
 *     你给的可以是定性的，出货也不是一天能完成的，底部也是慢慢走出来的；
 *     你要在单日精确性和波段定性上考虑。」
 *
 * 做法：
 *   ① 用**真代码** weekStage（jsdom 装预览）逐日取指标 —— 保证口径 = console（含当周残周）
 *   ② 把信号当**区间**：连续满足条件（允许 ≤GAP 个交易日的抖动）合并成一段
 *   ③ 区间级评估（一段算一次，不是一天算一次）：
 *        底部区间 → 「在区间里慢慢建仓」的均价，之后 20/60 日怎么样
 *        派发区间 → 「在区间里分批出」，相比一直拿到区间结束后 60 日，躲掉多少
 *   ④ 同时给出 现行 console 规则 vs 候选规则 在全部 17 只上的覆盖与质量差异
 *
 * ⚠️ 必须先跑 build-preview。用法：node _tests/s1-zone.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules'
module.paths.push(WS)
const { JSDOM, VirtualConsole } = require(path.join(WS, 'jsdom'))

const PREVIEW = 'D:/mywork/_preview/stock-picker-preview.html'
const raw = JSON.parse(fs.readFileSync(__dirname + '/_cache/bt-data.json', 'utf8')).stocks
const codes = Object.keys(raw)
const NAMES = { '600703': '三安光电', '000155': '川能动力', '002594': '比亚迪', '601127': '赛力斯',
  '002415': '海康威视', '002714': '牧原股份', '600058': '五矿发展', '600721': '百花医药',
  '600733': '北汽蓝谷', '603026': '石大胜华', '603162': '海通发展', '002349': '精华制药',
  '000762': '西藏矿业', '000767': '晋控电力', '002471': '中超控股', '002577': '雷柏科技', '300132': '青松股份' }
const GAP = 5            // 区间内允许的抖动（交易日）
const WARM = 260

const mean = a => { const v = a.filter(isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN }
const med = a => { const v = a.filter(isFinite).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN }
const fR = x => isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%' : '—'
const fP = x => isFinite(x) ? (x * 100).toFixed(0) + '%' : '—'

function zonesOf(flags, gap) {           /* flags: bool[] → [{s,e}] 允许 gap 抖动 */
  const zs = []
  let last = -Infinity
  for (let k = 0; k < flags.length; k++) {
    if (!flags[k]) continue
    if (zs.length && k - last <= gap) zs[zs.length - 1].e = k
    else zs.push({ s: k, e: k })
    last = k
  }
  return zs
}

;(async () => {
  const vc = new VirtualConsole()
  const dom = new JSDOM(fs.readFileSync(PREVIEW, 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://stock-alert-console.app.workbuddy.host/', virtualConsole: vc })
  const w = dom.window
  await new Promise(r => setTimeout(r, 700))
  if (w.STAGE_VERSION !== 'S2') { console.log('预览引擎不是 S2'); process.exit(1) }
  console.log('真代码装载 OK｜STAGE_VERSION=' + w.STAGE_VERSION + '｜ML_LOW_GATE=' + w.ML_LOW_GATE + '｜ML_SUP_GATE=' + w.ML_SUP_GATE)

  const out = []
  const say = s => { out.push(s); console.log(s) }

  /* ── 逐只逐日取真代码指标 ── */
  const S = {}
  for (const code of codes) {
    const st = raw[code]
    const bars = st.bars.map(r => ({ d: r[0], o: +r[1], c: +r[2], h: +r[3], l: +r[4], v: +r[5] }))
    const flow = st.flows.map(r => { const p = r.split(','); return { d: p[0], main: Number(p[1]) } }).filter(x => isFinite(x.main))
    const secid = w.secidOf({ code })
    const rows = []
    for (let t = WARM; t < bars.length; t++) {
      const cur = bars[t].d
      const fd = flow.filter(x => x.d <= cur).slice(-30)
      w.G.dayBars = {}; w.G.dayBars[code] = bars.slice(0, t + 1)
      w.G.chipMap = {}; w.G.chipMap[code] = { flowDaily: fd.map(x => x.d + ',' + x.main), floatShares: st.floatShares }
      w.G.quoteMap = {}; w.G.quoteMap[secid] = { price: bars[t].c, mv: st.floatShares * bars[t].c }
      const m = w.weekStage(code)
      if (!m) continue
      rows.push({ t, d: cur, c: bars[t].c, h: bars[t].h, l: bars[t].l, key: m.key,
        pos: m.pos250, sup: m.supDist, res: m.resDist, mr: m.mainRatio, vr: m.volRatio,
        wma5: m.wma5, wma20: m.wma20, over: m.overMa5, topS: m.topStrong, prem: m.premLow,
        ret60: m.ret60 })
    }
    S[code] = { bars, rows }
  }
  const N = codes.length
  const totDays = mean(codes.map(c => S[c].rows.length))
  const years = totDays / 244
  say('样本：' + N + ' 只 × 平均 ' + totDays.toFixed(0) + ' 个交易日 ≈ ' + years.toFixed(2) + ' 年｜区间合并容差 ' + GAP + ' 个交易日')
  say('基准（全样本 60 日）：' + fR(mean(codes.flatMap(c => S[c].rows.map(r => {
    const b = S[c].bars, t = r.t; return (t + 60 < b.length) ? b[t + 60].c / b[t].c - 1 : NaN
  })))))

  const fwd = (code, t, h) => { const b = S[code].bars; return (t + h < b.length) ? b[t + h].c / b[t].c - 1 : NaN }
  const rng64 = (code, a, b2) => { const bars = S[code].bars; let lo = Infinity, hi = -Infinity, s = 0, k = 0
    for (let j = a; j <= b2; j++) { if (bars[j].l < lo) lo = bars[j].l; if (bars[j].h > hi) hi = bars[j].h; s += bars[j].c; k++ }
    return { lo, hi, avg: s / k } }

  /* ── 区间构造 ── */
  function buildZones(cond) {
    const Z = {}
    for (const code of codes) {
      const flags = S[code].rows.map(cond)
      Z[code] = zonesOf(flags, GAP).map(z => ({
        code, sRow: S[code].rows[z.s], eRow: S[code].rows[z.e],
        days: z.e - z.s + 1, gapMerged: z.e - z.s + 1 - flags.slice(z.s, z.e + 1).filter(Boolean).length,
        rng: rng64(code, S[code].rows[z.s].t, S[code].rows[z.e].t)
      }))
    }
    return Z
  }
  const allZ = Z => codes.flatMap(c => Z[c])

  const RULES = {
    'S2·建仓区（要件：资金>0.4% + 位置<40% + 周线多头 + 两道位置闸门；已删冗余的「60日涨<15%」）':
      r => r.key === 'accumulate-zone',
    '候选·低位关注（去掉「周线多头」这一条，其余不变）':
      r => r.mr > 0.004 && r.pos < 0.4 && r.sup < 0.15,
    '候选·低位关注·更宽（位置<50%）':
      r => r.mr > 0.004 && r.pos < 0.5 && r.sup < 0.15,
    'S2·现行卖点（高位过热 = 多头排列 + 连续≥2日站上MA5 + 偏离MA5>5% + 位置>65%）': r => r.key === 'sell-overheat',
    '已停用·旧派发完毕（位置>65% + 60日涨>20% + 缩量或资金转负）':
      r => r.pos > 0.65 && r.ret60 > 0.20 && (r.vr < 1.0 || r.mr < 0),
    '派发·候选（位置>65% + 偏离MA5>5%）': r => r.pos > 0.65 && r.over > 0.05
  }

  function evalBuy(label, cond) {
    const Z = allZ(buildZones(cond))
    const byStock = {}
    Z.forEach(z => (byStock[z.code] = byStock[z.code] || []).push(z))
    const cov = Object.keys(byStock).length
    const perYear = Z.length / N / years
    /* 区间起点买入 / 区间均价买入 / 区间内最低点买入 */
    const fromStart = Z.map(z => fwd(z.code, z.sRow.t, 60)).filter(isFinite)
    const fromMid = Z.map(z => {
      const end = z.eRow.t
      return (end + 60 < S[z.code].bars.length) ? S[z.code].bars[end + 60].c / z.rng.avg - 1 : NaN
    }).filter(isFinite)
    const fromLow = Z.map(z => (z.eRow.t + 60 < S[z.code].bars.length) ? S[z.code].bars[z.eRow.t + 60].c / z.rng.lo - 1 : NaN).filter(isFinite)
    /* 建仓期间的最大浮亏（从均价到区间最低） */
    const pain = Z.map(z => z.rng.lo / z.rng.avg - 1).filter(isFinite)
    /* 区间结束后 60 日 */
    const after = Z.map(z => fwd(z.code, z.eRow.t, 60)).filter(isFinite)
    say('')
    say('◆ ' + label)
    say('   区间 ' + Z.length + ' 段｜覆盖 ' + cov + '/' + N + ' 只｜平均每只每年 ' + perYear.toFixed(2) + ' 段' +
      '｜平均持续 ' + mean(Z.map(z => z.days)).toFixed(0) + ' 个交易日（自然日约 ' + (mean(Z.map(z => z.days)) * 1.4).toFixed(0) + ' 天）')
    say('   区间起点买入 → 60日 ' + fR(mean(fromStart)) + '（中位 ' + fR(med(fromStart)) + '，正收益率 ' + fP(fromStart.filter(x => x > 0).length / fromStart.length) + '）')
    say('   区间**均价**买入 → 至区间结束后60日 ' + fR(mean(fromMid)) + '（中位 ' + fR(med(fromMid)) + '）')
    say('   区间**最低点**买入 → 至区间结束后60日 ' + fR(mean(fromLow)) + '（中位 ' + fR(med(fromLow)) + '）')
    say('   建仓期间浮亏：从区间均价到区间最低 平均 ' + fR(mean(pain)) + '（中位 ' + fR(med(pain)) + '）← 慢慢走出来要忍的')
    say('   区间结束后 60 日：' + fR(mean(after)) + '（说明"离开区间后还有没有肉"）')
    /* 逐只 */
    say('   逐只：' + codes.map(c => {
      const zs = byStock[c] || []
      if (!zs.length) return (NAMES[c] || c) + ' 无'
      const fs2 = zs.map(z => fwd(c, z.sRow.t, 60)).filter(isFinite)
      return (NAMES[c] || c) + ' ' + zs.length + '段' + (fs2.length ? '(' + fR(mean(fs2)) + ')' : '')
    }).join('｜'))
    return { Z, perYear, cov, fromStart, fromMid, pain }
  }

  function evalSell(label, cond) {
    const Z = allZ(buildZones(cond))
    const byStock = {}
    Z.forEach(z => (byStock[z.code] = byStock[z.code] || []).push(z))
    /* 「分批出」：区间均价卖出；对照 = 一直拿到区间结束后 60 日的收盘 */
    const avoid = Z.map(z => {
      const b = S[z.code].bars, e = z.eRow.t
      if (e + 60 >= b.length) return NaN
      return z.rng.avg / b[e + 60].c - 1      /* >0 = 卖出均价高于60日后的价格 = 躲对了 */
    }).filter(isFinite)
    const peakAfter = Z.map(z => {
      const b = S[z.code].bars, e = z.eRow.t
      if (e + 60 >= b.length) return NaN
      let hi = -Infinity
      for (let j = e + 1; j <= e + 60; j++) if (b[j].h > hi) hi = b[j].h
      return hi / z.rng.avg - 1               /* 卖出后还能涨多少（后悔值） */
    }).filter(isFinite)
    say('')
    say('◆ ' + label)
    say('   区间 ' + Z.length + ' 段｜覆盖 ' + Object.keys(byStock).length + '/' + N + ' 只｜平均每只每年 ' +
      (Z.length / N / years).toFixed(2) + ' 段｜平均持续 ' + mean(Z.map(z => z.days)).toFixed(0) + ' 个交易日')
    say('   「区间均价分批出」vs「一直拿到区间结束后60日」：' + fR(mean(avoid)) +
      '（中位 ' + fR(med(avoid)) + '，躲对率 ' + fP(avoid.filter(x => x > 0).length / avoid.length) + '）')
    say('   卖出后 60 日内还能涨多少（后悔值）：平均 ' + fR(mean(peakAfter)) + '（中位 ' + fR(med(peakAfter)) + '）← 出早了要认')
    say('   逐只：' + codes.map(c => {
      const zs = byStock[c] || []
      if (!zs.length) return (NAMES[c] || c) + ' 无'
      return (NAMES[c] || c) + ' ' + zs.length + '段'
    }).join('｜'))
    return { Z, avoid, peakAfter }
  }

  say('')
  say('══════════════════ 一、底部区间（"底部是慢慢走出来的"）══════════════════')
  const B1 = evalBuy('S2·现行建仓区（已删冗余的「60日涨<15%」）', RULES['S2·建仓区（要件：资金>0.4% + 位置<40% + 周线多头 + 两道位置闸门；已删冗余的「60日涨<15%」）'])
  const B2 = evalBuy('候选·低位关注（去掉「周线多头」）', RULES['候选·低位关注（去掉「周线多头」这一条，其余不变）'])
  const B3 = evalBuy('候选·低位关注·更宽（位置<50%）', RULES['候选·低位关注·更宽（位置<50%）'])

  say('')
  say('══════════════════ 二、派发区间（"出货不是一天能完成的"）══════════════════')
  const S1z = evalSell('S2·现行卖点（高位过热）', RULES['S2·现行卖点（高位过热 = 多头排列 + 连续≥2日站上MA5 + 偏离MA5>5% + 位置>65%）'])
  const S2z = evalSell('已停用·旧派发完毕（对照）', RULES['已停用·旧派发完毕（位置>65% + 60日涨>20% + 缩量或资金转负）'])
  const S3z = evalSell('候选·只看位置+偏离MA5（不要求多头排列）', RULES['派发·候选（位置>65% + 偏离MA5>5%）'])

  say('')
  say('══════════════════ 三、改动对全体股票的影响（关键）══════════════════')
  say('　底 现行 vs 候选(低位关注)：')
  say('　　区间数 ' + B1.Z.length + ' → ' + B2.Z.length + '｜覆盖 ' + B1.cov + '/' + N + ' → ' + B2.cov + '/' + N +
    '｜每只每年 ' + B1.perYear.toFixed(2) + ' → ' + B2.perYear.toFixed(2))
  say('　　区间起点买入60日 ' + fR(mean(B1.fromStart)) + ' → ' + fR(mean(B2.fromStart)) +
    '｜均价买入 ' + fR(mean(B1.fromMid)) + ' → ' + fR(mean(B2.fromMid)) +
    '｜建仓期浮亏 ' + fR(mean(B1.pain)) + ' → ' + fR(mean(B2.pain)))
  const c1 = new Set(B1.Z.map(z => z.code)), c2 = new Set(B2.Z.map(z => z.code))
  say('　　候选新增覆盖的股票：' + codes.filter(c => c2.has(c) && !c1.has(c)).map(c => NAMES[c]).join('、'))
  say('　卖 已停用（旧派发完毕） vs S2 现行（高位过热）：')
  say('　　区间数 ' + S2z.Z.length + ' → ' + S1z.Z.length + '｜躲对率 ' + fP(S2z.avoid.filter(x => x > 0).length / S2z.avoid.length) +
    ' → ' + fP(S1z.avoid.filter(x => x > 0).length / S1z.avoid.length) +
    '｜躲对幅度 ' + fR(mean(S2z.avoid)) + ' → ' + fR(mean(S1z.avoid)) +
    '｜后悔值 ' + fR(mean(S2z.peakAfter)) + ' → ' + fR(mean(S1z.peakAfter)))

  say('')
  say('══════════════════ 四、消融实验：建仓区每条条件各自值多少（全 17 只，区间级）══════════════════')
  say('　做法：从现行建仓区出发，每次只去掉一条，看区间数/覆盖/质量怎么变。不挑参数，只看每条条件的分量。')
  const C = {
    '资金>0.4%':       r => r.mr > 0.004,
    '位置<40%':        r => r.pos < 0.4,
    '60日涨<15%':      r => r.ret60 < 0.15,
    '周线多头':        r => r.wma5 > r.wma20,
    '距一年低<30%':    r => r.prem < 0.30,
    '距20周支撑<15%':  r => r.sup < 0.15
  }
  const names = Object.keys(C)
  function ablate(label, cond) {
    const Z = allZ(buildZones(cond))
    const by = {}; Z.forEach(z => (by[z.code] = by[z.code] || []).push(z))
    const fs2 = Z.map(z => fwd(z.code, z.sRow.t, 60)).filter(isFinite)
    const mid = Z.map(z => (z.eRow.t + 60 < S[z.code].bars.length) ? S[z.code].bars[z.eRow.t + 60].c / z.rng.avg - 1 : NaN).filter(isFinite)
    const pain = Z.map(z => z.rng.lo / z.rng.avg - 1).filter(isFinite)
    say('   ' + label.padEnd(22) + '区间 ' + String(Z.length).padStart(3) + '｜覆盖 ' + String(Object.keys(by).length).padStart(2) + '/17' +
      '｜每只每年 ' + (Z.length / codes.length / years).toFixed(2) + '｜起点60日 ' + fR(mean(fs2)).padEnd(7) +
      '｜均价60日 ' + fR(mean(mid)).padEnd(7) + '｜正收益率 ' + fP(fs2.length ? fs2.filter(x => x > 0).length / fs2.length : NaN) +
      '｜建仓浮亏 ' + fR(mean(pain)))
  }
  ablate('基线（全 6 条）', r => names.every(n => C[n](r)))
  for (const drop of names) ablate('去掉 ' + drop, r => names.filter(n => n !== drop).every(n => C[n](r)))
  ablate('只留 周线多头+位置<40%', r => C['周线多头'](r) && C['位置<40%'](r))
  ablate('只留 周线多头+资金>0.4%', r => C['周线多头'](r) && C['资金>0.4%'](r))
  ablate('只留 位置<40%+资金>0.4%+支撑<15%', r => C['位置<40%'](r) && C['资金>0.4%'](r) && C['距20周支撑<15%'](r))

  fs.writeFileSync(__dirname + '/s1-zone-report.md', out.join('\n'), 'utf8')
  console.log('\n→ 已写 _tests/s1-zone-report.md')
  process.exit(0)
})().catch(e => { console.log('❌ ' + (e && e.stack || e)); process.exit(1) })
