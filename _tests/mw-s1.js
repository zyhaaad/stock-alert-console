/* 梦网科技(002123) S1 系统回看：2025-01-17 / 01-27 / 02-06 / 02-07
 * 同时给「旧系统（console 现行三类提示）」与「新系统（低位关注/建仓区 + 减仓提醒/加强过热）」
 * 并用两套口径交叉验证：
 *   口径A（回测口径）= 资金取最近 4 个**完整周** r0 合计；周线/支撑压力取最近 20 个**完整周**（不含当周）
 *   口径B（console 现行）= 资金取最近 **20 个交易日** r0 合计；周线/支撑压力取最近 20 周**含当周**
 * 用法：node _tests/mw-s1.js
 */
'use strict'
const fs = require('fs')
const d = JSON.parse(fs.readFileSync(__dirname + '/_cache/mw-data.json', 'utf8'))
const bars = d.bars, flows = d.flows, FS = d.floatShares
const DATES = ['2025-01-17', '2025-01-27', '2025-02-06', '2025-02-07']
const ML_LOW_GATE = 0.30, ML_SUP_GATE = 0.15

const D = bars.map(b => b[0]), O = bars.map(b => b[1]), C = bars.map(b => b[2]), H = bars.map(b => b[3]), L = bars.map(b => b[4]), V = bars.map(b => b[5])
const flowByDate = {}
for (const f of flows) { const p = f.split(','); flowByDate[p[0]] = Number(p[1]) }

const fR = x => isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '—'
const fP = x => isFinite(x) ? (x * 100).toFixed(1) + '%' : '—'
const fx = x => isFinite(x) ? x.toFixed(2) : '—'

function weekKey(ds) { const t = new Date(ds + 'T00:00:00Z'); const w = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + (4 - w)); return t.toISOString().slice(0, 10) }

/* 周聚合到指定下标 i（口径B：含当周）；each week: {k,c,v,h,l,m} */
function weeksTo(i) {
  const wk = []
  for (let k = 0; k <= i; k++) {
    const key = weekKey(D[k])
    let cur = wk[wk.length - 1]
    if (!cur || cur.k !== key) { cur = { k: key, c: C[k], v: 0, h: H[k], l: L[k], m: 0 }; wk.push(cur) }
    cur.c = C[k]; cur.v += V[k]
    if (H[k] > cur.h) cur.h = H[k]
    if (L[k] < cur.l) cur.l = L[k]
    if (isFinite(flowByDate[D[k]])) cur.m += flowByDate[D[k]]
  }
  return wk
}

