/* S1「主力建仓区」闸门候选回测（2026-09-20）
 *
 * 背景：单只股回放发现 000767 在 2026-06-23 被误判「建仓区」——收盘 4.24 已是近一年
 * 最低价 2.76 的 +53.6%，但 pos250 只有 39%（被 6-01 高点 6.14 撑大区间）。即
 * 「一年内暴涨暴跌过的票，pos<40% 会把半山腰当低位」。
 *
 * 本脚本：在 17 只 × 全样本点上复现 console 的基线口径（应得 n=112 / 60日 +14.80%），
 * 再逐个测试「距近一年最低价」闸门变体，看能否在不砍掉真信号的前提下剔掉假信号。
 *
 * 口径严格对齐 _tests/f4-selfcheck.js 的 E 节最后一行
 *   (stage==='③主力进场建仓' && pos250<0.4 && wma5>wma20)，避免"换了数据得出新数字"。
 *
 * 用法：node _tests/s1-gate-test.js
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

function mean(a) { const v = a.filter(x => x !== null && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN }
function pct(n, d) { return d ? n / d * 100 : NaN }
function fR(x) { return (x !== null && isFinite(x)) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '—' }
function fP(x) { return (x !== null && isFinite(x)) ? x.toFixed(1) + '%' : '—' }

function weekKey(dstr) {
  const d = new Date(dstr + 'T00:00:00Z')
  const day = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + (4 - day))
  return d.toISOString().slice(0, 10)
}

function build() {
  const rows = []
  for (const code of codes) {
    const st = data[code], bars = st.bars, flows = st.flows, fs_ = st.floatShares
    const flowByDate = {}
    for (const f of flows) { const p = f.split(','); flowByDate[p[0]] = Number(p[1]) }
    const close = bars.map(b => b[2]), vol = bars.map(b => b[5]), dates = bars.map(b => b[0])
    const hiP = bars.map(b => b[3]), loP = bars.map(b => b[4])
    const WARM = 260, MAXF = 60
    const wk = {}
    for (let i = 0; i < bars.length; i++) {
      const k = weekKey(dates[i])
      if (!wk[k]) wk[k] = { d: k, c: close[i], v: 0, m: 0, last: dates[i] }
      wk[k].c = close[i]; wk[k].v += vol[i]; wk[k].last = dates[i]
      if (isFinite(flowByDate[dates[i]])) wk[k].m += flowByDate[dates[i]]
    }
    const wks = Object.keys(wk).sort().map(k => wk[k])

    for (let i = WARM; i < bars.length - MAXF; i++) {
      const date = dates[i]
      const mainYi = flowByDate[date]
      if (!isFinite(mainYi)) continue
      const ret60 = close[i] / close[i - 60] - 1
      let hi = -Infinity, lo = Infinity
      for (let j = i - 249; j <= i; j++) { if (close[j] > hi) hi = close[j]; if (close[j] < lo) lo = close[j] }
      const pos250 = hi > lo ? (close[i] - lo) / (hi - lo) : NaN
      /* 真·近一年最低价 / 最高价（用盘中价，与线上「位置体检」一致）*/
      let loP250 = Infinity, hiP250 = -Infinity
      for (let j = i - 249; j <= i; j++) { if (loP[j] < loP250) loP250 = loP[j]; if (hiP[j] > hiP250) hiP250 = hiP[j] }
      /* ⚠️ 线上 weekStage 的 pos250 用的是**盘中高低价**，这里补一个同口径版本 pos250i，
         否则回测与线上不是同一条规则（用收盘价算会让区间偏窄、分位偏高）*/
      const pos250i = hiP250 > loP250 ? (close[i] - loP250) / (hiP250 - loP250) : NaN
      const premLow = isFinite(loP250) && loP250 > 0 ? close[i] / loP250 - 1 : NaN      // 距一年最低价
      const fromHigh = isFinite(hiP250) && hiP250 > 0 ? close[i] / hiP250 - 1 : NaN     // 距一年最高价（负=在下方）

      const wIdx = wks.findIndex(x => x.last > date)
      const wEnd = wIdx < 0 ? wks.length - 1 : wIdx - 1
      const wClose = wks.slice(0, wEnd + 1).map(x => x.c), wVol = wks.slice(0, wEnd + 1).map(x => x.v)
      const wMain = wks.slice(0, wEnd + 1).map(x => x.m)
      function wma(n) { if (wClose.length < n) return NaN; let s = 0; for (let j = wClose.length - n; j < wClose.length; j++) s += wClose[j]; return s / n }
      const volRatio = wVol.length >= 26 ? (wVol.slice(-4).reduce((a, b) => a + b, 0) / 4) / (wVol.slice(-26).reduce((a, b) => a + b, 0) / 26) : NaN
      const mv = fs_ * close[i]
      const main4w = wMain.length >= 4 ? wMain.slice(-4).reduce((a, b) => a + b, 0) / mv : NaN
      const wma5 = wma(5), wma20 = wma(20)

      rows.push({ code, date, close: close[i], ret60, pos250, pos250i, premLow, fromHigh, volRatio, main4w, wma5, wma20,
        fwd20: close[i + 20] / close[i] - 1, fwd60: close[i + 60] / close[i] - 1 })
    }
  }
  return rows
}

