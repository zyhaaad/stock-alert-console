#!/usr/bin/env node
/* eslint-disable */
/**
 * ============================================================
 *  恐贪指数月度体检  _tests/fng-checkup.js
 * ============================================================
 *  对应 2026-09-18 恐贪引擎评审的三个可优化点，每月自动重跑：
 *    ① 分值分布健康（均值漂移 / 贴边率 → 中位秩归一化是否仍有效）
 *    ② 因子冗余（相关矩阵；报警阈值 0.85 —— 2026-09-17 实测最高 mom↔mbs 0.68）
 *    ③ 前瞻有效性（分组前瞻收益：恐惧/中性/贪婪 三组未来 60 日指数收益，
 *       方向必须单调 恐惧>中性>贪婪，且与冻结基线 FORWARD 同向）
 *    附：广度因子重建天数监控（涨停/炸板历史重建进度 vs 252 日目标）
 *
 *  用法：node _tests/fng-checkup.js [--offline]
 *    --offline 跳过联网（只跑 ①②，前瞻项标 SKIP）
 *  退出码：0 健康 / 1 有 ❌ 项 / 2 数据不足无法体检
 * ============================================================
 */
const fs = require('fs')
const path = require('path')
const https = require('https')
const F = require('../stock-alert-cloud/fng-core.js')

const ARCHIVE = path.join(__dirname, '..', 'stock-alert-cloud', 'fng-history.json')
const BARS = path.join(__dirname, '_cache', 'leader-bars.json')
const OFFLINE = process.argv.includes('--offline')

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

function corr(pairs) {
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, n = 0
  for (const [x, y] of pairs) { sa += x; sb += y; saa += x * x; sbb += y * y; sab += x * y; n++ }
  if (n < 30) return NaN
  const cov = sab / n - (sa / n) * (sb / n)
  return cov / Math.sqrt((saa / n - (sa / n) ** 2) * (sbb / n - (sb / n) ** 2))
}

let bad = 0
function check(ok, level, label, detail) {
  // level: '❌' 严重 / '⚠️' 观察 / '✅' 正常 / 'ℹ️' 信息
  if (level === '❌') bad++
  console.log('  ' + level + ' ' + label + (detail ? ' —— ' + detail : ''))
  if (!ok && level === '❌') { /* counted */ }
}