function state(i, mode) {
  const c = C[i]
  const ret60 = C[i] / C[i - 60] - 1
  let hi = -Infinity, lo = Infinity
  for (let j = i - 249; j <= i; j++) { if (H[j] > hi) hi = H[j]; if (L[j] < lo) lo = L[j] }
  const pos250 = (hi > lo) ? (c - lo) / (hi - lo) : NaN
  const premLow = c / lo - 1
  const ma = n => { let s = 0; for (let j = i - n + 1; j <= i; j++) s += C[j]; return s / n }
  const ma5 = ma(5), ma10 = ma(10), ma20 = ma(20), ma30 = ma(30)
  const align = ma5 > ma10 && ma10 > ma20 && ma20 > ma30
  let streak = 0
  for (let j = i; j >= 0; j--) { let s = 0; for (let t = j - 4; t <= j; t++) s += C[t]; const m5 = s / 5; if (O[j] > m5 && C[j] > m5) streak++; else break }
  const overMa5 = c / ma5 - 1

  const wkAll = weeksTo(i)
  let wk
  if (mode === 'B') wk = wkAll
  else { /* 口径A：剔除当周（若 i 不是本周最后一个交易日）*/ const keyI = weekKey(D[i])
    const lastOfWeek = (i + 1 >= D.length) || weekKey(D[i + 1]) !== keyI
    wk = (lastOfWeek ? wkAll : wkAll.slice(0, wkAll.length - 1)) }
  const wma = m => (wk.length >= m ? wk.slice(-m).reduce((a, x) => a + x.c, 0) / m : NaN)
  const wma5 = wma(5), wma20 = wma(20)
  const v4 = wk.slice(-4).reduce((a, x) => a + x.v, 0) / Math.min(4, wk.length)
  const v26 = wk.slice(-26).reduce((a, x) => a + x.v, 0) / Math.min(26, wk.length)
  const volRatio = v26 > 0 ? v4 / v26 : NaN
  const w20 = wk.slice(-20)
  const wHi20 = Math.max(...w20.map(x => x.h)), wLo20 = Math.min(...w20.map(x => x.l))
  const supDist = c / wLo20 - 1, resDist = c / wHi20 - 1

  const mv = FS * c
  let mainVal
  if (mode === 'B') { let s = 0; for (let z = i, k = 0; z >= 0 && k < 20; z--, k++) { const v = flowByDate[D[z]]; if (isFinite(v)) s += v } mainVal = s }
  else { mainVal = wk.slice(-4).reduce((a, x) => a + x.m, 0) }
  const mainRatio = mainVal / mv

  return { c, ret60, pos250, premLow, supDist, resDist, wHi20, wLo20, wma5, wma20, volRatio, mainRatio, ma5, align, streak, overMa5, wk, mv }
}

/* 旧系统（console 现行） */
function legacy(s) {
  if (isFinite(s.pos250) && s.pos250 > 0.65 && isFinite(s.ret60) && s.ret60 > 0.20 &&
    ((isFinite(s.volRatio) && s.volRatio < 1.0) || (isFinite(s.mainRatio) && s.mainRatio < 0)))
    return { act: '派发完毕', tone: 'warn' }
  if (isFinite(s.ret60) && s.ret60 < -0.20 && isFinite(s.volRatio) && s.volRatio < 0.9 &&
    (!isFinite(s.mainRatio) || Math.abs(s.mainRatio) < 0.004))
    return { act: '下跌未完·勿抄', tone: 'bad' }
  if (isFinite(s.mainRatio) && s.mainRatio > 0.004 && isFinite(s.pos250) && s.pos250 < 0.4 &&
    isFinite(s.ret60) && s.ret60 < 0.15 && isFinite(s.wma20) && s.wma5 > s.wma20 &&
    isFinite(s.premLow) && s.premLow < ML_LOW_GATE && isFinite(s.supDist) && s.supDist < ML_SUP_GATE)
    return { act: '主力建仓区（买）', tone: 'good' }
  return { act: '趋势运行中·无需操作', tone: 'flat' }
}
/* 新系统（2026-09-20 验证） */
function modern(s) {
  const buyBase = isFinite(s.mainRatio) && s.mainRatio > 0.004 && isFinite(s.pos250) && s.pos250 < 0.4 && isFinite(s.supDist) && s.supDist < 0.15
  const buyStrong = buyBase && isFinite(s.ret60) && s.ret60 < 0.15 && isFinite(s.wma20) && s.wma5 > s.wma20 && isFinite(s.premLow) && s.premLow < 0.30
  const sellStd = isFinite(s.pos250) && s.pos250 > 0.65 && isFinite(s.overMa5) && s.overMa5 > 0.05
  const sellStr = sellStd && s.align && s.streak >= 2
  return { buyBase, buyStrong, sellStd, sellStr }
}

const out = []
const say = s => { out.push(s); console.log(s) }

say('# 梦网科技(002123) · S1 系统回看')
say('')
const last = bars.length - 1
say('数据：腾讯前复权日K ' + bars.length + ' 根 ' + D[0] + ' ~ ' + D[last] + '；资金 = 新浪 r0_net（超大单，代主力）；流通股本 ' +
  (FS / 1e8).toFixed(2) + ' 亿股（按今日市值/现价折算）')
