/* 梦网科技(002123) —— 用**真代码**（console.html 的 weekStage）重跑 4 个指定日期 + 逐日扫描
 *
 * 为什么要有这个脚本：上一版 `mw-s1.js` 是**我自己重写了一遍规则**（不是真代码），
 * 而且「低位关注/减仓提醒」这套新规则**根本没进 console**，只是回测里的候选。
 * 本脚本用与 s1-single.js 相同的方法（jsdom 装预览副本 → 调真实 w.weekStage）取真值，
 * 并把真代码结果与我的复现并排对比，看差多少。
 *
 * ⚠️ 必须先跑：node _tests/build-preview.js
 * 用法：node _tests/mw-real.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules'
module.paths.push(WS)
const { JSDOM, VirtualConsole } = require(path.join(WS, 'jsdom'))

const CODE = '002123'
const PREVIEW = 'D:/mywork/_preview/stock-picker-preview.html'
const D = JSON.parse(fs.readFileSync(__dirname + '/_cache/mw-data.json', 'utf8'))
const bars = D.bars.map(r => ({ d: r[0], o: +r[1], c: +r[2], h: +r[3], l: +r[4], v: +r[5] }))
const FS = D.floatShares
const flow = D.flows.map(r => { const p = r.split(','); return { d: p[0], main: Number(p[1]) } }).filter(x => isFinite(x.main))
const n = bars.length
const DATES = ['2025-01-17', '2025-01-27', '2025-02-06', '2025-02-07']

const fR = x => isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '—'
const fP = x => isFinite(x) ? (x * 100).toFixed(1) + '%' : '—'
const fx = x => isFinite(x) ? x.toFixed(2) : '—'

const out = []
const say = s => { out.push(s); console.log(s) }

;(async () => {
  const html = fs.readFileSync(PREVIEW, 'utf8')
  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e && e.message)))
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://stock-alert-console.app.workbuddy.host/', virtualConsole: vc })
  const w = dom.window
  await new Promise(r => setTimeout(r, 700))
  if (errors.length) { console.log('装载报错：' + errors[0]); process.exit(1) }
  if (w.STAGE_VERSION !== 'S2') { console.log('预览引擎不是 S2：' + w.STAGE_VERSION); process.exit(1) }
  const secid = w.secidOf({ code: CODE })
  console.log('装载 OK｜STAGE_VERSION=' + w.STAGE_VERSION + '｜secid=' + secid +
    '｜ML_LOW_GATE=' + w.ML_LOW_GATE + '｜ML_SUP_GATE=' + w.ML_SUP_GATE)

  function real(t) {  /* t = bars 下标，灌 bars[0..t] */
    if (t < 249) return null
    const cur = bars[t].d
    const fwdFlow = flow.filter(x => x.d <= cur).slice(-30)
    w.G.dayBars = {}; w.G.dayBars[CODE] = bars.slice(0, t + 1)
    w.G.chipMap = {}; w.G.chipMap[CODE] = { flowDaily: fwdFlow.map(x => x.d + ',' + x.main), floatShares: FS }
    w.G.quoteMap = {}; w.G.quoteMap[secid] = { price: bars[t].c, mv: FS * bars[t].c }
    return w.weekStage(CODE)
  }

  say('# 梦网科技(002123) · **真代码**（console.html 的 weekStage）回看')
  say('')
  say('引擎版本 STAGE_VERSION=' + w.STAGE_VERSION + '｜闸门 ML_LOW_GATE=' + w.ML_LOW_GATE + ' / ML_SUP_GATE=' + w.ML_SUP_GATE)
  say('数据：腾讯 qfq ' + n + ' 根 ' + bars[0].d + '~' + bars[n - 1].d + '｜资金=新浪 r0_net 灌进 flowDaily（console 取末 20 条）｜mv=流通股本×收盘')
  say('方法：与 `s1-single.js` 同 —— 逐日 `bars.slice(0,t+1)` 灌进 `w.G`，调**真实** `w.weekStage()`。')

  say('')
  say('═══════════════════════════════════════')
  say('## 一、四个指定日期（真代码输出）')
  for (const ds of DATES) {
    const t = bars.findIndex(x => x.d === ds)
    say('')
    if (t < 0) { say('⚠️ ' + ds + ' 不是交易日'); continue }
    const m = real(t)
    const wd = ['日', '一', '二', '三', '四', '五', '六'][new Date(ds + 'T00:00:00Z').getUTCDay()]
    say('### ' + ds + '（周' + wd + '）　收盘 ' + fx(bars[t].c) + '　' + fR(bars[t].c / bars[t - 1].c - 1))
    if (!m) { say('　（bar 不足 250 根，引擎返回 null）'); continue }
    say('　**引擎结论：' + m.act + '**（key=`' + m.key + '`，tone=' + m.tone + '）')
    say('　指标：位置分位 ' + fP(m.pos250) + '｜距一年最低 ' + fR(m.premLow) + '｜距20周支撑 ' + fR(m.supDist) +
      '｜距20周压力 ' + fR(m.resDist))
    say('　　　　周MA5 ' + fx(m.wma5) + ' vs 周MA20 ' + fx(m.wma20) + '（' + (m.wma5 > m.wma20 ? '多头' : '空头') + '）' +
      '｜量比 ' + fx(m.volRatio) + '｜资金(20日/流通市值) ' + fR(m.mainRatio) + '　[' + m.flowNote + ']')
    say('　　　　MA5 多头排列 ' + (m.maAlign ? '是' : '否') + '｜连续站上MA5 ' + m.streak5 + ' 日｜偏离MA5 ' + fR(m.overMa5) +
      '｜topWarn ' + m.topWarn + '｜topStrong ' + m.topStrong)
    say('　**操作提示（引擎原文）：**')
    say('　　' + m.advice)
    const f20 = t + 20 < n ? bars[t + 20].c / bars[t].c - 1 : NaN
    const f60 = t + 60 < n ? bars[t + 60].c / bars[t].c - 1 : NaN
    say('　事后：20日 ' + fR(f20) + '｜60日 ' + fR(f60))
  }

  say('')
  say('═══════════════════════════════════════')
  say('## 二、逐日扫描（真代码）2024-06-01 ~ 2025-03-31')
  say('　只列「引擎非 trending」或「topStrong」的日子，以及每月首个交易日')
  let cnt = {}, lastM = ''
  for (let t = 0; t < n; t++) {
    if (bars[t].d < '2024-06-01' || bars[t].d > '2025-03-31') continue
    const m = real(t)
    if (!m) continue
    const sig = m.key !== 'trending' || m.topStrong
    const mon = bars[t].d.slice(0, 7)
    const firstM = mon !== lastM
    if (!sig && !firstM) continue
    lastM = mon
    if (sig) cnt[m.key + (m.topStrong ? '+topStrong' : '')] = (cnt[m.key + (m.topStrong ? '+topStrong' : '')] || 0) + 1
    const f20 = t + 20 < n ? bars[t + 20].c / bars[t].c - 1 : NaN
    say('　' + bars[t].d + '　' + fx(bars[t].c).padStart(6) + '　位置' + (m.pos250 * 100).toFixed(0).padStart(3) + '%' +
      '　距支' + (m.supDist * 100).toFixed(0).padStart(4) + '%　资金' + (m.mainRatio * 100).toFixed(1).padStart(5) + '%' +
      '　' + (m.wma5 > m.wma20 ? '周线多' : '周线空') + '　**' + m.act + '**' +
      (m.topStrong ? '(短热)' : '') + '　后20日 ' + fR(f20))
  }
  say('')
  say('　区间内真代码信号统计：' + Object.entries(cnt).map(([k, v]) => k + ' ' + v + ' 天').join('｜'))

  say('')
  say('═══════════════════════════════════════')
  say('## 三、我上一版复现 vs 真代码（差在哪）')
  say('　上一版 `mw-s1.js` 是我自己重写的规则（含"低位关注/减仓提醒"这两个 **console 里根本没有** 的候选），这里逐日核对。')
  const DIFF = []
  for (let t = 0; t < n; t++) {
    if (bars[t].d < '2024-06-01' || bars[t].d > '2025-03-31') continue
    const m = real(t)
    if (!m) continue
    /* 我的复现（口径B：含当周；资金 20 日）—— 与 mw-s1.js 一致 */
    const c = bars[t].c
    const ret60 = bars[t].c / bars[t - 60].c - 1
    let hi = -Infinity, lo = Infinity
    for (let j = t - 249; j <= t; j++) { if (bars[j].h > hi) hi = bars[j].h; if (bars[j].l < lo) lo = bars[j].l }
    const pos250 = (hi - lo) ? (c - lo) / (hi - lo) : NaN
    const ma = k => { let s = 0; for (let j = t - k + 1; j <= t; j++) s += bars[j].c; return s / k }
    const ma5 = ma(5), ma10 = ma(10), ma20 = ma(20), ma30 = ma(30)
    const align = ma5 > ma10 && ma10 > ma20 && ma20 > ma30
    let streak = 0
    for (let j = t; j >= 0; j--) { let s = 0; for (let q = j - 4; q <= j; q++) s += bars[q].c; const m5 = s / 5; if (bars[j].o > m5 && bars[j].c > m5) streak++; else break }
    const overMa5 = c / ma5 - 1
    let s20 = 0
    { let k = 0; for (let z = t; z >= 0 && k < 20; z--, k++) { const f = flow.filter(x => x.d === bars[z].d)[0]; if (f) s20 += f.main } }
    const mainRatio = s20 / (FS * c)
    const mineBuy = mainRatio > 0.004 && pos250 < 0.4 && m.supDist < 0.15
    const mineBuyStrong = mineBuy && ret60 < 0.15 && m.wma5 > m.wma20 && m.premLow < 0.30
    const mineSell = pos250 > 0.65 && overMa5 > 0.05
    const mineSellStr = mineSell && align && streak >= 2
    const mineKey = mineBuyStrong ? 'accumulate-zone' : (mineSellStr ? 'topStrong' : (mineSell ? 'sell-std(候选)' : (mineBuy ? 'buy-base(候选)' : 'trending')))
    if (mineKey !== m.key && !(mineKey === 'topStrong' && m.key === 'trending' && m.topStrong)) {
      DIFF.push({ d: bars[t].d, real: m.key + (m.topStrong ? '+topStrong' : ''), mine: mineKey,
        pos: pos250, sup: m.supDist, mr: mainRatio, wma: m.wma5 > m.wma20 })
    }
  }
  say('')
  say('　不一致天数：' + DIFF.length + ' 天（共扫描 ' + Object.keys(bars).filter((_, t) => bars[t].d >= '2024-06-01' && bars[t].d <= '2025-03-31').length + ' 天）')
  for (const x of DIFF.slice(0, 40)) {
    say('　　' + x.d + '　真代码=' + x.real + '　我的复现=' + x.mine +
      '　（位置 ' + (x.pos * 100).toFixed(0) + '%｜距支 ' + (x.sup * 100).toFixed(0) + '%｜资金 ' + (x.mr * 100).toFixed(1) + '%｜' + (x.wma ? '周线多' : '周线空') + '）')
  }
  if (DIFF.length > 40) say('　　… 其余 ' + (DIFF.length - 40) + ' 天略')

  fs.writeFileSync(__dirname + '/mw-real-report.md', out.join('\n'), 'utf8')
  console.log('\n→ 已写 _tests/mw-real-report.md')
  process.exit(0)
})().catch(e => { console.log('❌ ' + (e && e.stack || e)); process.exit(1) })
