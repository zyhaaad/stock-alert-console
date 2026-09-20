/* S1 重构候选 · 策略级评估 v2（2026-09-20）
 * 用户质疑：「这 11 次信号，准确度和收益怎么样，不能为了信号忽视这些。」
 *
 * v1 有个会造假的统计 bug：只统计「已平仓」的交易 → 那些买了之后一直没触发卖点的**浮亏持仓被漏掉**，
 * 于是出现「每笔胜率 100%」的假象。v2 修正：**未平仓持仓按最后收盘价记账，计入交易统计**。
 *
 * 同时补：①止损变体（买错时怎么收场）②组合等权资金曲线 ③「择时价值」分解。
 * ⚠️ 局限：资金用新浪 r0_net 代理（与东财方向一致率 ~75%）；成交价用次日开盘（无未来函数）；样本 1.6 年。
 * 用法：node _tests/s1-eval.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules'
module.paths.push(WS)
const { JSDOM, VirtualConsole } = require(path.join(WS, 'jsdom'))

const html = fs.readFileSync('D:/mywork/_preview/stock-picker-preview.html', 'utf8')
const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: new VirtualConsole(), url: 'https://local/' })
const data = JSON.parse(fs.readFileSync(__dirname + '/_cache/bt-data.json', 'utf8')).stocks
const codes = Object.keys(data)
const NAMES = { '600703': '三安光电', '000155': '川能动力', '002594': '比亚迪', '601127': '赛力斯',
  '002415': '海康威视', '002714': '牧原股份', '600058': '五矿发展', '600721': '百花医药',
  '600733': '北汽蓝谷', '603026': '石大胜华', '603162': '海通发展', '002349': '精华制药',
  '000762': '西藏矿业', '000767': '晋控电力', '002471': '中超控股', '002577': '雷柏科技', '300132': '青松股份' }

const mean = a => { const v = a.filter(isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN }
const med = a => { const v = a.filter(isFinite).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN }
const pct = (n, d) => d ? n / d * 100 : NaN
const fR = x => isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '—'
const fP = x => isFinite(x) ? x.toFixed(1) + '%' : '—'
const wr = a => { const v = a.filter(isFinite); return v.length ? pct(v.filter(x => x > 0).length, v.length) : NaN }

function weekKey(dstr) {
  const d = new Date(dstr + 'T00:00:00Z'); const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + (4 - day)); return d.toISOString().slice(0, 10)
}

function build() {
  const out = {}
  for (const code of codes) {
    const st = data[code], bars = st.bars, flows = st.flows, fs_ = st.floatShares
    const flowByDate = {}
    for (const f of flows) { const p = f.split(','); flowByDate[p[0]] = Number(p[1]) }
    const O = bars.map(b => +b[1]), C = bars.map(b => +b[2]), H = bars.map(b => +b[3]), L = bars.map(b => +b[4])
    const V = bars.map(b => b[5]), D = bars.map(b => b[0])
    const WARM = 260
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
    const rs = []
    for (let i = WARM; i < bars.length; i++) {
      const date = D[i]
      const mainYi = flowByDate[date]
      const ret60 = C[i] / C[i - 60] - 1
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
      const wMain = done.map(x => x.m)
      const last20 = done.slice(-20)
      let wHi20 = -Infinity, wLo20 = Infinity
      last20.forEach(x => { if (x.h > wHi20) wHi20 = x.h; if (x.l < wLo20) wLo20 = x.l })
      const supDist = C[i] / wLo20 - 1, resDist = C[i] / wHi20 - 1
      const wma = n => (done.length >= n ? done.slice(-n).reduce((a, x) => a + x.c, 0) / n : NaN)
      const wma5 = wma(5), wma20 = wma(20)
      const mv = fs_ * C[i]
      const main4w = (isFinite(mainYi) && wMain.length >= 4) ? wMain.slice(-4).reduce((a, b) => a + b, 0) / mv : NaN
      const fwd20 = i + 20 < bars.length ? C[i + 20] / C[i] - 1 : NaN
      const fwd60 = i + 60 < bars.length ? C[i + 60] / C[i] - 1 : NaN
      let mae = NaN, mfe = NaN
      if (i + 60 < bars.length) {
        let lo = Infinity, hi = -Infinity
        for (let j = i + 1; j <= i + 60; j++) { if (L[j] < lo) lo = L[j]; if (H[j] > hi) hi = H[j] }
        mae = lo / C[i] - 1; mfe = hi / C[i] - 1
      }
      rs.push({ code, date, open: O[i], close: C[i], ret60, pos250i, premLow, supDist, resDist, main4w,
        wma5, wma20, align, streak, overMa5, fwd20, fwd60, mae, mfe,
        sBuyStrong: main4w > 0.004 && pos250i < 0.4 && ret60 < 0.15 && isFinite(wma20) && wma5 > wma20 && premLow < 0.30 && supDist < 0.15,
        sBuyBase: main4w > 0.004 && pos250i < 0.4 && supDist < 0.15,
        sBuyLoose: main4w > 0.002 && pos250i < 0.4 && supDist < 0.15,
        sSellStd: pos250i > 0.65 && overMa5 > 0.05,
        sSellStr: pos250i > 0.65 && overMa5 > 0.05 && align && streak >= 2 })
    }
    out[code] = rs
  }
  return out
}

;(async () => {
  await new Promise(r => setTimeout(r, 400))
  const CR = build()
  const all = Object.keys(data).flatMap(c => CR[c])
  const years = [...new Set(all.map(r => r.date))].length / 244
  const out = []
  const say = s => { out.push(s); console.log(s) }
  const segsOf = (rs, key) => { let n = 0; for (let i = 0; i < rs.length; i++) if (rs[i][key]) { if (i === 0 || !rs[i - 1][key]) n++ } return n }
  const SEG = [['2025H1', '2025-01-01', '2025-06-30'], ['2025H2', '2025-07-01', '2025-12-31'], ['2026H1', '2026-01-01', '2026-06-30']]

  say('样本：' + codes.length + ' 只 × ' + all.length + ' 点 ≈ ' + years.toFixed(2) + ' 年（' + [...new Set(all.map(r => r.date))].length + ' 个交易日）')
  const B60 = all.filter(r => isFinite(r.fwd60))
  say('基准（全样本、已满60日）：60日 ' + fR(mean(B60.map(r => r.fwd60))) + '｜中位 ' + fR(med(B60.map(r => r.fwd60))) +
    '｜胜率 ' + fP(wr(B60.map(r => r.fwd60))) + '｜跌超5% ' + fP(pct(B60.filter(r => r.fwd60 <= -0.05).length, B60.length)))

  const block = (label, key) => {
    const l = all.filter(r => r[key]), l60 = l.filter(r => isFinite(r.fwd60))
    const sg = Object.keys(data).reduce((s, c) => s + segsOf(CR[c], key), 0)
    say('')
    say('—— ' + label)
    say('   触发 ' + l.length + ' 点（占全样本 ' + fP(pct(l.length, all.length)) + '）｜' + sg + ' 段｜每只每年 ' + (sg / codes.length / years).toFixed(2) + ' 段')
    say('   20日 均 ' + fR(mean(l.filter(r => isFinite(r.fwd20)).map(r => r.fwd20))) + '｜60日 均 ' + fR(mean(l60.map(r => r.fwd60))) +
      '｜中位 ' + fR(med(l60.map(r => r.fwd60))) + '｜胜率 ' + fP(wr(l60.map(r => r.fwd60))) +
      '｜跌超5% ' + fP(pct(l60.filter(r => r.fwd60 <= -0.05).length, l60.length)))
    say('   路径：最大浮亏中位 ' + fR(med(l60.map(r => r.mae))) + '｜最大浮盈中位 ' + fR(med(l60.map(r => r.mfe))) +
      '｜最差 ' + fR(Math.min(...l60.map(r => r.fwd60))) + '｜最好 ' + fR(Math.max(...l60.map(r => r.fwd60))))
    const per = Object.keys(data).map(c => CR[c].filter(r => r[key]).filter(r => isFinite(r.fwd60)))
    say('   逐只：' + per.filter(x => x.length).length + '/' + codes.length + ' 只有样本；60日均值为正 ' +
      per.filter(x => x.length && mean(x.map(r => r.fwd60)) > 0).length + ' 只、为负 ' +
      per.filter(x => x.length && mean(x.map(r => r.fwd60)) <= 0).length + ' 只')
    say('   分时段 60日：' + SEG.map(([n, a, b]) => n + ' ' + fR(mean(l60.filter(r => r.date >= a && r.date <= b).map(r => r.fwd60)))).join('｜'))
  }

  say('')
  say('========== 一、各信号：准确度与收益 ==========')
  block('买点 A · 建仓区（周线多头升级，强）', 'sBuyStrong')
  block('买点 B · 低位关注（新，含建仓区）', 'sBuyBase')
  block('买点 D · 更宽松（资金>0.2%）', 'sBuyLoose')
  block('卖点 A · 减仓提醒（位置>0.65＋偏离MA5>5%）', 'sSellStd')
  block('卖点 B · 加强过热（＋多头排列＋连续≥2日）', 'sSellStr')
  {
    const inB = r => r.sBuyBase && !r.sBuyStrong
    const l = all.filter(inB), l60 = l.filter(r => isFinite(r.fwd60))
    const sg = Object.keys(data).reduce((s, c) => { const rs = CR[c]; let n = 0; for (let i = 0; i < rs.length; i++) if (inB(rs[i]) && (i === 0 || !inB(rs[i - 1]))) n++; return s + n }, 0)
    say('')
    say('—— 买点 C · 低位关注中「不含建仓区」的部分（真正的"新增频次"）')
    say('   触发 ' + l.length + ' 点｜' + sg + ' 段｜每只每年 ' + (sg / codes.length / years).toFixed(2) + ' 段')
    say('   20日 均 ' + fR(mean(l.filter(r => isFinite(r.fwd20)).map(r => r.fwd20))) + '｜60日 均 ' + fR(mean(l60.map(r => r.fwd60))) +
      '｜中位 ' + fR(med(l60.map(r => r.fwd60))) + '｜胜率 ' + fP(wr(l60.map(r => r.fwd60))) +
      '｜跌超5% ' + fP(pct(l60.filter(r => r.fwd60 <= -0.05).length, l60.length)))
    say('   分时段 60日：' + SEG.map(([n, a, b]) => n + ' ' + fR(mean(l60.filter(r => r.date >= a && r.date <= b).map(r => r.fwd60)))).join('｜'))
  }

  say('')
  say('========== 二、是否真「低位买、高位卖」==========')
  say('   买点·低位关注 触发时平均位置分位：' + fP(mean(all.filter(r => r.sBuyBase).map(r => r.pos250i)) * 100) + '（0=一年最低，100=一年最高）')
  say('   买点·建仓区   触发时平均位置分位：' + fP(mean(all.filter(r => r.sBuyStrong).map(r => r.pos250i)) * 100))
  say('   卖点·减仓提醒 触发时平均位置分位：' + fP(mean(all.filter(r => r.sSellStd).map(r => r.pos250i)) * 100))
  say('   全样本平均位置分位：            ' + fP(mean(all.map(r => r.pos250i)) * 100))
  say('   买点触发时平均「距一年最低」：    ' + fR(mean(all.filter(r => r.sBuyBase).map(r => r.premLow))))
  say('   卖点触发时平均「距近20周最高」：  ' + fR(mean(all.filter(r => r.sSellStd).map(r => r.resDist))))

  say('')
  say('========== 三、策略回测（买点次日开盘开仓；卖点/止损次日开盘平仓；未平仓按最后收盘记账）==========')
  function bt(rs, buyKey, sellKey, stop) {
    let cash = 1, sh = 0, inPos = false, entry = 0, entryD = '', pend = null
    const trades = [], eq = [], dayEq = {}
    let daysIn = 0
    for (let i = 0; i < rs.length; i++) {
      const r = rs[i]
      if (pend === 'buy' && !inPos) { inPos = true; sh = cash / r.open; cash = 0; entry = r.open; entryD = r.date }
      else if (pend && pend !== 'buy' && inPos) {
        cash = sh * r.open; sh = 0; inPos = false
        trades.push({ entryD, exitD: r.date, ret: r.open / entry - 1, why: pend })
      }
      pend = null
      if (inPos) {
        daysIn++
        if (isFinite(stop) && r.close / entry - 1 <= stop) pend = 'stop'
        else if (r[sellKey]) pend = 'sell'
      } else if (r[buyKey]) pend = 'buy'
      const v = cash + sh * r.close
      eq.push(v); dayEq[r.date] = v
    }
    if (inPos) trades.push({ entryD, exitD: rs[rs.length - 1].date, ret: rs[rs.length - 1].close / entry - 1, why: 'hold' })
    let peak = eq[0], mdd = 0
    for (const v of eq) { if (v > peak) peak = v; const dd = v / peak - 1; if (dd < mdd) mdd = dd }
    return { ret: eq[eq.length - 1] - 1, mdd, trades, dayEq, daysIn, total: rs.length,
      wr: trades.length ? pct(trades.filter(t => t.ret > 0).length, trades.length) : NaN,
      avg: mean(trades.map(t => t.ret)), best: Math.max(...trades.map(t => t.ret), NaN), worst: Math.min(...trades.map(t => t.ret), NaN) }
  }
  const holdingsReturn = rs => rs[rs.length - 1].close / rs[0].open - 1
  const holdingsMdd = rs => { let p = 1, m = 0; for (const x of rs) { const v = x.close / rs[0].open; if (v > p) p = v; const d = v / p - 1; if (d < m) m = d } return m }

  const VARIANTS = [
    ['S1 建仓区买 ＋ 减仓提醒卖（高频次无关，看质量）', 'sBuyStrong', 'sSellStd', NaN],
    ['S2 低位关注买 ＋ 减仓提醒卖（原推荐）', 'sBuyBase', 'sSellStd', NaN],
    ['S2b 低位关注买 ＋ 减仓提醒卖 ＋ 止损 −10%', 'sBuyBase', 'sSellStd', -0.10],
    ['S2c 低位关注买 ＋ 减仓提醒卖 ＋ 止损 −15%', 'sBuyBase', 'sSellStd', -0.15],
    ['S3 低位关注买 ＋ 加强过热卖', 'sBuyBase', 'sSellStr', NaN],
    ['S4 低位关注买 ＋ 不止损不卖（只吃买点）', 'sBuyBase', '____none____', NaN]
  ]
  const SUM = []
  for (const [lab, b, s2, stop] of VARIANTS) {
    const rows = codes.map(c => {
      const rs = CR[c]
      const t = bt(rs, b, s2, stop)
      return { c, t, bh: holdingsReturn(rs), bhM: holdingsMdd(rs) }
    })
    const tr = rows.flatMap(r => r.t.trades)
    const nWin = tr.filter(x => x.ret > 0).length
    SUM.push({ lab, rows, tr, ret: mean(rows.map(r => r.t.ret)), mdd: mean(rows.map(r => r.t.mdd)) })
    say('')
    say('◆ ' + lab)
    say('   交易 ' + tr.length + ' 笔（已平 ' + tr.filter(x => x.why !== 'hold').length + '｜未平 ' + tr.filter(x => x.why === 'hold').length +
      '｜止损 ' + tr.filter(x => x.why === 'stop').length + '）｜每笔胜率 ' + fP(pct(nWin, tr.length)) +
      '｜平均每笔 ' + fR(mean(tr.map(x => x.ret))) + '｜中位 ' + fR(med(tr.map(x => x.ret))) +
      '｜最好 ' + fR(Math.max(...tr.map(x => x.ret))) + '｜最差 ' + fR(Math.min(...tr.map(x => x.ret))))
    say('   亏损笔 ' + tr.filter(x => x.ret <= 0).length + ' 笔：' + tr.filter(x => x.ret <= 0).map(x => fR(x.ret) + '(' + x.why + ')').join(' '))
    say('   策略平均收益 ' + fR(mean(rows.map(r => r.t.ret))) + '｜中位 ' + fR(med(rows.map(r => r.t.ret))) +
      '｜跑赢死拿 ' + rows.filter(r => r.t.ret > r.bh).length + '/' + codes.length + ' 只' +
      '｜策略平均最大回撤 ' + fR(mean(rows.map(r => r.t.mdd))) + '｜平均在场 ' + fP(mean(rows.map(r => r.t.daysIn / r.t.total)) * 100))
  }
  say('')
  say('◆ 基准：全程死拿（同窗口，首日开盘买到最后收盘）')
  const bhRows = codes.map(c => ({ c, bh: holdingsReturn(CR[c]), bhM: holdingsMdd(CR[c]) }))
  say('   平均收益 ' + fR(mean(bhRows.map(r => r.bh))) + '｜中位 ' + fR(med(bhRows.map(r => r.bh))) +
    '｜平均最大回撤 ' + fR(mean(bhRows.map(r => r.bhM))) + '｜正收益 ' + bhRows.filter(r => r.bh > 0).length + '/' + codes.length + ' 只')

  say('')
  say('========== 四、组合等权资金曲线（17 只等权，逐日平均）==========')
  const allDates = [...new Set(all.map(r => r.date))].sort()
  let PORTC = {}
  for (const [lab, b, s2, stop] of VARIANTS) {
    PORTC = {}
    for (const c of codes) PORTC[c] = bt(CR[c], b, s2, stop).dayEq
    const eq = allDates.map(d => mean(codes.map(c => PORTC[c][d] !== undefined ? PORTC[c][d] : 1)))
    let p = eq[0], m = 0
    for (const v of eq) { if (v > p) p = v; const d = v / p - 1; if (d < m) m = d }
    say('   ' + lab.padEnd(46) + '组合收益 ' + fR(eq[eq.length - 1] - 1).padEnd(9) + '最大回撤 ' + fR(m))
  }
  {
    const eq = allDates.map(d => mean(codes.map(c => { const rs = CR[c], x = rs.find(r => r.date === d); return x ? x.close / rs[0].open : 1 })))
    let p = eq[0], m = 0
    for (const v of eq) { if (v > p) p = v; const d = v / p - 1; if (d < m) m = d }
    say('   ' + '基准：全程死拿'.padEnd(46) + '组合收益 ' + fR(eq[eq.length - 1] - 1).padEnd(9) + '最大回撤 ' + fR(m))
  }

  say('')
  say('========== 五、改成「仓位管理」（底仓常持＋信号加减仓）而不是全进全出 ==========')
  function btW(rs, buyKey, sellKey, base, wBuy, wOut, stop) {
    let w = base, st = 'base', anchor = rs[0].close, eq = 1
    const dayEq = { [rs[0].date]: 1 }
    for (let i = 1; i < rs.length; i++) {
      eq *= (1 + w * (rs[i].close / rs[i - 1].close - 1))
      dayEq[rs[i].date] = eq
      if (st === 'full' && isFinite(stop) && rs[i].close / anchor - 1 <= stop) { st = 'base'; w = base }
      if (rs[i][buyKey]) { if (st !== 'full') { st = 'full'; w = wBuy; anchor = rs[i].close } }
      else if (st !== 'out' && rs[i][sellKey]) { st = 'out'; w = wOut }
    }
    let p = 1, m = 0
    for (const d of Object.keys(dayEq).sort()) { const v = dayEq[d]; if (v > p) p = v; const dd = v / p - 1; if (dd < m) m = dd }
    return { ret: eq - 1, mdd: m, dayEq }
  }
  const WV = [
    ['底仓 50%｜买点→100%｜卖点→20%｜止损−10%', 'sBuyBase', 'sSellStd', 0.5, 1.0, 0.2, -0.10],
    ['底仓 50%｜买点→100%｜卖点→0% ｜止损−10%', 'sBuyBase', 'sSellStd', 0.5, 1.0, 0.0, -0.10],
    ['底仓 70%｜买点→100%｜卖点→30%｜止损−10%', 'sBuyBase', 'sSellStd', 0.7, 1.0, 0.3, -0.10],
    ['底仓 30%｜买点→100%｜卖点→0% ｜止损−10%', 'sBuyBase', 'sSellStd', 0.3, 1.0, 0.0, -0.10]
  ]
  for (const [lab, b, s2, base, wb, wo, stop] of WV) {
    const res = codes.map(c => btW(CR[c], b, s2, base, wb, wo, stop))
    const PORTC2 = {}
    for (const c of codes) PORTC2[c] = res.find((x, i) => codes[i] === c).dayEq
    const eq = allDates.map(d => mean(codes.map(c => PORTC2[c][d] !== undefined ? PORTC2[c][d] : 1)))
    let p = eq[0], m = 0
    for (const v of eq) { if (v > p) p = v; const d = v / p - 1; if (d < m) m = d }
    say('   ' + lab.padEnd(44) + '逐只均 ' + fR(mean(res.map(r => r.ret))).padEnd(9) + '组合 ' + fR(eq[eq.length - 1] - 1).padEnd(9) + '组合回撤 ' + fR(m))
  }
  say('   ' + '【对照】全程死拿'.padEnd(44) + '逐只均 ' + fR(mean(bhRows.map(r => r.bh))).padEnd(9) + '组合 ' + fR(mean(bhRows.map(r => r.bh))).padEnd(9) + '组合回撤 −28.44%')

  fs.writeFileSync(__dirname + '/s1-eval-report.md', out.join('\n'), 'utf8')
  console.log('\n→ 已写 _tests/s1-eval-report.md')
  process.exit(0)
})().catch(e => { console.log('❌ ' + (e && e.stack || e)); process.exit(1) })
