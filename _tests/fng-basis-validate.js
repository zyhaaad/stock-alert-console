#!/usr/bin/env node
/* eslint-disable */
/**
 * 股指期货贴水因子 · 回测验证（切换引擎前的硬门槛，口径与 fng-dbd-validate.js 一致）
 * 因子：basis = (IF当月连续收盘 − 沪深300现货收盘) / 现货收盘 × 100
 *       取 20 日均值平滑换月跳变；再滚动 252 日百分位（升水=贪婪，深贴水=恐惧，方向同向）
 * 新组合 = 现有5因子 + 贴水因子
 * 门槛：前瞻 60 日分组必须单调 恐惧>中性>贪婪，且恐惧−贪婪区分度 ≥ 现行
 * 运行：cd _tests && node fng-basis-validate.js
 */
const https = require('https')
const fs = require('fs')
const path = require('path')
const F = require(path.join(__dirname, '..', 'stock-alert-cloud', 'fng-core.js'))

function getRaw(url, referer) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: Object.assign({ 'User-Agent': 'Mozilla/5.0' },
      referer ? { Referer: referer } : {}), timeout: 25000 }, res => {
      let b = ''
      res.setEncoding('utf8')
      res.on('data', d => (b += d))
      res.on('end', () => resolve({ status: res.statusCode, body: b }))
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('超时')) })
  })
}
const pctRank = (win, v) => {
  let less = 0, eq = 0
  for (let i = 0; i < win.length; i++) { if (win[i] < v) less++; else if (win[i] === v) eq++ }
  return (less + eq / 2) / win.length * 100
}
const rollPr = (arr, i, win, minWin) => {
  const lo = Math.max(0, i - win + 1)
  const w = arr.slice(lo, i + 1).filter(isFinite)
  if (w.length < minWin || !isFinite(arr[i])) return NaN
  return pctRank(w, arr[i])
}
const rollMean = (arr, i, win) => {
  if (i < win - 1) return NaN
  let s = 0
  for (let j = i - win + 1; j <= i; j++) { if (!isFinite(arr[j])) return NaN; s += arr[j] }
  return s / win
}

