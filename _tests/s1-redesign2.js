/* S1 重构候选回测 · 第二轮（2026-09-20）
 * 第一轮（s1-redesign.js）结论：
 *   - 「周线仍空」不是必要条件，反而是拖累（加周线空 → 60日从 +9.72% 降到 +8.21%；加周线多 → +14.69%）
 *   - 最实用的买点其实是「资金进 + 位置低」两因子：n=349/每只每年 2.65 次/60日 +9.72%，覆盖 15/17
 *   - 卖出侧「减仓-标准（高位+偏离MA5>5%）」频次够（5.31次/年）但中等；「减仓-强」质高（-8.02%）量少
 * 本轮要做的：把阈值/位置档位扫一遍，定出**最终规则**，并给出组合后的**总信号频次**。
 * 用法：node _tests/s1-redesign2.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules'
module.paths.push(WS)
const { JSDOM, VirtualConsole } = require(path.join(WS, 'jsdom'))

const DROP = -0.05
const html = fs.readFileSync('D:/mywork/_preview/stock-picker-preview.html', 'utf8')
const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: new VirtualConsole(), url: 'https://local/' })
const data = JSON.parse(fs.readFileSync(__dirname + '/_cache/bt-data.json', 'utf8')).stocks
const codes = Object.keys(data)
const NAMES = { '600703': '三安光电', '000155': '川能动力', '002594': '比亚迪', '601127': '赛力斯',
  '002415': '海康威视', '002714': '牧原股份', '600058': '五矿发展', '600721': '百花医药',
  '600733': '北汽蓝谷', '603026': '石大胜华', '603162': '海通发展', '002349': '精华制药',
  '000762': '西藏矿业', '000767': '晋控电力', '002471': '中超控股', '002577': '雷柏科技', '300132': '青松股份' }

const mean = a => { const v = a.filter(x => isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN }
const pct = (n, d) => d ? n / d * 100 : NaN
const fR = x => isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '—'
const fP = x => isFinite(x) ? x.toFixed(1) + '%' : '—'

function weekKey(dstr) {
  const d = new Date(dstr + 'T00:00:00Z'); const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + (4 - day)); return d.toISOString().slice(0, 10)
}

function build() {
  const rows = []
  for (const code of codes) {
    const st = data[code], bars = st.bars, flows = st.flows, fs_ = st.floatShares
    const flowByDate = {}
    for (const f of flows) { const p = f.split(','); flowByDate[p[0]] = Number(p[1]) }
    const O = bars.map(b => +b[1]), C = bars.map(b => +b[2]), H = bars.map(b => +b[3]), L = bars.map(b => +b[4])
    const V = bars.map(b => b[5]), D = bars.map(b => b[0])
    const WARM = 260, MAXF = 60
    const wk = {}
    for (let i = 0; i < bars.length; i++) {
      const k = weekKey(D[i])
      if (!wk[k]) wk[k] = { k, c: C[i], v: 0, m: 0, h: H[i], l: L[i], last: D[i] }
      wk[k].c = C[i]; wk[k].v += V[i]; wk[k].last = D[i]
      if (H[i] > wk[k].h) wk[k].h = H[i]
      if (L[i] < wk[k].l) wk[k].l = L[i]
      if (isFinite(flowByDate[D[i]])) wk[k].m += flowByDate[D[i]]
    }
    const wks = Object.keys(wk).sort().map(k => wk[k])
    for (let i = WARM; i < bars.length - MAXF; i++) {
      const date = D[i]
      const mainYi = flowByDate[date]
      if (!isFinite(mainYi)) continue
      const ret20 = C[i] / C[i - 20] - 1, ret60 = C[i] / C[i - 60] - 1
      let loP = Infinity, hiP = -Infinity
      for (let j = i - 249; j <= i; j++) { if (L[j] < loP) loP = L[j]; if (H[j] > hiP) hiP = H[j] }
      const pos250i = hiP > loP ? (C[i] - loP) / (hiP - loP) : NaN
      const premLow = C[i] / loP - 1
      const ma = n => { let s = 0; for (let j = i - n + 1; j <= i; j++) s += C[j]; return s / n }
      const ma5 = ma(5), ma10 = ma(10), ma20 = ma(20), ma30 = ma(30)
      const align = ma5 > ma10 && ma10 > ma20 && ma20 > ma30
      let streak = 0
      for (let j = i; j >= 0; j--) {
        let s = 0; for (let t = j - 4; t <= j; t++) s += C[t]
        const m5 = s / 5
        if (O[j] > m5 && C[j] > m5) streak++; else break
      }
      const overMa5 = C[i] / ma5 - 1
      const wIdx = wks.findIndex(x => x.last > date)
      const wEnd = wIdx < 0 ? wks.length - 1 : wIdx - 1
      const done = wks.slice(0, wEnd + 1)
      const wVol = done.map(x => x.v), wMain = done.map(x => x.m)
      const last20 = done.slice(-20)
      let wHi20 = -Infinity, wLo20 = Infinity
      last20.forEach(x => { if (x.h > wHi20) wHi20 = x.h; if (x.l < wLo20) wLo20 = x.l })
      const supDist = C[i] / wLo20 - 1, resDist = C[i] / wHi20 - 1
      const wma = n => (done.length >= n ? done.slice(-n).reduce((a, x) => a + x.c, 0) / n : NaN)
      const wma5 = wma(5), wma20 = wma(20)
      const volRatio = wVol.length >= 26 ? (wVol.slice(-4).reduce((a, b) => a + b, 0) / 4) / (wVol.slice(-26).reduce((a, b) => a + b, 0) / 26) : NaN
      const mv = fs_ * C[i]
      const main4w = wMain.length >= 4 ? wMain.slice(-4).reduce((a, b) => a + b, 0) / mv : NaN
      rows.push({ code, date, close: C[i], ret20, ret60, pos250i, premLow, supDist, resDist,
        volRatio, main4w, wma5, wma20, align, streak, overMa5, high60: NaN,
        fwd20: C[i + 20] / C[i] - 1, fwd60: C[i + 60] / C[i] - 1 })
    }
    const own = rows.filter(r => r.code === code)
    for (let k = 0; k < own.length; k++) {
      let mx = -Infinity
      for (let j = Math.max(0, k - 60); j <= k; j++) if (own[j].pos250i > mx) mx = own[j].pos250i
      own[k].high60 = mx
    }
  }
  return rows
}

;(async () => {
  await new Promise(r => setTimeout(r, 400))
  const rows = build()
  const days = [...new Set(rows.map(r => r.date))].length
  const years = days / 244
  const out = []
  const say = s => { out.push(s); console.log(s) }
  const epi = l => {
    const by = {}
    l.forEach(r => (by[r.code] = by[r.code] || []).push(r))
    let e = 0
    for (const c of Object.keys(by)) {
      const rs = by[c].sort((a, b) => a.date < b.date ? -1 : 1)
      for (let i = 0; i < rs.length; i++) if (i === 0 || (rows.indexOf(rs[i]) - rows.indexOf(rs[i - 1]) !== 1)) e++
    }
    const cov = codes.filter(c => (by[c] || []).length > 0).length
    return '段 ' + e + '｜每只每年 ' + (e / codes.length / years).toFixed(2) + ' 次｜有信号的股票 ' + cov + '/' + codes.length
  }
  const SEG = [['2025H1', '2025-01-01', '2025-06-30'], ['2025H2', '2025-07-01', '2025-12-31'], ['2026H1', '2026-01-01', '2026-06-30']]
  const line = (label, l) => label.padEnd(50) + 'n=' + String(l.length).padEnd(6) + '20日 ' + fR(mean(l.map(r => r.fwd20))).padEnd(9) +
    '60日 ' + fR(mean(l.map(r => r.fwd60))).padEnd(9) + '跌5% ' + fP(pct(l.filter(r => r.fwd60 <= DROP).length, l.length)).padEnd(7) +
    SEG.map(([, a, b]) => fR(mean(l.filter(r => r.date >= a && r.date <= b).map(r => r.fwd60))).padEnd(9)).join('')

  say('样本：' + codes.length + ' 只 × ' + rows.length + ' 点 ≈ ' + years.toFixed(2) + ' 年')
  say('基准：20日 ' + fR(mean(rows.map(r => r.fwd20))) + '｜60日 ' + fR(mean(rows.map(r => r.fwd60))) +
    '｜跌超5% ' + fP(pct(rows.filter(r => r.fwd60 <= DROP).length, rows.length)))

  say('')
  say('===== 一、单因子（看每个因子值多少）=====')
  const SINGLE = {
    '只有 位置<0.4': r => r.pos250i < 0.4,
    '只有 位置<0.3': r => r.pos250i < 0.3,
    '只有 资金>0.4%': r => r.main4w > 0.004,
    '只有 资金>0.2%': r => r.main4w > 0.002,
    '只有 周线多头': r => isFinite(r.wma20) && r.wma5 > r.wma20,
    '只有 距20周支撑<15%': r => r.supDist < 0.15
  }
  for (const [l, fn] of Object.entries(SINGLE)) { const x = rows.filter(fn); say(line('  ' + l, x)); say('      ' + epi(x)) }

  say('')
  say('===== 二、买入规则：位置×资金 阈值扫描（目标 每只每年≥2 且 60日>基准）=====')
  const BUY = []
  for (const [pLab, pFn] of [['位置<0.4', r => r.pos250i < 0.4], ['位置<0.5', r => r.pos250i < 0.5], ['位置<0.35', r => r.pos250i < 0.35]])
    for (const [mLab, mFn] of [['资金>0.1%', r => r.main4w > 0.001], ['资金>0.2%', r => r.main4w > 0.002], ['资金>0.4%', r => r.main4w > 0.004]])
      BUY.push([pLab + ' + ' + mLab + ' + 支撑<15%', r => pFn(r) && mFn(r) && r.supDist < 0.15])
  BUY.push(['位置<0.4 + 资金>0.2% + 支撑<20%', r => r.pos250i < 0.4 && r.main4w > 0.002 && r.supDist < 0.20])
  BUY.push(['位置<0.4 + 资金>0.2%（无支撑闸门）', r => r.pos250i < 0.4 && r.main4w > 0.002])
  for (const [l, fn] of BUY) { const x = rows.filter(fn); say(line('  ' + l, x)); say('      ' + epi(x)) }

  say('')
  say('===== 三、卖出规则：偏离MA5×位置 扫描 =====')
  const SELL = []
  for (const [pLab, pFn] of [['位置>0.65', r => r.pos250i > 0.65], ['位置>0.6', r => r.pos250i > 0.6], ['位置>0.7', r => r.pos250i > 0.7]])
    for (const [dLab, dFn] of [['偏离>3%', r => r.overMa5 > 0.03], ['偏离>5%', r => r.overMa5 > 0.05], ['偏离>7%', r => r.overMa5 > 0.07]])
      SELL.push([pLab + ' + ' + dLab, r => pFn(r) && dFn(r)])
  SELL.push(['位置>0.65 + 偏离>5% + 多头排列 + 连续≥2日', r => r.pos250i > 0.65 && r.overMa5 > 0.05 && r.align && r.streak >= 2])
  SELL.push(['位置>0.7 + 偏离>5% + 多头排列 + 连续≥2日', r => r.pos250i > 0.7 && r.overMa5 > 0.05 && r.align && r.streak >= 2])
  for (const [l, fn] of SELL) { const x = rows.filter(fn); say(line('  ' + l, x)); say('      ' + epi(x)) }

  say('')
  say('===== 四、逐只总信号频次（候选最终规则）=====')
  const BUYF = r => r.pos250i < 0.4 && r.main4w > 0.002 && r.supDist < 0.15
  const BUYH = r => r.pos250i < 0.4 && r.main4w > 0.004 && r.ret60 < 0.15 && isFinite(r.wma20) && r.wma5 > r.wma20 && r.premLow < 0.30 && r.supDist < 0.15
  const SELLF = r => r.pos250i > 0.65 && r.overMa5 > 0.05
  const SELLS = r => r.pos250i > 0.65 && r.overMa5 > 0.05 && r.align && r.streak >= 2
  const segCount = (rs, fn) => {
    const by = {}; rs.filter(fn).forEach(r => (by[r.code] = by[r.code] || []).push(r))
    let e = 0
    for (const c of Object.keys(by)) { const a = by[c].sort((x, y) => x.date < y.date ? -1 : 1)
      for (let i = 0; i < a.length; i++) if (i === 0 || (rows.indexOf(a[i]) - rows.indexOf(a[i - 1]) !== 1)) e++ }
    return e
  }
  say('	股票	           建仓区(右侧/强) 低位关注(左侧)  减仓-强  减仓-标准   合计')
  let T = [0, 0, 0, 0]
  for (const code of codes) {
    const rs = rows.filter(r => r.code === code)
    const a = segCount(rs, BUYH), b = segCount(rs, BUYF), c = segCount(rs, SELLS), d = segCount(rs, SELLF)
    T = [T[0] + a, T[1] + b, T[2] + c, T[3] + d]
    say('	' + (NAMES[code] + '(' + code + ')').padEnd(18) + String(a).padEnd(15) + String(b).padEnd(15) + String(c).padEnd(8) + String(d).padEnd(11) + (a + b + c + d))
  }
  say('	合计段数          ' + String(T[0]).padEnd(15) + String(T[1]).padEnd(15) + String(T[2]).padEnd(8) + String(T[3]).padEnd(11) + T.reduce((s, x) => s + x, 0))
  say('	每只每年(次)      ' + (T[0] / codes.length / years).toFixed(2).padEnd(15) + (T[1] / codes.length / years).toFixed(2).padEnd(15) +
    (T[2] / codes.length / years).toFixed(2).padEnd(8) + (T[3] / codes.length / years).toFixed(2).padEnd(11) +
    (T.reduce((s, x) => s + x, 0) / codes.length / years).toFixed(2))

  const ALLB = rows.filter(r => BUYF(r) || BUYH(r))
  const ALLS = rows.filter(r => SELLF(r) || SELLS(r))
  say('')
  say('买入侧合并（建仓区 ∪ 低位关注）：' + line('', ALLB)); say('   ' + epi(ALLB))
  say('卖出侧合并（减仓-强 ∪ 减仓-标准）：' + line('', ALLS)); say('   ' + epi(ALLS))

  fs.writeFileSync(__dirname + '/s1-redesign2-report.md', out.join('\n'), 'utf8')
  console.log('\n→ 已写 _tests/s1-redesign2-report.md')
  process.exit(0)
})().catch(e => { console.log('❌ ' + (e && e.message || e)); process.exit(1) })