say('')
{ let lo = Infinity, hi = -Infinity, loD = '', hiD = ''
  for (let j = 0; j < bars.length; j++) { if (L[j] < lo) { lo = L[j]; loD = D[j] } if (H[j] > hi) { hi = H[j]; hiD = D[j] } }
  say('全区间价格：最低 ' + fx(lo) + '（' + loD + '）｜最高 ' + fx(hi) + '（' + hiD + '）｜数据末日 ' + D[last] + ' 收 ' + fx(C[last])) }

for (const ds of DATES) {
  const i = D.indexOf(ds)
  say('')
  say('═══════════════════════════════════════════')
  if (i < 0) { say('⚠️ ' + ds + ' 不在交易日序列中'); continue }
  const chg = C[i] / C[i - 1] - 1
  const wd = ['日', '一', '二', '三', '四', '五', '六'][new Date(ds + 'T00:00:00Z').getUTCDay()]
  say('## ' + ds + '（周' + wd + '）　收盘 ' + fx(C[i]) + '　当日 ' + fR(chg))
  say('　　开 ' + fx(O[i]) + '｜高 ' + fx(H[i]) + '｜低 ' + fx(L[i]) + '　成交量 ' + (V[i] / 1e4).toFixed(1) + ' 万手')

  const sA = state(i, 'A'), sB = state(i, 'B')
  for (const [tag, s] of [['口径A（回测口径）', sA], ['口径B（console 现行）', sB]]) {
    const lg = legacy(s), md = modern(s)
    say('')
    say('　【' + tag + '】')
    say('　　位置：近一年分位 ' + fP(s.pos250) + '（0=最低）｜距一年最低 ' + fR(s.premLow) + '｜距近20周支撑 ' + fR(s.supDist) +
      '｜距近20周压力 ' + fR(s.resDist))
    say('　　结构：周MA5 ' + fx(s.wma5) + ' vs 周MA20 ' + fx(s.wma20) + ' = ' + (s.wma5 > s.wma20 ? '多头' : '空头') +
      '｜日线多头排列 ' + (s.align ? '是' : '否') + '｜连续站上MA5 ' + s.streak + ' 日｜偏离MA5 ' + fR(s.overMa5))
    say('　　量能：4周/26周均量比 ' + fx(s.volRatio) + '（' + (s.volRatio < 1 ? '缩量' : '放量') + '）｜资金：近4周/20日主力净额 ÷ 流通市值 ' + fR(s.mainRatio))
    say('　　旧系统 → ' + lg.act)
    const hits = []
    if (md.buyStrong) hits.push('建仓区（强买）')
    else if (md.buyBase) hits.push('低位关注（买点）')
    if (md.sellStr) hits.push('加强过热（减仓）')
    else if (md.sellStd) hits.push('减仓提醒')
    say('　　新系统 → ' + (hits.length ? hits.join(' ＋ ') : '无信号') +
      '　〔买点三条件：位置<40% ' + (s.pos250 < 0.4 ? '✅' : '❌') + '｜资金>0.4% ' + (s.mainRatio > 0.004 ? '✅' : '❌') +
      '｜距20周支撑<15% ' + (s.supDist < 0.15 ? '✅' : '❌') + '｜周线多头 ' + (s.wma5 > s.wma20 ? '✅' : '❌') + '〕')
  }
  const f20 = i + 20 < bars.length ? C[i + 20] / C[i] - 1 : NaN
  const f60 = i + 60 < bars.length ? C[i + 60] / C[i] - 1 : NaN
  let mae = NaN, mfe = NaN
  if (i + 60 < bars.length) { let l2 = Infinity, h2 = -Infinity; for (let j = i + 1; j <= i + 60; j++) { if (L[j] < l2) l2 = L[j]; if (H[j] > h2) h2 = H[j] } mae = l2 / C[i] - 1; mfe = h2 / C[i] - 1 }
  say('')
  say('　事后验证：20 日后 ' + fR(f20) + '｜60 日后 ' + fR(f60) + '｜期间最大浮亏 ' + fR(mae) + '／最大浮盈 ' + fR(mfe))
}

