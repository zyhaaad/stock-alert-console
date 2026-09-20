/* S1 辅助维度回测（2026-09-20）
 *
 * 用户 2026-09-20 追加要求：
 *   ① 把**同周期（周/月级）的压力位、支撑位**纳入判断，作为辅助，避免误判；
 *   ② 把「趋势向上」（MA5>MA10>MA20>MA30 多头排列）时、「连续 ≥2 日开盘与收盘都站上当日 MA5」
 *      → 大概率阶段顶部、卖出，作为辅助。
 *
 * 纪律：任何新增条件都必须先在这个 17 只 × 全样本 的池子里量出来，与基线对比；
 *       无效或反向的一律如实记录、不上线。
 *
 * 用法：node _tests/s1-sr-test.js
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

const mean = a => { const v = a.filter(x => x !== null && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN }
const pct = (n, d) => d ? n / d * 100 : NaN
const fR = x => (x !== null && isFinite(x)) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '—'
const fP = x => (x !== null && isFinite(x)) ? x.toFixed(1) + '%' : '—'

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
    const O = bars.map(b => b[1]), C = bars.map(b => b[2]), H = bars.map(b => +b[3]), L = bars.map(b => +b[4])
    const V = bars.map(b => b[5]), D = bars.map(b => b[0])
    const WARM = 260, MAXF = 60

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

    for (let i = WARM; i < bars.length - MAXF; i++) {
      const date = D[i]
      const mainYi = flowByDate[date]
      if (!isFinite(mainYi)) continue
      const ret60 = C[i] / C[i - 60] - 1
      /* 位置（盘中口径，与线上同源） */
      let loP = Infinity, hiP = -Infinity
      for (let j = i - 249; j <= i; j++) { if (L[j] < loP) loP = L[j]; if (H[j] > hiP) hiP = H[j] }
      const pos250i = hiP > loP ? (C[i] - loP) / (hiP - loP) : NaN
      const premLow = C[i] / loP - 1
      const fromHigh = C[i] / hiP - 1

      /* 日线均线 + 多头排列 + 连续站上 MA5 */
      const ma = n => { if (i - n + 1 < 0) return NaN; let s = 0; for (let j = i - n + 1; j <= i; j++) s += C[j]; return s / n }
      const ma5 = ma(5), ma10 = ma(10), ma20 = ma(20), ma30 = ma(30)
      const align = isFinite(ma30) && ma5 > ma10 && ma10 > ma20 && ma20 > ma30
      let streak = 0
      for (let j = i; j >= 0; j--) {
        const m5 = (() => { let s = 0; for (let t = j - 4; t <= j; t++) s += C[t]; return s / 5 })()
        if (O[j] > m5 && C[j] > m5) streak++; else break
      }
      const overMa5 = isFinite(ma5) ? C[i] / ma5 - 1 : NaN      // 偏离 MA5 多远

      /* 周级支撑 / 压力（只用已完成的周） */
      const wIdx = wks.findIndex(x => x.last > date)
      const wEnd = wIdx < 0 ? wks.length - 1 : wIdx - 1
      const done = wks.slice(0, wEnd + 1)
      const wClose = done.map(x => x.c), wVol = done.map(x => x.v), wMain = done.map(x => x.m)
      const wn = n => done.length >= n ? done.slice(-n) : []
      let wHi20 = -Infinity, wLo20 = Infinity, wHi52 = -Infinity, wLo52 = Infinity
      wn(20).forEach(x => { if (x.h > wHi20) wHi20 = x.h; if (x.l < wLo20) wLo20 = x.l })
      wn(52).forEach(x => { if (x.h > wHi52) wHi52 = x.h; if (x.l < wLo52) wLo52 = x.l })
      const distRes20 = isFinite(wHi20) ? C[i] / wHi20 - 1 : NaN      // 距 20 周压力（负=在下方）
      const distSup20 = isFinite(wLo20) ? C[i] / wLo20 - 1 : NaN      // 距 20 周支撑
      const wma = n => (done.length >= n ? done.slice(-n).reduce((a, x) => a + x.c, 0) / n : NaN)
      const wma5 = wma(5), wma20 = wma(20), wma30 = wma(30)
      const volRatio = wVol.length >= 26 ? (wVol.slice(-4).reduce((a, b) => a + b, 0) / 4) / (wVol.slice(-26).reduce((a, b) => a + b, 0) / 26) : NaN
      const mv = fs_ * C[i]
      const main4w = wMain.length >= 4 ? wMain.slice(-4).reduce((a, b) => a + b, 0) / mv : NaN
      /* 价格相对周 MA20 的距离（周级支撑/压力的另一种表达） */
      const vsWma20 = isFinite(wma20) ? C[i] / wma20 - 1 : NaN

      rows.push({ code, date, close: C[i], ret60, pos250i, premLow, fromHigh, volRatio, main4w,
        wma5, wma20, wma30, align, streak, overMa5, wHi20, wLo20, wHi52, wLo52, distRes20, distSup20, vsWma20,
        fwd20: C[i + 20] / C[i] - 1, fwd60: C[i + 60] / C[i] - 1 })
    }
  }
  return rows
}

