/* S1 重构候选回测（2026-09-20）——目标：**底部抄底 + 高位卖出**，且要有足够的可操作频次
 *
 * 由 _tests/s1-funnel.js 的诊断得出两个结构性问题：
 *   ① 买入侧瓶颈 = 「位置低」与「周线多头」天然互斥（持续上涨的股票位置从不低；持续下跌的股票周线从不多头），
 *      只有"刚见底反转"那几周同时成立 → 每只每年仅 0.87 次。
 *      ⇒ 需要补**左侧潜伏态**：位置低 + 资金进 + 周线**还没转多**（提前埋伏）。
 *   ② 卖出侧几乎全废：高位+资金转负/缩量/周线转空 三个直觉信号 60 日后竟然都是**上涨**（+2.96%~+5.28%）。
 *      只有「高位 + 短期过热（偏离 MA5）」有效。
 *      ⇒ 卖出侧只能做成「过热减仓 + 压力位警戒」的梯队，不能假装有"中期见顶清仓"。
 * 另测：资金阈值用**该股自己的历史分位**（而非绝对值 0.4%）能否让覆盖度更均衡。
 *
 * 用法：node _tests/s1-redesign.js
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
    const mine = []   /* 本股票已计算的 main4w 序列，用于算"自己的历史分位" */
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
      /* 资金强度的"自身历史分位"（近 250 个样本内） */
      mine.push(main4w)
      const win = mine.slice(-250).filter(isFinite).sort((a, b) => a - b)
      let fRank = NaN
      if (win.length >= 60 && isFinite(main4w)) {
        let lo = 0, hi = win.length
        while (lo < hi) { const m = (lo + hi) >> 1; if (win[m] < main4w) lo = m + 1; else hi = m }
        fRank = lo / win.length
      }
      /* 近 60 日内是否曾处高位（用于"见顶后破位"的卖出测试） */
      rows.push({ code, date, close: C[i], ret20, ret60, pos250i, premLow, supDist, resDist,
        volRatio, main4w, fRank, wma5, wma20, align, streak, overMa5, high60: NaN,
        fwd20: C[i + 20] / C[i] - 1, fwd60: C[i + 60] / C[i] - 1 })
    }
    /* 回填 high60：本股票样本序列里过去 60 个样本点的最高 pos250 */
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
      for (let i = 0; i < rs.length; i++) if (i === 0 || rs[i].date !== null && (!rs[i - 1] || rows.indexOf(rs[i]) - rows.indexOf(rs[i - 1]) !== 1)) e++
    }
    const cov = codes.filter(c => (by[c] || []).length > 0).length
    return '段 ' + e + '｜每只每年 ' + (e / codes.length / years).toFixed(2) + ' 次｜有信号的股票 ' + cov + '/' + codes.length
  }
  const line = (label, l) => {
    const seg = [['2025H1', '2025-01-01', '2025-06-30'], ['2025H2', '2025-07-01', '2025-12-31'], ['2026H1', '2026-01-01', '2026-06-30']]
      .map(([, a, b]) => fR(mean(l.filter(r => r.date >= a && r.date <= b).map(r => r.fwd60))).padEnd(10))
    return label.padEnd(52) + 'n=' + String(l.length).padEnd(6) + '20日 ' + fR(mean(l.map(r => r.fwd20))).padEnd(9) +
      '60日 ' + fR(mean(l.map(r => r.fwd60))).padEnd(9) + '跌超5% ' + fP(pct(l.filter(r => r.fwd60 <= DROP).length, l.length)).padEnd(8) + seg.join('')
  }

  say('样本：' + codes.length + ' 只 × ' + rows.length + ' 点 ≈ ' + years.toFixed(2) + ' 年｜基准 20日 ' +
    fR(mean(rows.map(r => r.fwd20))) + '，60日 ' + fR(mean(rows.map(r => r.fwd60))) + '，跌超5% ' +
    fP(pct(rows.filter(r => r.fwd60 <= DROP).length, rows.length)))
  say('目标：每个动作「每只每年 ≥ 2 次」且方向明确（买：60日显著>基准；卖：60日显著<基准）')

  say('')
  say('===== 一、买入侧：现有（右侧确认）vs 新增（左侧潜伏）=====')
  const B = {
    '现有 右侧确认·建仓区': r => r.main4w > 0.004 && r.pos250i < 0.4 && r.ret60 < 0.15 &&
      isFinite(r.wma20) && r.wma5 > r.wma20 && r.premLow < 0.30 && r.supDist < 0.15,
    '★新 左侧潜伏-1：资金>0.4% + 位置<0.4 + 周线仍空 + 距20周支撑<15%': r => r.main4w > 0.004 && r.pos250i < 0.4 &&
      isFinite(r.wma20) && r.wma5 <= r.wma20 && r.supDist < 0.15,
    '★新 左侧潜伏-2：＋60日涨跌<15%（不许追高）': r => r.main4w > 0.004 && r.pos250i < 0.4 &&
      isFinite(r.wma20) && r.wma5 <= r.wma20 && r.supDist < 0.15 && r.ret60 < 0.15,
    '★新 左侧潜伏-3：资金自身分位>0.7 + 位置<0.4 + 周线空 + 支撑<15%': r => r.fRank > 0.7 && r.pos250i < 0.4 &&
      isFinite(r.wma20) && r.wma5 <= r.wma20 && r.supDist < 0.15,
    '★新 左侧潜伏-4：资金自身分位>0.7 + 位置<0.4 + 周线空 + 支撑<20%': r => r.fRank > 0.7 && r.pos250i < 0.4 &&
      isFinite(r.wma20) && r.wma5 <= r.wma20 && r.supDist < 0.20,
    '对照 资金>0.4% + 位置<0.4（不管周线方向）': r => r.main4w > 0.004 && r.pos250i < 0.4,
    '对照 资金>0.4% + 位置<0.4 + 周线多（不管位置闸门）': r => r.main4w > 0.004 && r.pos250i < 0.4 &&
      isFinite(r.wma20) && r.wma5 > r.wma20
  }
  for (const [lab, fn] of Object.entries(B)) { const l = rows.filter(fn); say(line('  ' + lab, l)); say('      ' + epi(l)) }

  say('')
  say('===== 二、卖出侧梯队（用户要的「高位卖出」）=====')
  const S = {
    '现有 派发完毕': r => r.pos250i > 0.65 && r.ret60 > 0.20 && (r.volRatio < 1.0 || r.main4w < 0),
    '★新 减仓-强：高位 + 偏离MA5>5% + 多头排列 + 连续≥2日': r => r.pos250i > 0.65 && r.overMa5 > 0.05 && r.align && r.streak >= 2,
    '★新 减仓-标准：高位 + 偏离MA5>5%': r => r.pos250i > 0.65 && r.overMa5 > 0.05,
    '★新 减仓-宽：位置>0.6 + 偏离MA5>3%': r => r.pos250i > 0.60 && r.overMa5 > 0.03,
    '★新 警戒压力：高位 + 距周级压力>-5%': r => r.pos250i > 0.65 && r.resDist > -0.05,
    '★新 见顶破位（曾高位 high60>0.8 + 现周线空）': r => r.high60 > 0.80 && isFinite(r.wma20) && r.wma5 <= r.wma20,
    '★新 见顶破位（曾高位>0.8 + 现周线空 + 距压力<-15%）': r => r.high60 > 0.80 && isFinite(r.wma20) && r.wma5 <= r.wma20 && r.resDist < -0.15,
    '对照 仅高位（pos>0.65）': r => r.pos250i > 0.65
  }
  for (const [lab, fn] of Object.entries(S)) { const l = rows.filter(fn); say(line('  ' + lab, l)); say('      ' + epi(l)) }

  say('')
  say('===== 三、买入侧覆盖度逐只（新增左侧潜伏-2 vs 现有右侧确认）=====')
  const L2 = rows.filter(B['★新 左侧潜伏-2：＋60日涨跌<15%（不许追高）'])
  const R1 = rows.filter(B['现有 右侧确认·建仓区'])
  say('	股票	  现有右侧(天)  新增左侧(天)  合计可操作天')
  for (const code of codes) {
    const a = R1.filter(r => r.code === code).length, b = L2.filter(r => r.code === code).length
    say('	' + (NAMES[code] + '(' + code + ')').padEnd(18) + String(a).padEnd(13) + String(b).padEnd(13) + (a + b))
  }
  const covAll = codes.filter(c => R1.some(r => r.code === c) || L2.some(r => r.code === c)).length
  say('	→ 至少有一个买点的股票：' + covAll + '/' + codes.length +
    '（原来只有 ' + codes.filter(c => R1.some(r => r.code === c)).length + '/' + codes.length + '）')

  fs.writeFileSync(__dirname + '/s1-redesign-report.md', out.join('\n'), 'utf8')
  console.log('\n→ 已写 _tests/s1-redesign-report.md')
  process.exit(0)
})().catch(e => { console.log('❌ ' + (e && e.message || e)); process.exit(1) })