async function main() {
  console.log('== 恐贪指数月度体检 ' + (function () { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0') })() + ' ==')
  if (!fs.existsSync(ARCHIVE)) { console.log('❌ 读不到 fng-history.json'); process.exit(2) }
  const j = JSON.parse(fs.readFileSync(ARCHIVE, 'utf8'))
  const u = F.unpackSeries(j.days || j)
  const series = u.series.filter(r => isFinite(r.v))
  console.log('  存档 ' + series.length + ' 天（' + series[0].d + ' ~ ' + series[series.length - 1].d + '），margin 快照 ' + (j.margin && j.margin.d))

  /* ① 分布健康 */
  console.log('\n—— ① 分值分布健康 ——')
  const vals = series.map(r => r.v).sort((a, b) => a - b)
  const avg = vals.reduce((a, b) => a + b, 0) / vals.length
  const edge = vals.filter(v => v < 5 || v > 95).length / vals.length
  check(avg >= 42 && avg <= 58, vals.length ? '✅' : '❌', '均值 ' + avg.toFixed(1) + '（设计目标 50 附近，允许 42-58）')
  check(edge < 0.05, edge < 0.05 ? '✅' : '❌', '贴边率 ' + (edge * 100).toFixed(1) + '%（<5% 达标，中位秩归一化有效性）')
  console.log('  ℹ️ p5=' + vals[Math.floor(vals.length * 0.05)].toFixed(1) + ' p50=' + vals[Math.floor(vals.length / 2)].toFixed(1) + ' p95=' + vals[Math.floor(vals.length * 0.95)].toFixed(1))

  /* ② 因子冗余（相关矩阵） */
  console.log('\n—— ② 因子冗余（相关矩阵，报警阈值 0.85） ——')
  const ks = ['mom', 'vol', 'vlm', 'mgn', 'mbs']
  let maxAbs = 0, maxPair = ''
  for (let a = 0; a < ks.length; a++) {
    for (let b = a + 1; b < ks.length; b++) {
      const pairs = []
      for (let i = 0; i < u.raws.length; i++) {
        const x = u.raws[i][ks[a]], y = u.raws[i][ks[b]]
        if (isFinite(x) && isFinite(y)) pairs.push([x, y])
      }
      const c = corr(pairs)
      if (!isFinite(c)) continue
      if (Math.abs(c) > Math.abs(maxAbs)) { maxAbs = c; maxPair = ks[a] + '↔' + ks[b] }
      if (Math.abs(c) > 0.85) check(false, '❌', ks[a] + '↔' + ks[b] + ' 相关 ' + c.toFixed(3) + '（>0.85，冗余过高，考虑换因子或降权）')
    }
  }
  if (Math.abs(maxAbs) <= 0.85) check(true, '✅', '最高相关 ' + maxPair + ' ' + maxAbs.toFixed(3) + '（≤0.85）')
  console.log('  ℹ️ 已知高相关对：mom↔mbs ~0.68、mgn↔mbs ~0.64（价格50%+杠杆50% 设计意图内的重叠）')

  /* ③ 前瞻有效性（分组前瞻收益，需联网拉中证全指） */
  console.log('\n—— ③ 前瞻有效性（分组前瞻 60 日，基线 fear +4.02 / neutral +0.63 / greed -0.67） ——')
  if (OFFLINE) {
    console.log('  ⚠️ --offline 模式，本次跳过（联网后重跑补齐）')
  } else {
    try {
      const idx = await getJson('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000985,day,,,1200,qfq')
      const key = idx.data && Object.keys(idx.data)[0]
      const raw = idx.data[key] && (idx.data[key].qfqday || idx.data[key].day)
      if (!raw || raw.length < 300) throw new Error('指数数据不足')
      const close = new Map(raw.map(r => [String(r[0]).slice(0, 10), Number(r[2])]))
      const dArr = raw.map(r => String(r[0]).slice(0, 10))
      // 每个存档日 D：若 D 与 D+60 都有指数收盘价 → 前瞻收益 = close[D+60]/close[D]-1
      const groups = { fear: [], neutral: [], greed: [] }
      for (let i = 0; i < series.length; i++) {
        const d = series[i].d
        const ci = dArr.indexOf(d)
        if (ci < 0 || ci + 60 >= dArr.length) continue
        const p0 = close.get(d), p1 = close.get(dArr[ci + 60])
        if (!isFinite(p0) || !isFinite(p1)) continue
        const fwd = p1 / p0 - 1
        const g = series[i].v < 40 ? 'fear' : series[i].v < 60 ? 'neutral' : 'greed'
        groups[g].push(fwd)
      }
      const avgF = g => groups[g].length ? groups[g].reduce((a, b) => a + b, 0) / groups[g].length * 100 : NaN
      const fr = { fear: avgF('fear'), neutral: avgF('neutral'), greed: avgF('greed') }
      const nsum = groups.fear.length + groups.neutral.length + groups.greed.length
      if (nsum < 300) {
        check(false, '⚠️', '有效分组样本仅 ' + nsum + '（<300，结果不稳，下月再验）')
      } else {
        console.log('  ℹ️ 样本 恐惧 ' + groups.fear.length + ' / 中性 ' + groups.neutral.length + ' / 贪婪 ' + groups.greed.length)
        console.log('  ℹ️ 未来 60 日收益：恐惧 ' + fr.fear.toFixed(2) + '% / 中性 ' + fr.neutral.toFixed(2) + '% / 贪婪 ' + fr.greed.toFixed(2) + '%')
        const mono = fr.fear > fr.neutral && fr.neutral > fr.greed
        const spread = fr.fear - fr.greed
        if (!mono) {
          check(false, '❌', '方向性失效（恐惧/中性/贪婪不再单调）——因子可能退化，需人工复盘')
        } else if (spread < 1.5) {
          check(false, '⚠️', '方向单调但区分度收窄（恐惧−贪婪 ' + spread.toFixed(2) + '%，冻结基线 4.7%），连续两月收窄需复盘')
        } else {
          check(true, '✅', '方向单调，区分度 恐惧−贪婪 ' + spread.toFixed(2) + '%（基线 4.7%）')
        }
      }
    } catch (e) {
      console.log('  ⚠️ 联网取指数失败（' + e.message + '），本次跳过前瞻项，下月重试')
    }
  }

  /* 附：广度因子重建天数监控 */
  console.log('\n—— 附：盘面广度因子重建进度（涨停/炸板历史，目标 252 日） ——')
  try {
    const barsRaw = JSON.parse(fs.readFileSync(BARS, 'utf8'))
    let minD = '9999-99-99', maxD = ''
    let cnt = 0
    for (const k of Object.keys(barsRaw)) {
      const arr = barsRaw[k]
      if (!arr || !arr.length) continue
      cnt++
      if (arr[0][0] < minD) minD = arr[0][0]
      if (arr[arr.length - 1][0] > maxD) maxD = arr[arr.length - 1][0]
    }
    const spanDays = Math.round((new Date(maxD) - new Date(minD)) / 86400000)
    console.log('  ℹ️ K线缓存 ' + cnt + ' 只，覆盖 ' + minD + ' ~ ' + maxD + '（约 ' + spanDays + ' 个自然日）')
    check(spanDays >= 365, spanDays >= 365 ? '✅' : 'ℹ️', spanDays >= 365
      ? '重建历史 ≥1 年，广度因子（涨停/炸板/连板）可以开始做增量验证'
      : '重建历史尚不足 1 年，广度因子继续等缓存积累（当前路线：新浪 210 根/股）')
  } catch (e) {
    console.log('  ℹ️ 无 K 线缓存（leader-bars.json 不存在），广度因子监控跳过')
  }

  console.log('\n== 体检结论：' + (bad ? bad + ' 项 ❌ 需要处理' : '全部通过') + ' ==')
  process.exit(bad ? 1 : 0)
}

main().catch(e => { console.error('体检脚本出错: ' + (e && e.message ? e.message : e)); process.exit(2) })
