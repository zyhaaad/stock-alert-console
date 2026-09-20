/* 单只个股 · S1 中长线引擎回放（真跑 console.html 里的 weekStage，不重写逻辑）
 *
 * 目的：用户问「三安光电最近 1 年按 S1 的信号正确率及收益情况」
 * 做法：jsdom 装载 _preview/stock-picker-preview.html（console.html 的构建副本），
 *       逐日把「截至当日」的日K + 资金流 + 流通市值灌进 G，调真实 w.weekStage(code)，
 *       再算该信号日之后的 20/40/60 日收益。
 * ⚠️ 数据口径与 console 里的回测同源（同一份 bt-data.json）：
 *      · 日K：腾讯 qfq 前复权（不复权偏差会污染筹码判定，此路径不涉及筹码）
 *      · 资金：新浪 r0_net 超大单净额（元）作「主力」代理，仅超大单，不含大单
 *      · 流通股本：腾讯 qt f[44] 流通市值 ÷ 现价
 * 用法：node _tests/s1-single.js
 */
'use strict'
const fs = require('fs')
const path = require('path')

const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules'
module.paths.push(WS)
const { JSDOM, VirtualConsole } = require(path.join(WS, 'jsdom'))

const CODE = process.argv[2] || '600703'
const NAMES = { '600703': '三安光电', '000155': '川能动力', '002594': '比亚迪', '601127': '赛力斯',
  '002415': '海康威视', '002714': '牧原股份', '600058': '五矿发展', '600721': '百花医药',
  '600733': '北汽蓝谷', '603026': '石大胜华', '603162': '海通发展', '002349': '精华制药',
  '000762': '西藏矿业', '000767': '晋控电力', '002471': '中超控股', '002577': '雷柏科技',
  '300132': '青松股份' }
const NAME = NAMES[CODE] || CODE
const PREVIEW = 'D:/mywork/_preview/stock-picker-preview.html'
const DATA = 'D:/mywork/_tests/_cache/bt-data.json'
const OUT_MD = 'D:/mywork/_tests/s1-single-' + CODE + '.md'

const data = JSON.parse(fs.readFileSync(DATA, 'utf8'))
const S = data.stocks[CODE]
if (!S) { console.log('缓存里没有 ' + CODE); process.exit(1) }
const bars = S.bars.map(r => ({ d: r[0], o: +r[1], c: +r[2], h: +r[3], l: +r[4], v: +r[5] }))
const fs_ = S.floatShares
const flow = S.flows.map(r => { const p = r.split(','); return { d: p[0], main: Number(p[1]) } })
  .filter(x => isFinite(x.main))

const n = bars.length
const WINDOW = 244                    // 最近 1 年交易日
const tStart = Math.max(249, n - WINDOW)  // weekStage 需要 >=250 根
const tEnd = n - 1

function fwd(t, h) {
  const a = bars[t].c, b = bars[t + h]
  if (!b || t + h > n - 1) return NaN
  return b.c / a - 1
}

function avg(a) { const v = a.filter(isFinite); return v.length ? v.reduce((x, y) => x + y, 0) / v.length : NaN }
function rate(a, f) { const v = a.filter(isFinite); return v.length ? v.filter(f).length / v.length : NaN }
function pct(v) { return isFinite(v) ? (v >= 0 ? '+' : '') + (v * 100).toFixed(2) + '%' : '—' }