say('')
say('═══════════════════════════════════════════')
say('## 逐日信号扫描（2024-06-01 ~ 2025-03-31）—— 看它到底抓没抓到')
say('　（只列「有信号的日子」与「每月首个交易日」；口径B）')
let lastMonth = ''
let sigDays = 0, buyDays = 0, sellDays = 0
for (let i = 0; i < bars.length; i++) {
  if (D[i] < '2024-06-01' || D[i] > '2025-03-31') continue
  const s = state(i, 'B'), lg = legacy(s), md = modern(s)
  const mon = D[i].slice(0, 7)
  const isSig = md.buyBase || md.sellStd || lg.act !== '趋势运行中·无需操作'
  const isMonthFirst = mon !== lastMonth
  if (!isSig && !isMonthFirst) continue
  lastMonth = mon
  if (md.buyBase) buyDays++
  if (md.sellStd) sellDays++
  if (isSig) sigDays++
  const f20 = i + 20 < bars.length ? C[i + 20] / C[i] - 1 : NaN
  say('　' + D[i] + '　' + fx(C[i]).padStart(6) + '　位置' + (s.pos250 * 100).toFixed(0).padStart(3) + '%' +
    '　距支' + (s.supDist * 100).toFixed(0).padStart(4) + '%' + '　资金' + (s.mainRatio * 100).toFixed(1).padStart(5) + '%' +
    '　周线' + (s.wma5 > s.wma20 ? '多' : '空') +
    '　【新】' + ((md.buyStrong ? '建仓区' : md.buyBase ? '低位关注' : '') + (md.sellStr ? '加强过热' : md.sellStd ? '减仓提醒' : '') || '—') +
    '　【旧】' + lg.act + '　后20日 ' + fR(f20))
}
say('')
say('　区间内：买点信号 ' + buyDays + ' 天、卖点信号 ' + sellDays + ' 天、任一信号 ' + sigDays + ' 天')
say('')
say('## 真正的底部在 2024-08-28（5.43）—— 那天系统怎么说？')
{
  const i = D.indexOf('2024-08-28')
  if (i > 0) {
    const s = state(i, 'B'), md = modern(s), lg = legacy(s)
    say('　2024-08-28　收 ' + fx(C[i]) + '　位置 ' + fP(s.pos250) + '　距一年最低 ' + fR(s.premLow) +
      '　距20周支撑 ' + fR(s.supDist) + '　资金 ' + fR(s.mainRatio) + '　周线' + (s.wma5 > s.wma20 ? '多头' : '空头'))
    say('　新系统 → ' + ((md.buyStrong ? '建仓区' : md.buyBase ? '低位关注' : '') || '无信号') + '　｜旧系统 → ' + lg.act)
    const f20 = i + 20 < bars.length ? C[i + 20] / C[i] - 1 : NaN
    const f60 = i + 60 < bars.length ? C[i + 60] / C[i] - 1 : NaN
    say('　事后：20日 ' + fR(f20) + '｜60日 ' + fR(f60))
  }
}

say('')
say('═══════════════════════════════════════════')
say('## 之后发生了什么（价格轨迹）')
for (let i = 0; i < bars.length; i++) {
  if (D[i] >= '2024-12-01' && D[i] <= '2025-04-30' && (i % 5 === 0 || DATES.includes(D[i]))) {
    say('　' + D[i] + '　' + fx(C[i]) + '　' + (DATES.includes(D[i]) ? '← 提问日' : ''))
  }
}

fs.writeFileSync(__dirname + '/mw-s1-report.md', out.join('\n'), 'utf8')
console.log('\n→ 已写 _tests/mw-s1-report.md')
