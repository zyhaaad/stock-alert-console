/* S1 改后全量重验（2026-09-20）——用**改后的真代码**把 17 只逐日回放，出总表
 * 重点覆盖用户自选：600703 三安光电 / 000767 晋控电力 / 603026 石大胜华 / 000762 西藏矿业 / 000155 川能动力
 * 用法：node _tests/s1-all-check.js
 */
'use strict'
const fs = require('fs')
const path = require('path')
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules'
module.paths.push(WS)
const { JSDOM, VirtualConsole } = require(path.join(WS, 'jsdom'))

const NAMES = { '600703': '三安光电', '000155': '川能动力', '002594': '比亚迪', '601127': '赛力斯',
  '002415': '海康威视', '002714': '牧原股份', '600058': '五矿发展', '600721': '百花医药',
  '600733': '北汽蓝谷', '603026': '石大胜华', '603162': '海通发展', '002349': '精华制药',
  '000762': '西藏矿业', '000767': '晋控电力', '002471': '中超控股', '002577': '雷柏科技', '300132': '青松股份' }
const WATCH = ['600703', '000767', '603026', '000762', '000155']

const data = JSON.parse(fs.readFileSync('D:/mywork/_tests/_cache/bt-data.json', 'utf8')).stocks
const codes = Object.keys(data)
const fR = x => (x !== null && isFinite(x)) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '—'
const mean = a => { const v = a.filter(x => isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN }

;(async () => {
  const html = fs.readFileSync('D:/mywork/_preview/stock-picker-preview.html', 'utf8')
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://stock-alert-console.app.workbuddy.host/', virtualConsole: new VirtualConsole() })
  const w = dom.window
  await new Promise(r => setTimeout(r, 700))
  if (w.STAGE_VERSION !== 'S2') { console.log('预览不是 S2：' + w.STAGE_VERSION); process.exit(1) }

  const out = []
  const say = s => { out.push(s); console.log(s) }
  say('# S1 改后全量重验（引擎 ' + w.STAGE_VERSION + '，两道位置闸门 + 周级支撑/压力 + 阶段顶部辅助）')
  say('')
  say('回放窗口 2025-09-17 ~ 2026-09-18（244 交易日）｜数据：腾讯 qfq 日K + 新浪 r0 超大单代理')
  say('')
  say('## 一、当前结论总表（' + '2026-09-18' + ' 收盘）')
  say('')
  say('| 股票 | 当前状态 | 一年位置 | 距周级支撑 | 距周级压力 | 60日涨跌 | 周量能比 | 20日主力/流通市值 | 短期热度 |')
  say('|---|---|---:|---:|---:|---:|---:|---:|---|')

  const detail = {}
  for (const code of codes) {
    const S = data[code]
    const bars = S.bars.map(r => ({ d: r[0], o: +r[1], c: +r[2], h: +r[3], l: +r[4], v: +r[5] }))
    const flow = S.flows.map(r => { const p = r.split(','); return { d: p[0], main: Number(p[1]) } })
    const fs_ = S.floatShares, secid = w.secidOf({ code: code })
    const n = bars.length, t0 = Math.max(249, n - 244)
    const rows = []
    let fp = 0
    for (let t = t0; t <= n - 1; t++) {
      const cur = bars[t].d
      while (fp + 1 < flow.length && flow[fp + 1].d <= cur) fp++
      w.G.dayBars = {}; w.G.dayBars[code] = bars.slice(0, t + 1)
      w.G.chipMap = {}; w.G.chipMap[code] = { flowDaily: flow.slice(Math.max(0, fp - 30), fp + 1).map(x => x.d + ',' + x.main) }
      w.G.quoteMap = {}; w.G.quoteMap[secid] = { price: bars[t].c, mv: fs_ * bars[t].c }
      const st = w.weekStage(code)
      if (!st) continue
      rows.push({ i: t, d: cur, c: bars[t].c, key: st.key, act: st.act, pos250: st.pos250,
        supDist: st.supDist, resDist: st.resDist, ret60: st.ret60, volRatio: st.volRatio, mainRatio: st.mainRatio,
        topWarn: st.topWarn, topStrong: st.topStrong, streak5: st.streak5,
        f60: t + 60 <= n - 1 ? bars[t + 60].c / bars[t].c - 1 : NaN })
    }
    if (!rows.length) continue
    const last = rows[rows.length - 1]
    detail[code] = { rows, last }
    const star = WATCH.includes(code) ? '★ ' : ''
    say('| ' + star + NAMES[code] + '(' + code + ') | ' + last.act +
      (last.topStrong ? ' ⚠️短期偏热' : last.topWarn ? ' · 短期偏热(未达减仓线)' : '') + ' | ' +
      (isFinite(last.pos250) ? (last.pos250 * 100).toFixed(0) + '%' : '—') + ' | ' +
      (isFinite(last.supDist) ? fR(last.supDist) : '—') + ' | ' +
      (isFinite(last.resDist) ? fR(last.resDist) : '—') + ' | ' + fR(last.ret60) + ' | ' +
      (isFinite(last.volRatio) ? last.volRatio.toFixed(2) : '—') + ' | ' +
      (isFinite(last.mainRatio) ? fR(last.mainRatio) : '—') + ' | ' +
      (last.topWarn ? last.streak5 + ' 日站上MA5' : '正常') + ' |')
  }

  /* 二、与改前的差异：哪些股票不再喊建仓区、哪些保持不变 */
  say('')
  say('## 二、改前 → 改后：建仓区信号变化（逐只）')
  say('')
  say('| 股票 | 建仓区天数(改后) | 事件数 | 事件后60日 | 说明 |')
  say('|---|---:|---:|---|---|')
  for (const code of codes) {
    const d = detail[code]; if (!d) continue
    const acc = d.rows.filter(r => r.key === 'accumulate-zone')
    const evs = []
    for (let k = 0; k < acc.length; k++) if (k === 0 || acc[k - 1].key !== acc[k].key || acc[k].d !== acc[k - 1].d) {
      if (k === 0 || !(acc[k].i === acc[k - 1].i + 1)) evs.push(acc[k])
    }
    say('| ' + NAMES[code] + '(' + code + ') | ' + acc.length + ' | ' + evs.length + ' | ' +
      (evs.length ? evs.map(e => e.d + ' ' + fR(e.f60)).join('、') : '—') + ' | ' +
      (acc.length ? (acc[0].supDist < 0.15 ? '全部满足「距20周支撑<15%」' : '样本未过支撑闸门（不应出现）') : '不再出建仓区') + ' |')
  }

  /* 三、用户自选 5 只的明细 */
  say('')
  say('## 三、你的自选 5 只 · 全年关键位置时间线')
  for (const code of WATCH) {
    const d = detail[code]; if (!d) { say('- ' + code + '：无数据'); continue }
    say('')
    say('**' + NAMES[code] + '(' + code + ')**')
    const runs = []
    d.rows.forEach(r => {
      const p = runs[runs.length - 1]
      if (p && p.key === r.key) { p.end = r.d; p.n++ } else runs.push({ key: r.key, act: r.act, start: r.d, end: r.d, n: 1 })
    })
    const keys = runs.filter(r => r.key !== 'trending')
    if (!keys.length) say('- 全年只有「趋势运行中」，无关键位置提示。')
    else keys.forEach(r => say('- ' + r.act + '：' + r.start + ' ~ ' + r.end + '（' + r.n + ' 个交易日）'))
  }

  fs.writeFileSync('D:/mywork/_tests/s1-after-report.md', out.join('\n'), 'utf8')
  console.log('\n→ 已写 _tests/s1-after-report.md')
  process.exit(0)
})().catch(e => { console.log('❌ ' + (e && e.message || e)); process.exit(1) })