const V = {
  'v1 基线（旧口径：pos250 用收盘价）': r =>
    r.main4w > 0.004 && r.pos250 < 0.4 && r.ret60 < 0.15 && isFinite(r.wma20) && r.wma5 > r.wma20,
  '★v1i 线上真口径（pos250 用盘中高低价）': r =>
    r.main4w > 0.004 && r.pos250i < 0.4 && r.ret60 < 0.15 && isFinite(r.wma20) && r.wma5 > r.wma20,
  '★v2i v1i + 距一年最低价 < 30%': r =>
    r.main4w > 0.004 && r.pos250i < 0.4 && r.ret60 < 0.15 && isFinite(r.wma20) && r.wma5 > r.wma20 && r.premLow < 0.30,
  '★v3i v1i + 距一年最低价 < 25%': r =>
    r.main4w > 0.004 && r.pos250i < 0.4 && r.ret60 < 0.15 && isFinite(r.wma20) && r.wma5 > r.wma20 && r.premLow < 0.25,
  '★v4i v1i + 距一年最低价 < 20%': r =>
    r.main4w > 0.004 && r.pos250i < 0.4 && r.ret60 < 0.15 && isFinite(r.wma20) && r.wma5 > r.wma20 && r.premLow < 0.20,
  '★v5i v1i + 距一年最低价 < 15%': r =>
    r.main4w > 0.004 && r.pos250i < 0.4 && r.ret60 < 0.15 && isFinite(r.wma20) && r.wma5 > r.wma20 && r.premLow < 0.15,
  '★v6i v1i + 距一年最低价 < 10%': r =>
    r.main4w > 0.004 && r.pos250i < 0.4 && r.ret60 < 0.15 && isFinite(r.wma20) && r.wma5 > r.wma20 && r.premLow < 0.10,
  '（参考）v2 v1+30% / v4 v1+20%（旧 pos 口径）': r =>
    r.main4w > 0.004 && r.pos250 < 0.4 && r.ret60 < 0.15 && isFinite(r.wma20) && r.wma5 > r.wma20 && r.premLow < 0.20,
  '（参考）v6 只用距最低价<30% 替 pos<0.4（不用分位）': r =>
    r.main4w > 0.004 && r.premLow < 0.30 && r.ret60 < 0.15 && isFinite(r.wma20) && r.wma5 > r.wma20,
  '（参考）v5i 距一年最高价 < -40%': r =>
    r.main4w > 0.004 && r.pos250i < 0.4 && r.ret60 < 0.15 && isFinite(r.wma20) && r.wma5 > r.wma20 && r.fromHigh < -0.40
}

