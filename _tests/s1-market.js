/* S2 · 「大盘维度」增量回测 —— 全 17 只，区间/天级，不挑阈值
 *
 * 背景（用户 2026-09-20 拍板「接已建好未接的模块」，大盘风格 = style.js 的七档判定）：
 *   ⚠️ **style.js 的存档 style-history.json 最早只有 2026-09-19**，没有历史 → 七档判定**无法回测**。
 *   所以本脚本先用**可回测的大盘代理**回答同一个问题：加上市场环境，到底有没有增量？
 *   代理一律取最朴素的、不带拟合的形态：
 *     · 上证收盘 在 MA20 上/下（趋势方向）
 *     · 上证收盘 在 MA60 上/下（中期方向）
 *     · 上证近 20 日涨跌（连续，按中位数切半天）
 *     · 上证在近 250 日高低区间的分位（连续，按中位数切半天）
 *   只要代理都没增量，接七档判定就更没理由（七档比代理更复杂、更容易过拟合）。
 *
 * 纪律：按中位数切半天，不扫阈值；同时报按天 n 与覆盖只数（按天会因重叠窗口虚增样本）。
 * ⚠️ 必须先跑 build-preview。用法：node _tests/s1-market.js → _tests/s1-market-report.md
 */
'use strict'
const fs = require('fs')
const path = require('path')
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules'
module.paths.push(WS)
const { JSDOM, VirtualConsole } = require(path.join(WS, 'jsdom'))

const PREVIEW = 'D:/mywork/_preview/stock-picker-preview.html'
const raw = JSON.parse(fs.readFileSync(__dirname + '/_cache/bt-data.json', 'utf8')).stocks
const idxRaw = JSON.parse(fs.readFileSync(__dirname + '/_cache/bt-index.json', 'utf8')).index
/* 恐贪指数：用户自己的指标，fng-history.json 有 750 天历史（2023-08-15 起）→ 可回测 */
let fngMap = {}
try {
  const fng = JSON.parse(fs.readFileSync('D:/mywork/stock-alert-cloud/fng-history.json', 'utf8'))
  const arr = Array.isArray(fng) ? fng : (fng.days || fng.history || [])
  arr.forEach(r => { fngMap[r[0]] = Number(r[1]) })
} catch (e) { console.log('⚠️ fng-history 读不到：' + e.message) }
const FNG_N = Object.keys(fngMap).length
const fngDates = Object.keys(fngMap).sort()
const codes = Object.keys(raw)
const WARM = 260

/* 恐贪的「上一次取值」：恐贪存档到 2026-09-16，最后几天用 9-16 的值近似（并如实标注）*/
function fngAt(d) {
  if (Object.prototype.hasOwnProperty.call(fngMap, d)) return fngMap[d]
  let lo = 0, hi = fngDates.length - 1, best = -1
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (fngDates[mid] <= d) { best = mid; lo = mid + 1 } else hi = mid - 1 }
  return best >= 0 ? fngMap[fngDates[best]] : NaN
}

