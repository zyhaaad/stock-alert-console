/* S1 漏斗诊断（2026-09-20）
 *
 * 用户批评：中长线波段要的是「底部抄底 + 高位卖出」，不能一年都不触发信号，那等于死拿。
 * 本脚本不设计新规则，只回答一个问题：**信号为什么这么少 / 卖点为什么几乎不出？**
 *
 * 做法：
 *   ① 把现有每个条件单独命中率、以及 AND 链逐级收窄的漏斗量出来 —— 找出"卡死"的那一条；
 *   ② 按「每只每年触发几次」而不是"总样本量"来评估覆盖度（波段用户的真实口径）；
 *   ③ 卖点候选逐一比较（现有派发完毕 vs 阶段顶部 vs 周级压力 vs 周线破位）。
 *
 * 用法：node _tests/s1-funnel.js
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
const w = dom.window
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
        volRatio, main4w, wma5, wma20, align, streak, overMa5,
        fwd20: C[i + 20] / C[i] - 1, fwd60: C[i + 60] / C[i] - 1 })
    }
  }
  return rows
}

/* 现有条件（= 线上 weekStage 的建仓区） */
const C_MAIN = r => r.main4w > 0.004
const C_POS = r => r.pos250i < 0.4
const C_RET = r => r.ret60 < 0.15
const C_WMA = r => isFinite(r.wma20) && r.wma5 > r.wma20
const C_PREM = r => r.premLow < 0.30
const C_SUP = r => r.supDist < 0.15