;(async () => {
  await new Promise(r => setTimeout(r, 400))
  const rows = build()
  const segs = [['2025H1', '2025-01-01', '2025-06-30'], ['2025H2', '2025-07-01', '2025-12-31'],
    ['2026H1', '2026-01-01', '2026-06-30'], ['2026Q3', '2026-07-01', '2026-12-31']]
  const line = (label, l) => {
    const seg = segs.map(([, a, b]) => fR(mean(l.filter(r => r.date >= a && r.date <= b).map(r => r.fwd60))).padEnd(9))
    return label.padEnd(56) + 'n=' + String(l.length).padEnd(6) + '20日 ' + fR(mean(l.map(r => r.fwd20))).padEnd(9) +
      '60日 ' + fR(mean(l.map(r => r.fwd60))).padEnd(9) + '60日胜率 ' + fP(pct(l.filter(r => r.fwd60 > 0).length, l.length)).padEnd(8) +
      '跌超5% ' + fP(pct(l.filter(r => r.fwd60 <= DROP).length, l.length)).padEnd(8) + seg.join('')
  }

  const out = []
  const say = s => { out.push(s); console.log(s) }

  say('样本：' + codes.length + ' 只 × ' + rows.length + ' 点｜基准 60日 ' + fR(mean(rows.map(r => r.fwd60))) +
    '，跌超5% ' + fP(pct(rows.filter(r => r.fwd60 <= DROP).length, rows.length)))
  say('')
  say('阶段'.padEnd(0) + '　　　　　　　　　　　　　　　　　　'.padEnd(0) + segs.map(s => s[0].padEnd(9)).join(''))
  say('')

  const results = {}
  for (const [label, fn] of Object.entries(V)) {
    const l = rows.filter(fn)
    results[label] = l
    say(line(label, l))
  }

  /* 关键诊断：v1i 中被 v2i 剔除的样本，表现如何 */
  const v1 = results[Object.keys(V)[1]], v2 = results[Object.keys(V)[2]]
  const removed = v1.filter(r => !(r.premLow < 0.30))
  say('')
  say('===== 关键诊断（线上口径 v1i → 加闸门 v2i）：被「距最低价<30%」剔除的样本 =====')
  if (!removed.length) say('（无剔除样本）')
  else {
    say(line('　被剔除样本 ' + removed.length + ' 个', removed))
    say(line('　保留样本 ' + v2.length + ' 个', v2))
    const byc = {}
    removed.forEach(r => { byc[r.code] = (byc[r.code] || 0) + 1 })
    say('　被剔除样本分布：' + JSON.stringify(byc))
    removed.slice(0, 40).forEach(r => say('　  ' + r.code + ' ' + r.date + ' 收 ' + r.close.toFixed(2) +
      '｜距最低 ' + fR(r.premLow) + '｜pos(盘中) ' + (r.pos250i * 100).toFixed(0) + '%｜60日 ' + fR(r.fwd60)))
    if (removed.length > 40) say('　  …共 ' + removed.length + ' 个')
  }

  /* 稳健性：逐只拆开，看是不是被一两只股票带出来的 */
  say('')
  say('===== 稳健性：逐只拆开（线上口径 v1i vs 加 30% 闸门 v2i）=====')
  say('　代码      基线n  基线60日     闸门n  闸门60日     被剔除n')
  for (const c of codes) {
    const a = v1.filter(r => r.code === c), b = v2.filter(r => r.code === c)
    if (!a.length && !b.length) continue
    say('　' + c.padEnd(9) + String(a.length).padEnd(7) + fR(mean(a.map(r => r.fwd60))).padEnd(13) +
      String(b.length).padEnd(7) + fR(mean(b.map(r => r.fwd60))).padEnd(13) + (a.length - b.length))
  }
  const posB = codes.filter(c => { const b = v2.filter(r => r.code === c); return b.length && mean(b.map(r => r.fwd60)) > 0 }).length
  const withB = codes.filter(c => v2.some(r => r.code === c)).length
  say('　→ 有信号的 ' + withB + ' 只中，' + posB + ' 只 60 日为正（' + fP(pct(posB, withB)) + '）')
  say('')
  say('===== 口径差异体检：pos250 用「收盘价」vs「盘中高低价」=====')
  const onlyClose = rows.filter(r => V[Object.keys(V)[0]](r) && !V[Object.keys(V)[1]](r))
  const onlyIntra = rows.filter(r => !V[Object.keys(V)[0]](r) && V[Object.keys(V)[1]](r))
  say('　只因用收盘价才入选的样本：' + onlyClose.length + ' 个' + (onlyClose.length ? '（60日 ' + fR(mean(onlyClose.map(r => r.fwd60))) + '）' : ''))
  say('　只因用盘中价才入选的样本：' + onlyIntra.length + ' 个' + (onlyIntra.length ? '（60日 ' + fR(mean(onlyIntra.map(r => r.fwd60))) + '）' : ''))
  onlyIntra.slice(0, 20).forEach(r => say('　  ' + r.code + ' ' + r.date + ' 收 ' + r.close.toFixed(2) + '｜pos(收盘) ' +
    (r.pos250 * 100).toFixed(0) + '% vs pos(盘中) ' + (r.pos250i * 100).toFixed(0) + '%｜距最低 ' + fR(r.premLow) + '｜60日 ' + fR(r.fwd60)))

  /* 个案检验 */
  say('')
  say('===== 个案检验（用户点名的三笔）=====')
  const names = Object.keys(V)
  for (const [c, d] of [['600703', '2026-03-26'], ['600703', '2026-06-12'], ['000767', '2026-06-23'], ['000767', '2026-06-25']]) {
    const r = rows.find(x => x.code === c && x.date === d)
    if (!r) { say(c + ' ' + d + '：不在样本内（可能未入选任何变体）'); continue }
    say(c + ' ' + d + '：距最低 ' + fR(r.premLow) + '｜pos(盘中) ' + (r.pos250i * 100).toFixed(0) + '%｜60日 ' + fR(r.fwd60) +
      '｜线上口径 v1i ' + (V[names[1]](r) ? '保留' : '不选') + '｜加闸门 v2i ' + (V[names[2]](r) ? '保留' : '剔除'))
  }

  /* 另两个态的线上口径复核（console 上显示的 −5.79% / −8.74% 是旧收盘口径算的，必须复核） */
  say('')
  say('===== 另两个关键态的线上口径复核（pos250 用盘中高低价）=====')
  const dist = rows.filter(r => r.pos250i > 0.65 && r.ret60 > 0.20 && (r.volRatio < 1.0 || r.main4w < 0))
  const fall = rows.filter(r => r.ret60 < -0.20 && r.volRatio < 0.9 && (!isFinite(r.main4w) || Math.abs(r.main4w) < 0.004))
  say(line('派发完毕（pos250i>0.65 + 60日涨>20% + 缩量或资金转负）', dist))
  say(line('下跌未完（ret60<-20% + 缩量 + 无资金进场）', fall))
  say('　（旧收盘口径对照：派发完毕 −5.79% / 54%；下跌未完 −8.74% / 58.8%）')

  fs.writeFileSync(__dirname + '/s1-gate-report.md', out.join('\n'), 'utf8')
  console.log('\n→ 已写 _tests/s1-gate-report.md')
  process.exit(0)
})().catch(e => { console.log('❌ ' + (e && e.message || e)); process.exit(1) })