/* 当前已上线的建仓区（含 30% 闸门） */
const BASE = r => r.main4w > 0.004 && r.pos250i < 0.4 && r.ret60 < 0.15 &&
  isFinite(r.wma20) && r.wma5 > r.wma20 && r.premLow < 0.30
/* 派发完毕（线上口径） */
const DIST = r => r.pos250i > 0.65 && r.ret60 > 0.20 && (r.volRatio < 1.0 || r.main4w < 0)
/* 下跌未完（线上口径） */
const FALL = r => r.ret60 < -0.20 && r.volRatio < 0.9 && (!isFinite(r.main4w) || Math.abs(r.main4w) < 0.004)

;(async () => {
  await new Promise(r => setTimeout(r, 400))
  const rows = build()
  const segs = [['2025H1', '2025-01-01', '2025-06-30'], ['2025H2', '2025-07-01', '2025-12-31'],
    ['2026H1', '2026-01-01', '2026-06-30'], ['2026Q3', '2026-07-01', '2026-12-31']]
  const out = []
  const say = s => { out.push(s); console.log(s) }
  const line = (label, l) => {
    if (!l.length) return label.padEnd(50) + 'n=0'
    const seg = segs.map(([, a, b]) => fR(mean(l.filter(r => r.date >= a && r.date <= b).map(r => r.fwd60))).padEnd(9))
    return label.padEnd(50) + 'n=' + String(l.length).padEnd(6) + '20日 ' + fR(mean(l.map(r => r.fwd20))).padEnd(9) +
      '60日 ' + fR(mean(l.map(r => r.fwd60))).padEnd(9) + '胜率 ' + fP(pct(l.filter(r => r.fwd60 > 0).length, l.length)).padEnd(8) +
      '跌超5% ' + fP(pct(l.filter(r => r.fwd60 <= DROP).length, l.length)).padEnd(8) + seg.join('')
  }

  say('样本：' + codes.length + ' 只 × ' + rows.length + ' 点｜基准 60日 ' + fR(mean(rows.map(r => r.fwd60))) +
    '，跌超5% ' + fP(pct(rows.filter(r => r.fwd60 <= DROP).length, rows.length)))
  say('时段列顺序：2025H1 / 2025H2 / 2026H1 / 2026Q3')

  say('')
  say('===== 0. 基线 =====')
  say(line('基准（全部样本）', rows))
  say(line('建仓区（含 30% 位置闸门）', rows.filter(BASE)))
  say(line('派发完毕', rows.filter(DIST)))
  say(line('下跌未完', rows.filter(FALL)))

  say('')
  say('===== A. 加「周级压力/支撑」辅助，能否改善建仓区 =====')
  const acc = rows.filter(BASE)
  say(line('A0 建仓区 原样（对照）', acc))
  say(line('A1 + 距 20 周压力 < -10%（上方还有空间）', acc.filter(r => r.distRes20 < -0.10)))
  say(line('A2 + 距 20 周压力 < -20%', acc.filter(r => r.distRes20 < -0.20)))
  say(line('A3 + 距 20 周支撑 < +15%（贴着支撑买）', acc.filter(r => r.distSup20 < 0.15)))
  say(line('A4 + 距 20 周支撑 < +25%', acc.filter(r => r.distSup20 < 0.25)))
  say(line('A5 + 现价在周 MA20 上方 0~10%（刚站上周支撑）', acc.filter(r => isFinite(r.vsWma20) && r.vsWma20 >= 0 && r.vsWma20 < 0.10)))
  say(line('A6 + 现价在周 MA20 上方 0~20%', acc.filter(r => isFinite(r.vsWma20) && r.vsWma20 >= 0 && r.vsWma20 < 0.20)))
  say(line('A7 + 距 20 周压力<-10% 且 距支撑<15%（双条件）', acc.filter(r => r.distRes20 < -0.10 && r.distSup20 < 0.15)))
  say('　（上述各项「n 掉多少、收益怎么变」就是判断依据；掉样本太多的一律不用）')

  say('')
  say('===== B. 加「周级压力」辅助，能否改善派发完毕 =====')
  const dis = rows.filter(DIST)
  say(line('B0 派发完毕 原样（对照）', dis))
  say(line('B1 + 距 20 周压力 < -3%（还没到压力就乏力）', dis.filter(r => r.distRes20 < -0.03)))
  say(line('B2 + 距 20 周压力 < 0%（已在压力下方附近）', dis.filter(r => r.distRes20 < 0)))
  say(line('B3 + 距 20 周压力 <-10% 且 <-… 收窄', dis.filter(r => r.distRes20 < -0.10)))
  say(line('B4 + 现价在周 MA20 上方 >20%（严重偏离周均线）', dis.filter(r => isFinite(r.vsWma20) && r.vsWma20 > 0.20)))
  say(line('B5 + 周线多头（wMA5>wMA20）', dis.filter(r => isFinite(r.wma20) && r.wma5 > r.wma20)))
  say(line('B6 + 周线空头（wMA5<=wMA20）', dis.filter(r => isFinite(r.wma20) && r.wma5 <= r.wma20)))

  say('')
  say('===== C. 用户要的「阶段顶部」规则：MA5>MA10>MA20>MA30 且 连续≥2 日开&收站上当日 MA5 =====')
  const al = rows.filter(r => r.align)
  say(line('C0 仅「多头排列」本身', al))
  say(line('C1 多头排列 + 连续≥2 日站上 MA5（用户原规则）', al.filter(r => r.streak >= 2)))
  say(line('C2 多头排列 + 连续≥3 日站上 MA5', al.filter(r => r.streak >= 3)))
  say(line('C3 多头排列 + 连续≥5 日站上 MA5', al.filter(r => r.streak >= 5)))
  say(line('C4 多头排列 + 连续≥2 日 + 偏离 MA5 >5%（更严格要求"涨多了"）', al.filter(r => r.streak >= 2 && r.overMa5 > 0.05)))
  say(line('C5 多头排列 + 连续≥2 日 + 偏离 MA5 >10%', al.filter(r => r.streak >= 2 && r.overMa5 > 0.10)))
  say(line('C6 多头排列 + 连续≥2 日 + 高位(pos>0.65)', al.filter(r => r.streak >= 2 && r.pos250i > 0.65)))
  say(line('C7 多头排列 + 连续≥2 日 + 逼近 20 周压力(distRes20>-3%)', al.filter(r => r.streak >= 2 && r.distRes20 > -0.03)))
  say(line('C8 非多头排列 + 连续≥2 日站上 MA5（对照，验证"须多头排列"这个前提）', rows.filter(r => !r.align && r.streak >= 2)))
  say(line('C9 多头排列 + 连续≥2 日 + 偏离>3%', al.filter(r => r.streak >= 2 && r.overMa5 > 0.03)))
  say(line('C10 多头排列 + 连续≥2 日 + (偏离>5% 或 逼近周压力)', al.filter(r => r.streak >= 2 && (r.overMa5 > 0.05 || r.distRes20 > -0.03))))
  say(line('C11 仅 多头排列 + 偏离 MA5 >5%（不要 streak，看 streak 有没有贡献）', al.filter(r => r.overMa5 > 0.05)))
  say(line('C12 多头排列 + 连续≥2 日 + 偏离>5% + 高位(pos>0.65)', al.filter(r => r.streak >= 2 && r.overMa5 > 0.05 && r.pos250i > 0.65)))
  say('　（C1 若与基准 60日 差不多，说明它本身没有"顶部"预测力；C4/C5/C7 才是"涨多了才危险"的版本）')

  say('')
  say('===== E. 最强候选 A3（建仓区 + 距 20 周支撑 < 15%）的稳健性 =====')
  const A3 = acc.filter(r => r.distSup20 < 0.15)
  say(line('A3', A3))
  say('　逐只拆开：')
  say('	代码	  基线n   基线60日	  A3n	A3 60日	   被筛掉n')
  for (const c of codes) {
    const a = acc.filter(r => r.code === c), b = A3.filter(r => r.code === c)
    if (!a.length) continue
    say('	' + c.padEnd(10) + String(a.length).padEnd(9) + fR(mean(a.map(r => r.fwd60))).padEnd(14) +
      String(b.length).padEnd(7) + fR(mean(b.map(r => r.fwd60))).padEnd(14) + (a.length - b.length))
  }
  const csA3 = codes.filter(c => A3.some(r => r.code === c))
  const csPos = csA3.filter(c => mean(A3.filter(r => r.code === c).map(r => r.fwd60)) > 0).length
  say('	→ A3 仍有信号的 ' + csA3.length + ' 只中，' + csPos + ' 只 60 日为正（' + fP(pct(csPos, csA3.length)) + '）')
  say('	个案：')
  for (const [c, d] of [['600703', '2026-03-26'], ['600703', '2026-06-12'], ['000767', '2026-06-23']]) {
    const r = rows.find(x => x.code === c && x.date === d)
    if (!r) { say('	  ' + c + ' ' + d + '：不在样本内'); continue }
    say('	  ' + c + ' ' + d + '：距20周支撑 ' + fR(r.distSup20) + '｜距20周压力 ' + fR(r.distRes20) +
      '｜60日 ' + fR(r.fwd60) + '｜基线 ' + (BASE(r) ? '选' : '不选') + '｜A3 ' + (A3.includes(r) ? '选' : '筛掉'))
  }

  say('')
  say('===== D. 阶段顶部规则 × 派发完毕（融合后的卖出辅助）=====')
  say(line('D1 派发完毕（原样）', dis))
  say(line('D2 派发完毕 + 多头排列+连续≥2日站上MA5', dis.filter(r => r.align && r.streak >= 2)))
  say(line('D3 派发完毕 + 多头排列+连续≥2日+高位(pos>0.8)', dis.filter(r => r.align && r.streak >= 2 && r.pos250i > 0.8)))
  say(line('D4 派发完毕 + 逼近周压力(distRes20>-3%)', dis.filter(r => r.distRes20 > -0.03)))

  fs.writeFileSync(__dirname + '/s1-sr-report.md', out.join('\n'), 'utf8')
  console.log('\n→ 已写 _tests/s1-sr-report.md')
  process.exit(0)
})().catch(e => { console.log('❌ ' + (e && e.message || e)); process.exit(1) })