async function fetchIdx(code) {
  const r = await getRaw('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + code + ',day,,,1200,qfq')
  const j = JSON.parse(r.body)
  const key = j.data && Object.keys(j.data)[0]
  const raw = j.data[key] && (j.data[key].qfqday || j.data[key].day)
  if (!raw || raw.length < 300) throw new Error(code + ' 数据不足')
  const m = new Map()
  for (const row of raw) m.set(String(row[0]).slice(0, 10), Number(row[2]))
  return m
}

async function fetchFutures() {
  // ⚠️ 2026-09-19 实测：老符号 CFF_RE_IF0 已返回 null，须用 IF0（返回 var t=([...])）
  const url = 'https://stock2.finance.sina.com.cn/futures/api/jsonp.php/var%20t=/InnerFuturesNewService.getDailyKLine?symbol=IF0'
  const r = await getRaw(url, 'https://finance.sina.com.cn')
  const lo = r.body.indexOf('['), hi = r.body.lastIndexOf(']')
  if (lo < 0 || hi <= lo) throw new Error('期指返回非数据体（长度 ' + r.body.length + '）')
  const arr = JSON.parse(r.body.slice(lo, hi + 1))
  if (!Array.isArray(arr) || arr.length < 300) throw new Error('期指数据不足 ' + (arr && arr.length))
  const m = new Map()
  for (const row of arr) {
    const d = String(row.d || row.date || '').slice(0, 10)
    const c = Number(row.c != null ? row.c : row.close)
    if (d && isFinite(c) && c > 0) m.set(d, c)
  }
  return m
}

async function main() {
  console.log('== 股指期货贴水因子回测验证 ==')
  const j = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'stock-alert-cloud', 'fng-history.json'), 'utf8'))
  const u = F.unpackSeries(j.days || j)
  const series = u.series
  const raws = u.raws
  console.log('恐贪存档 ' + series.length + ' 天')

  const fut = await fetchFutures()
  const spot = await fetchIdx('sh000300')
  const futDates = Array.from(fut.keys()).sort()
  console.log('IF当月连续 ' + fut.size + ' 天（' + futDates[0] + ' ~ ' + futDates[futDates.length - 1] + '）、沪深300现货 ' + spot.size + ' 天')

  // 按存档日序计算贴水率（两腿同日都有值才算）
  const dates = series.map(r => r.d).filter(d => fut.has(d) && spot.has(d))
  if (dates.length < 300) throw new Error('两腿可对齐天数不足：' + dates.length)
  const rawBasis = dates.map(d => (fut.get(d) / spot.get(d) - 1) * 100)
  const basisMap = new Map()
  for (let i = 0; i < dates.length; i++) basisMap.set(dates[i], rawBasis[i])
  // 20 日均值平滑（当月连续换月日基差跳变 → 均值压噪）
  const basis20Map = new Map()
  for (let i = 19; i < dates.length; i++) {
    let s = 0, ok = true
    for (let k = i - 19; k <= i; k++) { if (!isFinite(rawBasis[k])) { ok = false; break } s += rawBasis[k] }
    if (ok) basis20Map.set(dates[i], s / 20)
  }
  const basisArr = series.map(r => isFinite(basis20Map.get(r.d)) ? basis20Map.get(r.d) : NaN)
  const valid = basisArr.filter(isFinite).length
  const sample = series.filter(r => isFinite(basis20Map.get(r.d)))
  console.log('贴水率可对齐 ' + dates.length + '/' + series.length + ' 天；20日平滑后可算 ' + valid + ' 天')
  if (sample.length) {
    const last = sample[sample.length - 1]
    console.log('最新：' + last.d + ' 贴水率20日均值 ' + basis20Map.get(last.d).toFixed(2) + '%（负=贴水）')
  }

  // 现行 5 因子滚动百分位 + 贴水因子百分位（升水=贪婪，方向同向）
  const prMom = series.map((_, i) => rollPr(raws.map(r => r.mom), i, 252, F.MIN_WIN))
  const prVol = series.map((_, i) => { const p = rollPr(raws.map(r => r.vol), i, 252, F.MIN_WIN); return isFinite(p) ? 100 - p : NaN })
  const prVlm = series.map((_, i) => rollPr(raws.map(r => r.vlm), i, 252, F.MIN_WIN))
  const prMgn = series.map((_, i) => rollPr(raws.map(r => r.mgn), i, 252, F.MIN_WIN))
  const prMbs = series.map((_, i) => rollPr(raws.map(r => r.mbs), i, 252, F.MIN_WIN))
  const prBasis = series.map((_, i) => rollPr(basisArr, i, 252, F.MIN_WIN))
  const mix = (ws) => series.map((_, i) => {
    let s = 0, tw = 0
    for (const [p, w] of ws) { if (isFinite(p[i])) { s += p[i] * w; tw += w } }
    return tw >= 0.85 ? s / tw : NaN
  })

  // 前瞻 60 日（沪深300 现货，与因子标的同源）
  const dArr = Array.from(spot.keys())
  const fwd = series.map(r => {
    const ci = dArr.indexOf(r.d)
    if (ci < 0 || ci + 60 >= dArr.length) return NaN
    const p0 = spot.get(r.d), p1 = spot.get(dArr[ci + 60])
    return p1 / p0 - 1
  })
  const report = (name, scores) => {
    const g = { fear: [], neutral: [], greed: [] }
    for (let i = 0; i < scores.length; i++) {
      if (!isFinite(scores[i]) || !isFinite(fwd[i])) continue
      const k = scores[i] < 40 ? 'fear' : scores[i] < 60 ? 'neutral' : 'greed'
      g[k].push(fwd[i])
    }
    const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length * 100 : NaN
    const fr = { fear: avg(g.fear), neutral: avg(g.neutral), greed: avg(g.greed) }
    const n = g.fear.length + g.neutral.length + g.greed.length
    const mono = fr.fear > fr.neutral && fr.neutral > fr.greed
    const spread = fr.fear - fr.greed
    console.log(name + '：样本 ' + n + '｜恐惧 ' + (isFinite(fr.fear) ? fr.fear.toFixed(2) : '—') + '% / 中性 ' +
      (isFinite(fr.neutral) ? fr.neutral.toFixed(2) : '—') + '% / 贪婪 ' + (isFinite(fr.greed) ? fr.greed.toFixed(2) : '—') + '%' +
      '｜单调 ' + (mono ? '是' : '否') + '｜区分度 ' + (isFinite(spread) ? spread.toFixed(2) + '%' : '—'))
    return { mono, spread, n }
  }

  const base = report('现行5因子        ', series.map(r => r.v))
  // 诊断：贴水因子自身的前瞻分组（252 日百分位直接分组，看它单独有没有区分度）
  report('【诊断】贴水单独   ', prBasis)
  const planA = report('方案A(basis15)    ', mix([[prMom, .15], [prVol, .15], [prVlm, .10], [prBasis, .15], [prMgn, .225], [prMbs, .225]]))
  const planB = report('方案B(两融不动)   ', mix([[prMom, .15], [prVol, .15], [prVlm, .05], [prBasis, .15], [prMgn, .25], [prMbs, .25]]))
  const planC = report('方案C(basis10)    ', mix([[prMom, .15], [prVol, .15], [prVlm, .10], [prBasis, .10], [prMgn, .24], [prMbs, .26]]))

  console.log('\n结论门槛：新方案须 单调 且 区分度 ≥ 现行(' + base.spread.toFixed(2) + '%)')
  for (const [nm, r] of [['方案A', planA], ['方案B', planB], ['方案C', planC]]) {
    console.log(nm + '：' + (r.mono && r.spread >= base.spread ? '✅ 通过，可切换' : '❌ 未通过，不切换'))
  }
}
main().catch(e => { console.error('验证脚本出错: ' + (e && e.message ? e.message : e)); process.exit(2) })