;(async () => {
  await new Promise(r => setTimeout(r, 400))
  const rows = build()
  const days = [...new Set(rows.map(r => r.date))].length
  const years = days / 244
  const out = []
  const say = s => { out.push(s); console.log(s) }
  const line = (label, l) => {
    const seg = ['2025H1', '2025H2', '2026H1'].map((lab, k) => {
      const a = ['2025-01-01', '2025-07-01', '2026-01-01'][k], b = ['2025-06-30', '2025-12-31', '2026-06-30'][k]
      return fR(mean(l.filter(r => r.date >= a && r.date <= b).map(r => r.fwd60))).padEnd(10)
    })
    return label.padEnd(46) + 'n=' + String(l.length).padEnd(6) + '占比 ' + fP(pct(l.length, rows.length)).padEnd(8) +
      '20日 ' + fR(mean(l.map(r => r.fwd20))).padEnd(9) + '60日 ' + fR(mean(l.map(r => r.fwd60))).padEnd(9) +
      '跌超5% ' + fP(pct(l.filter(r => r.fwd60 <= DROP).length, l.length)).padEnd(8) + seg.join('')
  }
  const epi = l => {  /* 按"段"数（不是天数）折算每只每年触发次数 */
    const by = {}
    l.forEach(r => (by[r.code] = by[r.code] || []).push(r))
    let e = 0
    for (const c of Object.keys(by)) {
      const rs = by[c].sort((a, b) => a.date < b.date ? -1 : 1)
      for (let i = 0; i < rs.length; i++) if (i === 0 || rows.findIndex(x => x === rs[i]) - rows.findIndex(x => x === rs[i - 1]) !== 1) e++
    }
    return '段数 ' + e + '｜每只每年 ' + (e / codes.length / years).toFixed(2) + ' 次'
  }

  say('样本：' + codes.length + ' 只 × ' + rows.length + ' 点｜覆盖 ' + days + ' 个交易日 ≈ ' + years.toFixed(2) + ' 年')
  say('基准：20日 ' + fR(mean(rows.map(r => r.fwd20))) + '，60日 ' + fR(mean(rows.map(r => r.fwd60))) +
    '，跌超5% ' + fP(pct(rows.filter(r => r.fwd60 <= DROP).length, rows.length)))
  say('⚠️ 覆盖度用「段数 / 只 / 年」衡量（波段用户的真实口径），不只看总样本量')

  say('')
  say('===== 一、买入侧漏斗：每个条件单独命中率 =====')
  for (const [lab, fn] of [['资金 main4w > 0.4%', C_MAIN], ['位置 pos250 < 0.4', C_POS],
    ['60日涨跌 < +15%', C_RET], ['周线多头 wMA5>wMA20', C_WMA],
    ['距一年最低 < 30%', C_PREM], ['距20周最低 < 15%', C_SUP]]) {
    const l = rows.filter(fn)
    say(line('  ' + lab, l))
  }

  say('')
  say('===== 二、AND 链逐级收窄（按"从宽到严"的顺序加，看哪一步把样本打没了）=====')
  let cur = rows
  say(line('  起点（全部）', cur))
  for (const [lab, fn] of [['+ 60日涨跌<15%', C_RET], ['+ 距20周最低<15%', C_SUP], ['+ 距一年最低<30%', C_PREM],
    ['+ 位置 pos250<0.4', C_POS], ['+ 周线多头', C_WMA], ['+ 资金>0.4%', C_MAIN]]) {
    cur = cur.filter(fn)
    say(line('  ' + lab, cur) + '　' + epi(cur))
  }

  say('')
  say('===== 三、逐只：建仓区为什么出不来（各条件满足天数 / 该股样本天数）=====')
  say('	股票	  样本天  资金	  位置	  距20周支撑  周线多头  最终建仓区')
  const byCode = {}
  rows.forEach(r => (byCode[r.code] = byCode[r.code] || []).push(r))
  for (const code of codes) {
    const l = byCode[code] || []
    if (!l.length) continue
    const f = fn => l.filter(fn).length
    say('	' + (NAMES[code] + '(' + code + ')').padEnd(18) + String(l.length).padEnd(8) +
      String(f(C_MAIN)).padEnd(8) + String(f(C_POS)).padEnd(8) + String(f(C_SUP)).padEnd(12) +
      String(f(C_WMA)).padEnd(10) + String(l.filter(r => C_MAIN(r) && C_POS(r) && C_RET(r) && C_WMA(r) && C_PREM(r) && C_SUP(r)).length))
  }

  say('')
  say('===== 四、卖出侧：现有卖点 vs 候选卖点（用户要的「高位卖出」）=====')
  const sells = {
    '现有 派发完毕': r => r.pos250i > 0.65 && r.ret60 > 0.20 && (r.volRatio < 1.0 || r.main4w < 0),
    '候选 a 高位 + 周级压力遇阻(距压力>-3%)': r => r.pos250i > 0.65 && r.resDist > -0.03,
    '候选 b 高位(>0.65) + 阶段顶部(多头排列+连续≥2日站上MA5)': r => r.pos250i > 0.65 && r.align && r.streak >= 2,
    '候选 c 高位 + 偏离MA5>5%': r => r.pos250i > 0.65 && r.overMa5 > 0.05,
    '候选 d 高位 + 偏离MA5>5% + 连续≥2日站上MA5': r => r.pos250i > 0.65 && r.overMa5 > 0.05 && r.align && r.streak >= 2,
    '候选 e 高位 + 资金转负(main4w<0)': r => r.pos250i > 0.65 && r.main4w < 0,
    '候选 f 高位 + 周线转空(wMA5<=wMA20)': r => r.pos250i > 0.65 && isFinite(r.wma20) && r.wma5 <= r.wma20,
    '候选 g 高位 + 缩量(volRatio<0.8)': r => r.pos250i > 0.65 && r.volRatio < 0.8,
    '候选 h 候选b 或 候选e（并集，覆盖优先）': r => (r.pos250i > 0.65 && r.align && r.streak >= 2) || (r.pos250i > 0.65 && r.main4w < 0)
  }
  for (const [lab, fn] of Object.entries(sells)) {
    const l = rows.filter(fn)
    say(line('  ' + lab, l) + '　' + epi(l))
  }

  say('')
  say('===== 五、抄底侧「宽松版」候选（位置够低 + 资金进场，去掉其他条件）=====')
  const buys = {
    '现有 建仓区（6 条 AND）': r => C_MAIN(r) && C_POS(r) && C_RET(r) && C_WMA(r) && C_PREM(r) && C_SUP(r),
    '松 1 资金 + 位置<0.4（去掉周线/涨幅/两道闸门）': r => C_MAIN(r) && C_POS(r),
    '松 2 资金 + 距20周支撑<15%': r => C_MAIN(r) && C_SUP(r),
    '松 3 资金 + 位置<0.4 + 周线多头': r => C_MAIN(r) && C_POS(r) && C_WMA(r),
    '松 4 资金 + 距20周支撑<15% + 周线多头': r => C_MAIN(r) && C_SUP(r) && C_WMA(r),
    '松 5 资金 + 位置<0.5 + 距20周支撑<25%': r => C_MAIN(r) && r.pos250i < 0.5 && r.supDist < 0.25,
    '松 6 资金>1% + 距20周支撑<25%': r => r.main4w > 0.01 && r.supDist < 0.25
  }
  for (const [lab, fn] of Object.entries(buys)) {
    const l = rows.filter(fn)
    say(line('  ' + lab, l) + '　' + epi(l))
  }

  fs.writeFileSync(__dirname + '/s1-funnel-report.md', out.join('\n'), 'utf8')
  console.log('\n→ 已写 _tests/s1-funnel-report.md')
  process.exit(0)
})().catch(e => { console.log('❌ ' + (e && e.message || e)); process.exit(1) })
