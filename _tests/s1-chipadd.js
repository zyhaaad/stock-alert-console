/* S2 · 「筹码维度」增量回测 —— 全 17 只，区间/天级，不挑阈值
 *
 * 目的（用户 2026-09-20 拍板「接已建好未接的模块」）：
 *   ChipCore 的筹码分布（获利盘比例 / 筹码集中度 / 主力成本）已经建好，但**没接进 weekStage**。
 *   本脚本先回答一个问题：**把它接进去，到底有没有增量？**
 *   没增量就只进文案、不进触发条件（项目铁律：没回测过的规则不许上线）。
 *
 * 纪律：
 *   ① 用**真代码** w.weekStage + w.ChipCore.analyze（jsdom 装预览），不重写逻辑
 *   ② 每个因子**按中位数切半天**比较 —— 不扫阈值、不挑最优，避免多重检验
 *   ③ 卖点看「之后 60 日跌不跌」（越低越好），买点看「之后 60 日涨不涨」（越高越好）
 *   ④ 同时报按天 n 与合并后的区间数（按天会因重叠窗口虚增样本）
 *
 * ⚠️ 必须先跑 build-preview。用法：node _tests/s1-chipadd.js  → _tests/s1-chipadd-report.md
 */
'use strict'
const fs = require('fs')
const path = require('path')
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules'
module.paths.push(WS)
const { JSDOM, VirtualConsole } = require(path.join(WS, 'jsdom'))

const PREVIEW = 'D:/mywork/_preview/stock-picker-preview.html'
const bt = JSON.parse(fs.readFileSync(__dirname + '/_cache/bt-data.json', 'utf8'))
const raw = bt.stocks
const codes = Object.keys(raw)
const GAP = 5
const WARM = 260

