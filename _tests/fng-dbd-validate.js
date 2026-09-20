#!/usr/bin/env node
/* eslint-disable */
/**
 * 股债差额因子 · 回测验证（切换引擎前的硬门槛）
 * 新组合 = 现有5因子 + 股债差额(dbd = 中证全指20日收益 − 国债指数20日收益)
 * 对比：现行 5 因子 vs 方案A(dbd15) vs 方案B(两融不动/vlm降5)
 * 门槛：前瞻 60 日分组必须单调 恐惧>中性>贪婪，且恐惧−贪婪区分度 ≥ 现行
 */
const https = require('https')
const fs = require('fs')
const F = require('../stock-alert-cloud/fng-core.js')

function getJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 20000 }, res => {
      let b = ''
      res.setEncoding('utf8')
      res.on('data', d => (b += d))
      res.on('end', () => { try { resolve(JSON.parse(b)) } catch (e) { reject(new Error('非JSON')) } })
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

async function main() {
  console.log('== 股债差额因子回测验证 ==')
  const j = JSON.parse(fs.readFileSync('../stock-alert-cloud/fng-history.json', 'utf8'))
  const u = F.unpackSeries(j.days || j)
  const series = u.series
  const raws = u.raws
  console.log('存档 ' + series.length + ' 天')

  // 拉中证全指 + 国债指数（腾讯，同源同深度）
  const fetchIdx = async (code) => {
    const r = await getJson('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + code + ',day,,,1200,qfq')
    const key = r.data && Object.keys(r.data)[0]
    const raw = r.data[key] && (r.data[key].qfqday || r.data[key].day)
    if (!raw || raw.length < 300) throw new Error(code + ' 数据不足')
    const m = new Map()
    for (const row of raw) m.set(String(row[0]).slice(0, 10), Number(row[2]))
    return m
  }
  const stk = await fetchIdx('sh000985')
  const bnd = await fetchIdx('sh000012')
  console.log('中证全指 ' + stk.size + ' 天、国债指数 ' + bnd.size + ' 天')

  // 按存档日序计算 dbd（两腿都取 20 日收益；任一腿缺数 → NaN）
  const dbd = series.map(r => {
    const iS = [], iB = []
    // 直接用 Map 前溯 20 个交易日：用日期数组更稳，这里按指数自身序列回溯
    return { d: r.d }
  })
  // 更稳：先建指数的日期序（仅含存档区间内且两腿都有值的日期）
  const dates = series.map(r => r.d).filter(d => stk.has(d) && bnd.has(d))
  const stkArr = dates.map(d => stk.get(d))
  const bndArr = dates.map(d => bnd.get(d))
  const dbdMap = new Map()
  for (let i = 20; i < dates.length; i++) {
    const rs = stkArr[i] / stkArr[i - 20] - 1
    const rb = bndArr[i] / bndArr[i - 20] - 1
    dbdMap.set(dates[i], rs - rb)
  }
  const dbdArr = series.map(r => isFinite(dbdMap.get(r.d)) ? dbdMap.get(r.d) : NaN)
  const valid = dbdArr.filter(isFinite).length
  console.log('股债差可算天数 ' + valid + '/' + series.length)

  // 滚动 252 百分位（各因子）
  const prMom = series.map((_, i) => rollPr(raws.map(r => r.mom), i, 252, F.MIN_WIN))
  const prVol = series.map((_, i) => { const p = rollPr(raws.map(r => r.vol), i, 252, F.MIN_WIN); return isFinite(p) ? 100 - p : NaN })
  const prVlm = series.map((_, i) => rollPr(raws.map(r => r.vlm), i, 252, F.MIN_WIN))
  const prMgn = series.map((_, i) => rollPr(raws.map(r => r.mgn), i, 252, F.MIN_WIN))
  const prMbs = series.map((_, i) => rollPr(raws.map(r => r.mbs), i, 252, F.MIN_WIN))
  const prDbd = series.map((_, i) => rollPr(dbdArr, i, 252, F.MIN_WIN))
  const mix = (ws) => series.map((_, i) => {
    let s = 0, tw = 0
    for (const [p, w] of ws) { if (isFinite(p[i])) { s += p[i] * w; tw += w } }
    return tw >= 0.85 ? s / tw : NaN   // 权重覆盖 ≥85% 才出分（与引擎降级口径一致）
  })

  // 前瞻 60 日（中证全指）
  const dArr = Array.from(stk.keys())
  const fwd = series.map(r => {
    const ci = dArr.indexOf(r.d)
    if (ci < 0 || ci + 60 >= dArr.length) return NaN
    const p0 = stk.get(r.d), p1 = stk.get(dArr[ci + 60])
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
    console.log(name + '：样本 ' + n + '｜恐惧 ' + fr.fear.toFixed(2) + '% / 中性 ' + fr.neutral.toFixed(2) + '% / 贪婪 ' + fr.greed.toFixed(2) + '%' +
      '｜单调 ' + (mono ? '是' : '否') + '｜区分度 ' + (isFinite(spread) ? spread.toFixed(2) + '%' : '—'))
    return { mono, spread, n }
  }

  const base = report('现行5因子      ', series.map(r => r.v))
  const planA = report('方案A(dbd15)   ', mix([[prMom, .15], [prVol, .15], [prVlm, .10], [prDbd, .15], [prMgn, .225], [prMbs, .225]]))
  const planB = report('方案B(两融不动) ', mix([[prMom, .15], [prVol, .15], [prVlm, .05], [prDbd, .15], [prMgn, .25], [prMbs, .25]]))

  console.log('\n结论门槛：新方案须 单调 且 区分度 ≥ 现行(' + base.spread.toFixed(2) + '%)')
  for (const [nm, r] of [['方案A', planA], ['方案B', planB]]) {
    console.log(nm + '：' + (r.mono && r.spread >= base.spread ? '✅ 通过，可切换' : '❌ 未通过，不切换'))
  }
  // 新旧分值相关性（切换后历史连续性参考）
}
main().catch(e => { console.error('验证脚本出错: ' + (e && e.message ? e.message : e)); process.exit(2) })