const mean = a => { const v = a.filter(isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN }
const med = a => { const v = a.filter(isFinite).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN }
const fR = x => isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%' : '—'
const fP = x => isFinite(x) ? (x * 100).toFixed(0) + '%' : '—'
const f2 = x => isFinite(x) ? x.toFixed(2) : '—'

/* 指数 → 按日期索引的指标 */
function idxSeries(code) {
  const arr = idxRaw[code] || []
  const byDate = {}, closes = []
  arr.forEach(r => { byDate[r[0]] = { c: r[2], h: r[3], l: r[4] }; closes.push(r[2]) })
  const dates = arr.map(r => r[0])
  const out = {}
  for (let i = 0; i < dates.length; i++) {
    const d = dates[i]
    const ma = n => (i - n + 1 >= 0) ? mean(closes.slice(i - n + 1, i + 1)) : NaN
    const ma20 = ma(20), ma60 = ma(60)
    const ret20 = (i - 20 >= 0) ? closes[i] / closes[i - 20] - 1 : NaN
    let hi = -Infinity, lo = Infinity
    for (let j = Math.max(0, i - 249); j <= i; j++) { if (arr[j][3] > hi) hi = arr[j][3]; if (arr[j][4] < lo) lo = arr[j][4] }
    out[d] = {
      c: closes[i],
      above20: isFinite(ma20) ? (closes[i] > ma20 ? 1 : 0) : NaN,
      above60: isFinite(ma60) ? (closes[i] > ma60 ? 1 : 0) : NaN,
      ret20: ret20,
      pos250: (isFinite(hi) && isFinite(lo) && hi > lo) ? (closes[i] - lo) / (hi - lo) : NaN
    }
  }
  return out
}

;(async () => {
  const vc = new VirtualConsole()
  const dom = new JSDOM(fs.readFileSync(PREVIEW, 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://stock-alert-console.app.workbuddy.host/', virtualConsole: vc })
  const w = dom.window
  await new Promise(r => setTimeout(r, 700))
  if (w.STAGE_VERSION !== 'S2') { console.log('预览引擎不是 S2：' + w.STAGE_VERSION); process.exit(1) }

  const out = []
  const say = s => { out.push(s); console.log(s) }
  const IDX = idxSeries('sh000001')
  const IDXD = idxSeries('sz399001')

  say('# S2 · 「大盘维度」增量回测（接风格驾驶舱值不值）')
  say('')
  say('引擎 STAGE_VERSION=' + w.STAGE_VERSION + '｜样本 ' + codes.length + ' 只（2024-01-29~2026-09-18 区间内可评估部分）')
  say('数据：腾讯 ifzq 前复权日K（指数同源）｜大盘代理一律取最朴素形态，**不扫阈值**')
  say('')
  say('⚠️ 前置事实：**风格驾驶舱 style.js 的存档最早只有 2026-09-19**（上线日）、**只有 1 天**，')
  say('   没有历史 → 七档判定**完全无法回测**。所以先用可回测的代理回答同一个问题：加市场环境有没有增量。')
  say('   另加一条**可回测**的市场维度：恐贪指数（fng-history.json，' + FNG_N + ' 天，最早 ' + (fngDates[0] || '-') + '）——')
  say('   这是用户自己的指标，有历史、能验证；风格七档要等它自己攒够历史才谈得上回测。')
  say('')

  const rows = []
  let noIdx = 0
  for (const code of codes) {
    const st = raw[code]
    const bars = st.bars.map(r => ({ d: r[0], o: +r[1], c: +r[2], h: +r[3], l: +r[4], v: +r[5] }))
    const flow = st.flows.map(r => { const p = r.split(','); return { d: p[0], main: Number(p[1]) } }).filter(x => isFinite(x.main))
    const secid = w.secidOf({ code })
    for (let t = WARM; t < bars.length; t++) {
      const cur = bars[t].d
      const mk = IDX[cur]
      if (!mk) { noIdx++; continue }
      const fd = flow.filter(x => x.d <= cur).slice(-30)
      w.G.dayBars = {}; w.G.dayBars[code] = bars.slice(0, t + 1)
      w.G.chipMap = {}; w.G.chipMap[code] = { flowDaily: fd.map(x => x.d + ',' + x.main), floatShares: st.floatShares }
      w.G.quoteMap = {}; w.G.quoteMap[secid] = { price: bars[t].c, mv: st.floatShares * bars[t].c }
      const m = w.weekStage(code)
      if (!m) continue
      const fwd = h => (t + h < bars.length) ? bars[t + h].c / bars[t].c - 1 : NaN
      const dmk = IDXD[cur] || {}
      rows.push({ code: code, d: cur, key: m.key, f20: fwd(20), f60: fwd(60), ret60: m.ret60,
        above20: mk.above20, above60: mk.above60, mRet20: mk.ret20, mPos: mk.pos250,
        dAbove20: dmk.above20, dRet20: dmk.ret20, fng: fngAt(cur) })
    }
  }
  say('有效样本 ' + rows.length + ' 个交易日（指数缺当日数据的跳过 ' + noIdx + ' 次）')
  say('基准（全样本 60 日）：' + fR(mean(rows.map(r => r.f60))))
  say('大盘环境分布（上证）：在 MA20 上方 ' + fP(rows.filter(r => r.above20 === 1).length / rows.length) +
    '｜在 MA60 上方 ' + fP(rows.filter(r => r.above60 === 1).length / rows.length) +
    '｜近 250 日分位中位 ' + f2(med(rows.map(r => r.mPos))))
  say('')

  function line(label, sub) {
    const v = sub.filter(r => isFinite(r.f60))
    if (!v.length) return label.padEnd(30) + 'n=0'
    const cov = new Set(v.map(r => r.code)).size
    const pos = v.filter(r => r.f60 > 0).length / v.length
    const big = v.filter(r => r.f60 < -0.05).length / v.length
    return label.padEnd(30) + 'n=' + String(v.length).padStart(5) +
      '  只=' + cov + '/' + codes.length +
      '  20日 ' + fR(mean(v.map(r => r.f20))).padStart(7) +
      '  60日 ' + fR(mean(v.map(r => r.f60))).padStart(7) +
      '  涨/胜率 ' + fP(pos).padStart(4) + '  跌超5% ' + fP(big).padStart(4)
  }
  function splitCont(label, base, keyFn) {
    const v = base.filter(r => isFinite(keyFn(r)))
    if (v.length < 20) { say('  ' + label + '：样本太少（' + v.length + '），跳过'); return }
    const m = med(v.map(keyFn))
    say('  ── ' + label + '：中位 ' + f2(m) + '，按它切半天 ──')
    say('  ' + line('  全部', v))
    say('  ' + line('  < 中位（低）', v.filter(r => keyFn(r) < m)))
    say('  ' + line('  ≥ 中位（高）', v.filter(r => keyFn(r) >= m)))
    say('')
  }
  function splitBin(label, base, keyFn, nameA, nameB) {
    const v = base.filter(r => isFinite(keyFn(r)))
    if (!v.length) { say('  ' + label + '：无样本'); return }
    say('  ── ' + label + ' ──')
    say('  ' + line('  全部', v))
    say('  ' + line('  ' + nameA, v.filter(r => keyFn(r) === 1)))
    say('  ' + line('  ' + nameB, v.filter(r => keyFn(r) === 0)))
    say('')
  }

  const SELL = rows.filter(r => r.key === 'sell-overheat')
  const BUY = rows.filter(r => r.key === 'accumulate-zone')

  say('════════ 一、大盘环境 × 卖点「高位过热」════════')
  say('看 60 日 —— 卖点要的是「之后跌」，越低越好。基线：')
  say('  ' + line('  现行卖点（全部）', SELL))
  say('')
  splitBin('上证 在 MA20 上/下', SELL, r => r.above20, '在 MA20 上方', '在 MA20 下方')
  splitBin('上证 在 MA60 上/下', SELL, r => r.above60, '在 MA60 上方', '在 MA60 下方')
  splitCont('上证近 20 日涨跌', SELL, r => r.mRet20)
  splitCont('上证近 250 日分位', SELL, r => r.mPos)
  splitCont('★ 恐贪指数（可回测、且是你自己的指标）', SELL, r => r.fng)

  say('════════ 二、大盘环境 × 买点「主力建仓区」════════')
  say('看 60 日 —— 买点要的是「之后涨」，越高越好。基线：')
  say('  ' + line('  现行建仓区（全部）', BUY))
  say('')
  splitBin('上证 在 MA20 上/下', BUY, r => r.above20, '在 MA20 上方', '在 MA20 下方')
  splitBin('上证 在 MA60 上/下', BUY, r => r.above60, '在 MA60 上方', '在 MA60 下方')
  splitCont('上证近 20 日涨跌', BUY, r => r.mRet20)
  splitCont('上证近 250 日分位', BUY, r => r.mPos)
  splitCont('★ 恐贪指数（可回测、且是你自己的指标）', BUY, r => r.fng)

  say('════════ 三、结论怎么看（判据）════════')
  say('- 若「上/下」两侧 60 日差距 < 3pp，视为**没有增量**，不接进触发条件。')
  say('- 若差距大但**方向与直觉相反**，同样不接（17 只太少，很可能是样本内噪音）。')
  say('- 只有「差距明显 + 方向符合机制 + 不靠单只股票撑住」三条都成立才值得接，且必须重新回测。')
  say('- ⚠️ 卖点基线只有 ' + SELL.length + ' 天、建仓区只有 ' + BUY.length + ' 天，再切分后每边更小，别当显著差异。')

  fs.writeFileSync(__dirname + '/s1-market-report.md', out.join('\n') + '\n')
  console.log('\n→ 已写 _tests/s1-market-report.md')
})()