;(async () => {
  const html = fs.readFileSync(PREVIEW, 'utf8')
  const errors = []
  const vc = new VirtualConsole()
  vc.on('jsdomError', e => errors.push('jsdomError: ' + (e && e.message)))
  vc.on('error', (...a) => errors.push('console.error: ' + a.join(' ')))
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://stock-alert-console.app.workbuddy.host/', virtualConsole: vc })
  const w = dom.window
  await new Promise(r => setTimeout(r, 700))
  if (errors.length) { console.log('装载报错：' + errors[0]); process.exit(1) }
  if (w.STAGE_VERSION !== 'S2') { console.log('预览里的引擎不是 S2：' + w.STAGE_VERSION); process.exit(1) }
  const secid = w.secidOf({ code: CODE })
  console.log('装载 OK｜引擎 ' + w.STAGE_VERSION + '｜secid ' + secid)

  /* 每日回放 */
  const rows = []
  let fp = 0   // flows 指针
  for (let t = tStart; t <= tEnd; t++) {
    const cur = bars[t].d
    while (fp + 1 < flow.length && flow[fp + 1].d <= cur) fp++
    const fwdFlow = flow.slice(Math.max(0, fp - 30), fp + 1)   // 多给几根，weekStage 只取近 20
    w.G.dayBars = {}; w.G.dayBars[CODE] = bars.slice(0, t + 1)
    w.G.chipMap = {}; w.G.chipMap[CODE] = { flowDaily: fwdFlow.map(x => x.d + ',' + x.main) }
    w.G.quoteMap = {}
    w.G.quoteMap[secid] = { price: bars[t].c, mv: fs_ * bars[t].c }
    const st = w.weekStage(CODE)
    if (!st) continue
    rows.push({
      i: t, d: cur, c: bars[t].c, key: st.key, act: st.act,
      pos250: st.pos250, ret60: st.ret60, volRatio: st.volRatio, mainRatio: st.mainRatio,
      wma5: st.wma5, wma20: st.wma20,
      supDist: st.supDist, resDist: st.resDist, topWarn: st.topWarn, topStrong: st.topStrong, streak5: st.streak5,
      main20: (isFinite(st.mainRatio) && isFinite(fs_ * bars[t].c)) ? st.mainRatio * fs_ * bars[t].c : NaN,
      f20: fwd(t, 20), f40: fwd(t, 40), f60: fwd(t, 60)
    })
  }
  console.log('回放区间 ' + rows[0].d + ' ~ ' + rows[rows.length - 1].d + '｜共 ' + rows.length + ' 个交易日')

  /* 状态分布 */
  const KEYS = [['accumulate-zone', '主力建仓区（跟）'], ['sell-overheat', '高位过热·减仓（躲）'],
    ['fall-not-done', '下跌未完·勿抄（躲）'], ['trending', '趋势运行中（中性）']]
  const byKey = {}
  KEYS.forEach(([k]) => { byKey[k] = rows.filter(r => r.key === k) })
  const bench = { f20: avg(rows.map(r => r.f20)), f40: avg(rows.map(r => r.f40)), f60: avg(rows.map(r => r.f60)) }

  /* 信号事件（同一状态连续只算一次，取起始日） */
  const events = []
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].key === 'trending') continue
    if (i > 0 && rows[i - 1].key === rows[i].key) continue
    events.push(rows[i])
  }

  const L = []
  L.push('# ' + NAME + '（' + CODE + '）· S1 中长线引擎 1 年回放')
  L.push('')
  L.push('- 引擎：console.html 真代码 `weekStage`（STAGE_VERSION=' + w.STAGE_VERSION + '），jsdom 装载预览副本逐步回放，未重写逻辑')
  L.push('- 数据：腾讯 qfq 日K（' + bars[0].d + '~' + bars[n - 1].d + '）｜资金用新浪 r0_net 超大单净额作主力代理（' + flow[0].d + '~' + flow[flow.length - 1].d + '）｜流通股本 ' + (fs_ / 1e8).toFixed(2) + ' 亿股')
  L.push('- 回放窗口：' + rows[0].d + ' ~ ' + rows[rows.length - 1].d + '（' + rows.length + ' 个交易日）')
  L.push('- 生成时间：' + new Date().toISOString())
  L.push('')
  L.push('## 一、状态分布')
  L.push('')
  L.push('| 状态 | 天数 | 占比 |')
  L.push('|---|---:|---:|')
  KEYS.forEach(([k, label]) => {
    L.push('| ' + label + ' | ' + byKey[k].length + ' | ' + (byKey[k].length / rows.length * 100).toFixed(1) + '% |')
  })
  L.push('')
  L.push('## 二、分状态收益（信号日之后）')
  L.push('')
  L.push('| 状态 | n | 20日均值 | 20日胜率 | 40日均值 | 60日均值 | 60日胜率 | 60日跌超5% |')
  L.push('|---|---:|---:|---:|---:|---:|---:|---:|')
  KEYS.forEach(([k, label]) => {
    const g = byKey[k]
    if (!g.length) { L.push('| ' + label + ' | 0 | — | — | — | — | — | — |'); return }
    L.push('| ' + label + ' | ' + g.length + ' | ' + pct(avg(g.map(r => r.f20))) + ' | ' +
      pct(rate(g.map(r => r.f20), v => v > 0)) + ' | ' + pct(avg(g.map(r => r.f40))) + ' | ' +
      pct(avg(g.map(r => r.f60))) + ' | ' + pct(rate(g.map(r => r.f60), v => v > 0)) + ' | ' +
      pct(rate(g.map(r => r.f60), v => v < -0.05)) + ' |')
  })
  L.push('| **基准（全窗口所有交易日）** | ' + rows.length + ' | ' + pct(bench.f20) + ' | — | ' + pct(bench.f40) + ' | ' + pct(bench.f60) + ' | — | — |')
  L.push('')
  /* 事件级：最大不利/有利偏移（60 日内），以及未满 60 日的「到目前」收益 */
  events.forEach(e => {
    const t = e.i, entry = bars[t].c
    let lo = Infinity, hi = -Infinity, end = Math.min(t + 60, n - 1)
    for (let k = t + 1; k <= end; k++) {
      if (bars[k].l < lo) lo = bars[k].l
      if (bars[k].h > hi) hi = bars[k].h
    }
    e.daysHeld = end - t
    e.mae = isFinite(lo) ? lo / entry - 1 : NaN
    e.mfe = isFinite(hi) ? hi / entry - 1 : NaN
    e.fEnd = bars[end].c / entry - 1
    e.endDate = bars[end].d
    /* 位置体检：这个「低位」到底低不低 —— 距近一年最低价还有多远 */
    let lo250 = Infinity
    for (let k = Math.max(0, t - 249); k <= t; k++) { if (bars[k].l < lo250) lo250 = bars[k].l }
    e.low250 = lo250
    e.premLow = isFinite(lo250) ? entry / lo250 - 1 : NaN   /* supDist/resDist 由引擎直接给出 */
  })

  L.push('## 三、信号事件明细（同状态连续只记首次）')
  L.push('')
  L.push('| 触发日 | 状态 | 收盘 | 一年位置 | 60日涨跌 | 周量能比 | 20日主力/流通市值 | 后20日 | 后60日 | 60日内最大浮亏 | 60日内最大浮盈 |')
  L.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
  events.forEach(r => {
    L.push('| ' + r.d + ' | ' + r.act + ' | ' + r.c.toFixed(2) + ' | ' +
      (isFinite(r.pos250) ? (r.pos250 * 100).toFixed(0) + '%' : '—') + ' | ' + pct(r.ret60) + ' | ' +
      (isFinite(r.volRatio) ? r.volRatio.toFixed(2) : '—') + ' | ' +
      (isFinite(r.mainRatio) ? (r.mainRatio * 100).toFixed(2) + '%' : '—') + ' | ' +
      pct(r.f20) + ' | ' + (isFinite(r.f60) ? pct(r.f60) : '未满60日（至 ' + r.endDate + '，' + r.daysHeld + ' 日 ' + pct(r.fEnd) + '）') + ' | ' +
      pct(r.mae) + ' | ' + pct(r.mfe) + ' |')
  })
  if (!events.length) L.push('| — | 无（全年未触发任何关键位置） | | | | | | | | | | |')
  L.push('')
  L.push('## 三之二、按「事件」而非「按天」算的命中率（避免重叠天数虚增样本）')
  L.push('')
  ;[['accumulate-zone', '建仓区（看多 → 60 日后应上涨）'], ['sell-overheat', '高位过热·减仓（看空 → 60 日后应下跌）'],
    ['fall-not-done', '下跌未完（看空 → 60 日后应下跌）']].forEach(([k, label]) => {
    const ev = events.filter(e => e.key === k && isFinite(e.f60))
    const pend = events.filter(e => e.key === k && !isFinite(e.f60))
    const hit = ev.filter(e => (k === 'accumulate-zone' ? e.f60 > 0 : e.f60 < 0)).length
    L.push('- **' + label + '**：已满 60 日的事件 ' + ev.length + ' 个，命中 ' + hit + ' 个' +
      (ev.length ? '（' + (hit / ev.length * 100).toFixed(0) + '%），60日收益 ' + ev.map(e => e.d + ' ' + pct(e.f60)).join('、') : '') +
      (pend.length ? '；另有 ' + pend.length + ' 个未满 60 日（' + pend.map(e => e.d).join('、') + '）' : ''))
  })
  L.push('')
  /* 位置体检：建仓区说的「低位」是不是真的低 */
  const accs = events.filter(e => e.key === 'accumulate-zone')
  if (accs.length) {
    L.push('- 建仓区**位置体检**（距一年最低价 / 距近 20 周最低价）：' +
      accs.map(e => e.d + ' 收 ' + e.c.toFixed(2) + '｜距一年低点 ' + e.low250.toFixed(2) + ' 的 **' + pct(e.premLow) +
        '**｜距 20 周支撑 **' + (isFinite(e.supDist) ? pct(e.supDist) : '—') + '**｜位置分位 ' +
        (isFinite(e.pos250) ? (e.pos250 * 100).toFixed(0) + '%' : '—')).join('；'))
    const bad = accs.filter(e => e.premLow > 0.3)
    if (bad.length) L.push('  - ⚠️ ' + bad.length + '/' + accs.length + ' 个建仓区事件里，价格已高出一年低点 30% 以上 —— **位置分位被「暴涨后的高点」撑大了**。')
  }
  L.push('')
  L.push('## 四、当前状态（' + rows[rows.length - 1].d + '）')
  L.push('')
  const last = rows[rows.length - 1]
  L.push('- 状态：**' + last.act + '**（key=' + last.key + '）')
  L.push('- 一年位置 ' + (isFinite(last.pos250) ? (last.pos250 * 100).toFixed(1) + '%' : '—') +
    '｜60日涨跌 ' + pct(last.ret60) + '｜周量能比 ' + (isFinite(last.volRatio) ? last.volRatio.toFixed(2) : '—') +
    '｜20日主力/流通市值 ' + (isFinite(last.mainRatio) ? (last.mainRatio * 100).toFixed(3) + '%' : '—'))
  const bull = isFinite(last.wma5) && isFinite(last.wma20) ? last.wma5 > last.wma20 : null
  L.push('- 周线结构：周MA5 ' + (isFinite(last.wma5) ? last.wma5.toFixed(2) : '—') + ' vs 周MA20 ' +
    (isFinite(last.wma20) ? last.wma20.toFixed(2) : '—') + ' → **' + (bull === null ? '数据不足' : bull ? '多头（周MA5 在周MA20 上方）' : '空头（周MA5 在周MA20 下方）') + '**')
  /* 建仓区四条件逐条体检：解释"低位+资金进来了却没出信号"这类情况 */
  if (last.key !== 'accumulate-zone') {
    L.push('- 建仓区四条件体检：主力净流入>0.4% ' + (isFinite(last.mainRatio) ? (last.mainRatio > 0.004 ? '✅' : '❌ ' + (last.mainRatio * 100).toFixed(3) + '%') : '—') +
      '｜近一年位置<40% ' + (isFinite(last.pos250) ? (last.pos250 < 0.4 ? '✅' : '❌ ' + (last.pos250 * 100).toFixed(1) + '%') : '—') +
      '｜60日涨跌<+15% ' + (isFinite(last.ret60) ? (last.ret60 < 0.15 ? '✅' : '❌ ' + pct(last.ret60)) : '—') +
      '｜周MA5>周MA20 ' + (bull === null ? '—' : bull ? '✅' : '❌'))
  }
  L.push('- 基准（买入持有）：' + rows[0].d + ' 收 ' + rows[0].c.toFixed(2) + ' → ' + last.d + ' 收 ' + last.c.toFixed(2) +
    '，区间 ' + pct(last.c / rows[0].c - 1))
  L.push('')

  /* 五、如果真按 S1 操作 */
  const buys = events.filter(e => e.key === 'accumulate-zone').map(e => e.i)
  L.push('## 五、按 S1 操作的收益（简化口径：建仓区首次触发日收盘买入，持有 60 个交易日）')
  L.push('')
  if (!buys.length) L.push('- 全窗口没有出现「主力建仓区」，按规则不该买 → 全年空仓。')
  else {
    const tr = buys.map(t => ({ d: bars[t].d, r: (bars[Math.min(t + 60, n - 1)].c / bars[t].c - 1), full: t + 60 <= n - 1 }))
    let cum = 1
    tr.forEach(x => { cum *= (1 + x.r) })
    L.push('| 买入日 | 持有至 | 收益 |')
    L.push('|---|---|---:|')
    tr.forEach((x, k) => L.push('| ' + x.d + ' | ' + (x.full ? '满 60 日' : '未满 60 日') + ' | ' + pct(x.r) + ' |'))
    L.push('| **累计（' + tr.length + ' 笔）** | | **' + pct(cum - 1) + '** |')
    L.push('')
    L.push('- 同期买入持有：**' + pct(last.c / rows[0].c - 1) + '**')
    L.push('- ⚠️ 只有 ' + tr.length + ' 笔交易，任何"胜率/收益率"都谈不上统计显著，只能当个案看。')
  }
  L.push('')

  /* 六、这一年 S1 漏掉了什么（最关键的一节） */
  let pk = rows[0]
  rows.forEach(r => { if (r.c > pk.c) pk = r })
  L.push('## 六、这一年 S1 漏掉了什么（必须看的反面）')
  L.push('')
  L.push('- 区间最高收盘 **' + pk.c.toFixed(2) + '（' + pk.d + '）**，当天状态：**' + pk.act + '**。')
  const afterIdx = bars.findIndex(b => b.d === pk.d)
  const after = bars.slice(afterIdx)
  if (after.length > 1) {
    const tail = after[after.length - 1]
    const disAfter = rows.filter(r => r.d >= pk.d && r.key === 'sell-overheat').length
    L.push('- 从该峰值到 ' + tail.d + '（' + tail.c.toFixed(2) + '）：**' + pct(tail.c / pk.c - 1) + '**；这段期间「高位过热·减仓」出现 **' + disAfter + ' 天**。')
  }
  const pre = rows.filter(r => r.d <= pk.d)
  let mn = pre[0]
  pre.forEach(r => { if (r.c < mn.c) mn = r })
  const adv = pk.c / mn.c - 1
  if (adv > 0.2) {
    L.push('- 峰值前的最低收盘 ' + mn.c.toFixed(2) + '（' + mn.d + '）→ 最高收盘 ' + pk.c.toFixed(2) + '（' + pk.d + '）：**' + pct(adv) + '** 的一整段上涨。')
    const riseDays = rows.filter(r => r.d >= mn.d && r.d <= pk.d)
    const riseTrend = riseDays.filter(r => r.key === 'trending').length
    L.push('- 这段上涨共 ' + riseDays.length + ' 个交易日，其中 **' + riseTrend + ' 天（' + (riseTrend / riseDays.length * 100).toFixed(0) + '%）显示「趋势运行中·无需操作」** —— 设计上就是不给操作，代价是没有加仓提示。')
  } else {
    L.push('- 这一年没有像样的主升段（峰值前最低 → 峰值的涨幅仅 ' + pct(adv) + '），主要问题是**下跌段没给预警**。')
  }
  L.push('- 全年关键态天数：「高位过热·减仓」' + byKey['sell-overheat'].length + ' 天、「下跌未完」' + byKey['fall-not-done'].length +
    ' 天、「主力建仓区」' + byKey['accumulate-zone'].length + ' 天。')
  L.push('')

  /* 七、状态切换时间线（看引擎是否稳定） */
  const runs = []
  rows.forEach(r => {
    const lastRun = runs[runs.length - 1]
    if (lastRun && lastRun.key === r.key) { lastRun.end = r.d; lastRun.days++ }
    else runs.push({ key: r.key, act: r.act, start: r.d, end: r.d, days: 1 })
  })
  L.push('## 七、状态切换时间线（' + runs.length + ' 段）')
  L.push('')
  L.push('| # | 状态 | 起 | 止 | 交易日 |')
  L.push('|---:|---|---|---|---:|')
  runs.forEach((r, i) => L.push('| ' + (i + 1) + ' | ' + r.act + ' | ' + r.start + ' | ' + r.end + ' | ' + r.days + ' |'))
  const keyRuns = runs.filter(r => r.key !== 'trending')
  L.push('')
  L.push('- 关键位置区间共 **' + keyRuns.length + ' 段 / ' + keyRuns.reduce((a, r) => a + r.days, 0) + ' 个交易日**，其余 ' +
    runs.filter(r => r.key === 'trending').reduce((a, r) => a + r.days, 0) + ' 天均显示「趋势运行中」。')
  const recent = runs[runs.length - 3]
  if (recent && recent.key !== 'trending') {
    L.push('- ⚠️ 近月出现**状态闪烁**（同一关键态被「趋势运行中」打断，共 ' + keyRuns.slice(-3).length + ' 段）：' +
      keyRuns.slice(-3).map(r => r.act + '(' + r.start + '~' + r.end + '，' + r.days + '天)').join(' → 回落到趋势运行中 → ') +
      ' —— 关键位置态并不总是稳定驻留，中长线使用者不必每天刷新。')
  }
  L.push('')

  /* 八、局限 */
  L.push('## 八、这份结果的局限（别当结论用）')
  L.push('')
  L.push('- **单只股、1 年**：' + rows.length + ' 个交易日、' + events.length + ' 个事件。console 里 17 只 × 5440 点的口径，落到单只单年，样本量差 2 个数量级。')
  L.push('- **按天统计会虚增样本**：建仓区 ' + byKey['accumulate-zone'].length + ' 天，其实只是 ' +
    runs.filter(r => r.key === 'accumulate-zone').length + ' 段连续行情，重叠的前瞻窗口互相包含。上面「三之二」按事件算才是真实命中率。')
  L.push('- **资金是代理口径**：新浪 r0 = 超大单净额，不含大单；console/线上用东财「大单+超大单」。两者方向一致率约 75%，所以 mainRatio 这个维度的数值不能与线上直接对齐。')
  L.push('- **mv 用当期流通市值**：线上取的是「今天的流通市值」，回放里我按当日收盘价折算，比例口径略有差异。')
  L.push('- **无未来函数**：每一步只喂 bars[0..t] 与日期 ≤ t 的资金流，pos250/周线/量比全部只用历史。')

  fs.writeFileSync(OUT_MD, L.join('\n'), 'utf8')
  console.log('\n' + L.join('\n'))
  console.log('\n→ 已写 ' + OUT_MD)

  /* 供后续引用 */
  fs.writeFileSync('D:/mywork/_tests/_cache/s1-single-' + CODE + '.json',
    JSON.stringify({ code: CODE, name: NAME, generatedAt: new Date().toISOString(),
      window: [rows[0].d, last.d], bench: bench,
      events: events.map(e => ({ d: e.d, key: e.key, act: e.act, f20: e.f20, f40: e.f40, f60: e.f60,
        daysHeld: e.daysHeld, mae: e.mae, mfe: e.mfe, fEnd: e.fEnd, endDate: e.endDate })),
      last: last }, null, 1))
  process.exit(0)
})()
