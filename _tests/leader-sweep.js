#!/usr/bin/env node
/* eslint-disable */
/**
 * 龙头战法 · 定向参数扫描  _tests/leader-sweep.js
 * 目的：在 120 个交易日样本上（比 60 日翻倍）对比少量有逻辑依据的变体，
 *      找胜率/期望收益更优的组合。不做暴力网格——样本量不支持，防过拟合。
 *
 * 变体（全部基于同一回测管线 _tests/leader-backtest.js，仅改变目标参数）：
 *   baseline        引擎现状（止损 -5%，全周期出手）
 *   stop7           止损放宽到 -7%（给龙头波动空间，防 -5% 洗出——60日样本中
 *                   万向德农 10 日后 +61% 却先破 -5% 被洗出）
 *   stop3           止损收紧到 -3%（更快砍亏）
 *   skip启动         跳过「启动」期（60 日样本中启动期 0/1 胜、-5.0%，启动=趋势未确认）
 *   skip高潮         跳过「高潮」期（高潮=情绪顶部区，理论上溢价最差）
 *   dipScore60      低吸门槛 50→60 分（提高候选质量）
 *
 * 用法：node _tests/leader-sweep.js  （受管 node；依赖 K 线缓存，缺了会自动建）
 */
const { execFileSync } = require('child_process')
const path = require('path')

const BT = path.join(__dirname, 'leader-backtest.js')
const DAYS = 120

const VARIANTS = [
  { tag: 'baseline   ', args: [] },
  { tag: 'stop7      ', args: ['--stopPct', '7'] },
  { tag: 'stop3      ', args: ['--stopPct', '3'] },
  { tag: 'skip启动    ', args: ['--skipCycle', '启动'] },
  { tag: 'skip高潮    ', args: ['--skipCycle', '高潮'] },
  { tag: 'dipScore60 ', args: ['--minDipScore', '60'] },
]

function pick(out, re) {
  const m = out.match(re)
  return m ? m[1] : '—'
}

const rows = []
for (const v of VARIANTS) {
  process.stdout.write('>> 运行 ' + v.tag.trim() + ' …\n')
  let out = ''
  try {
    out = execFileSync(process.execPath, [BT, '--days', String(DAYS)].concat(v.args), { encoding: 'utf8', timeout: 15 * 60 * 1000 })
  } catch (e) {
    out = (e && e.stdout) || ''
    process.stdout.write('   ⚠️ 运行异常：' + ((e && e.message) || e) + '\n')
  }
  const r = {
    tag: v.tag,
    trig: pick(out, /触发 (\d+)）/),
    filled: pick(out, /成交 (\d+)/),
    winRate10: pick(out, /裸持有 10 日：[\s\S]*?胜率 (\d+)%/),
    avg10: pick(out, /裸持有 10 日：[\s\S]*?平均收益 (-?[\d.]+)%/),
    execWin: pick(out, /纪律执行（-[\d.]+% 止损）：胜率 (\d+)%/),
    execAvg: pick(out, /纪律执行（-[\d.]+% 止损）：胜率 \d+%，平均收益 (-?[\d.]+)%/),
    stops: pick(out, /止损触发 (\d+) 笔/),
    bags: pick(out, /≤-8%）(\d+) 笔/),
  }
  rows.push(r)
  process.stdout.write('   完成：成交 ' + r.filled + '，纪律胜率 ' + r.execWin + '%，均收益 ' + r.execAvg + '%\n')
}

process.stdout.write('\n===== 120 日参数扫描汇总（纪律执行口径为主，样本小看方向） =====\n')
process.stdout.write('变体          触发/成交   裸持有胜率/均收   纪律胜率/均收   止损/接盘\n')
for (const r of rows) {
  process.stdout.write(r.tag + '   ' + r.trig + '/' + r.filled +
    '      ' + r.winRate10 + '% / ' + r.avg10 + '%' +
    '        ' + r.execWin + '% / ' + r.execAvg + '%' +
    '      ' + r.stops + ' / ' + r.bags + '\n')
}