const mean = a => { const v = a.filter(isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN }
const med = a => { const v = a.filter(isFinite).sort((x, y) => x - y); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN }
const fR = x => isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%' : '—'
const fP = x => isFinite(x) ? (x * 100).toFixed(0) + '%' : '—'
const f2 = x => isFinite(x) ? x.toFixed(2) : '—'

;(async () => {
  const vc = new VirtualConsole()
  const dom = new JSDOM(fs.readFileSync(PREVIEW, 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://stock-alert-console.app.workbuddy.host/', virtualConsole: vc })
  const w = dom.window
  await new Promise(r => setTimeout(r, 700))
  if (w.STAGE_VERSION !== 'S2') { console.log('预览引擎不是 S2：' + w.STAGE_VERSION); process.exit(1) }
  if (!w.ChipCore) { console.log('预览缺 ChipCore，先跑 build-preview'); process.exit(1) }

  const out = []
  const say = s => { out.push(s); console.log(s) }
  say('# S2 · 「筹码维度」增量回测（接 ChipCore 进 weekStage 值不值）')
  say('')
  say('引擎 STAGE_VERSION=' + w.STAGE_VERSION + '｜筹码 ChipCore RULE_VERSION=' + (w.ChipCore.RULE_VERSION || '—') +
    '｜样本 ' + codes.length + ' 只｜因子一律**按中位数切半天**，不扫阈值')
  say('')

  const rows = []
  let chipMiss = 0
  for (const code of codes) {
    const st = raw[code]
    const bars = st.bars.map(r => ({ d: r[0], o: +r[1], c: +r[2], h: +r[3], l: +r[4], v: +r[5] }))
    const flow = st.flows.map(r => { const p = r.split(','); return { d: p[0], main: Number(p[1]) } }).filter(x => isFinite(x.main))
    const secid = w.secidOf({ code })
    for (let t = WARM; t < bars.length; t++) {
      const cur = bars[t].d
      const fd = flow.filter(x => x.d <= cur).slice(-30)
      const bUp = bars.slice(0, t + 1)
      w.G.dayBars = {}; w.G.dayBars[code] = bUp
      w.G.chipMap = {}; w.G.chipMap[code] = { flowDaily: fd.map(x => x.d + ',' + x.main), floatShares: st.floatShares }
      w.G.quoteMap = {}; w.G.quoteMap[secid] = { price: bars[t].c, mv: st.floatShares * bars[t].c }
      const m = w.weekStage(code)
      if (!m) continue
      const fwd = h => (t + h < bars.length) ? bars[t + h].c / bars[t].c - 1 : NaN
      /* 筹码：与线上同源（chip-core.js 经 inject-core 注入） */
      let chip = null
      try { chip = w.ChipCore.analyze({ code: code, name: code, bars: bUp, flows: fd.map(x => x.d + ',' + x.main), floatShares: st.floatShares }) } catch (e) { }
      let profit = NaN, conc = NaN, mcDev = NaN, mainMass = NaN, avgCost = NaN
      if (chip && chip.ok && chip.chips) {
        profit = chip.chips.profitRatio
        conc = chip.chips.concentration
        avgCost = chip.chips.avgCost
        mainMass = chip.chips.mainMass
        if (isFinite(chip.chips.mainCost) && chip.chips.mainCost > 0) mcDev = bars[t].c / chip.chips.mainCost - 1
      } else chipMiss++
      rows.push({ code: code, t: t, d: cur, key: m.key,
        pos: m.pos250, sup: m.supDist, res: m.resDist, mr: m.mainRatio, over: m.overMa5, ret60: m.ret60, vr: m.volRatio,
        align: m.maAlign, streak: m.streak5, topS: m.topStrong,
        profit: profit, conc: conc, mcDev: mcDev, mainMass: mainMass, avgCost: avgCost,
        f20: fwd(20), f60: fwd(60) })
    }
  }
  say('共取到 ' + rows.length + ' 个交易日样本；筹码缺失 ' + chipMiss + ' 次（降级计为 NaN，不参与切分）')
  say('基准（全样本 60 日）：' + fR(mean(rows.map(r => r.f60))))
  say('')

  /* ── 口径：按天 n + 覆盖只数（按天会因重叠窗口虚增样本，所以两侧比较要同口径看） ── */
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
      '  涨/胜率 ' + fP(pos).padStart(4) +
      '  跌超5% ' + fP(big).padStart(4)
  }
  function split(label, base, keyFn) {
    const v = base.filter(r => isFinite(keyFn(r)))
    if (v.length < 20) { say('  ' + label + '：样本太少（' + v.length + '），跳过'); return }
    const m = med(v.map(keyFn))
    say('  ── ' + label + '：中位 ' + f2(m) + '，按它切半天 ──')
    say('  ' + line('  全部', v))
    say('  ' + line('  < 中位（低）', v.filter(r => keyFn(r) < m)))
    say('  ' + line('  ≥ 中位（高）', v.filter(r => keyFn(r) >= m)))
    say('')
  }

  const SELL = rows.filter(r => r.key === 'sell-overheat')
  const BUY = rows.filter(r => r.key === 'accumulate-zone')

  say('════════ 一、卖点「高位过热」上，筹码能不能加强它 ════════')
  say('看 60 日 —— 卖点要的是「之后跌」，越低越好。现行卖点基线：')
  say('  ' + line('  现行卖点（全部）', SELL))
  say('')
  split('因子① 获利盘比例', SELL, r => r.profit)
  split('因子② 筹码集中度', SELL, r => r.conc)
  split('因子③ 现价/主力成本 −1（正=主力已获利）', SELL, r => r.mcDev)
  split('因子④ 主力筹码量占比', SELL, r => r.mainMass)
  split('因子⑤ 距周级压力（越接近 0 越贴压力）', SELL, r => r.res)

  say('════════ 二、买点「主力建仓区」上，筹码能不能加强它 ════════')
  say('看 60 日 —— 买点要的是「之后涨」，越高越好。现行买点基线：')
  say('  ' + line('  现行建仓区（全部）', BUY))
  say('')
  split('因子① 获利盘比例（低=多数人套着）', BUY, r => r.profit)
  split('因子② 筹码集中度', BUY, r => r.conc)
  split('因子③ 现价/主力成本 −1（小=贴着主力成本）', BUY, r => r.mcDev)
  split('因子④ 主力筹码量占比', BUY, r => r.mainMass)

  say('════════ 三、结论怎么看（判据）════════')
  say('- 若某因子「低半」与「高半」的 60 日差距 < 3pp，视为**没有增量**，不接进触发条件。')
  say('- 若差距大但**两侧符号与直觉相反**，同样不接（很可能是样本内噪音，17 只太少）。')
  say('- 只有「差距明显 + 方向符合机制 + 不靠单只股票撑住」三条都成立，才值得接进 weekStage 并重新回测。')
  say('- ⚠️ 卖点基线样本本身不大（' + SELL.length + ' 天），切半天后每边更小；别当显著差异。')

  fs.writeFileSync(__dirname + '/s1-chipadd-report.md', out.join('\n') + '\n')
  console.log('\n→ 已写 _tests/s1-chipadd-report.md')
})()
