#!/usr/bin/env node
/* eslint-disable */
/* L2 假设验证：低吸周期收窄 + 连板数上限（top-1 引擎口径 + 群体口径） */
const { execFileSync } = require('child_process')
const path = require('path')
const BT = path.join(__dirname, 'leader-backtest.js')

const RUNS = [
  { tag: 'L2组合(分歧/修复低吸+2板上限) top1', args: ['--dipCycles', '分歧,退潮', '--dipMaxLbc', '2'] },
  { tag: '只限周期(分歧/修复低吸)        top1', args: ['--dipCycles', '分歧,退潮'] },
  { tag: '只限连板(低吸≤2板)            top1', args: ['--dipMaxLbc', '2'] },
  { tag: 'L2组合                        群体', args: ['--studyAll', '--dipCycles', '分歧,退潮', '--dipMaxLbc', '2'] },
]

for (const v of RUNS) {
  process.stdout.write('\n########## ' + v.tag + ' ##########\n')
  let out = ''
  try {
    out = execFileSync(process.execPath, [BT, '--days', '120'].concat(v.args), { encoding: 'utf8', timeout: 15 * 60 * 1000 })
  } catch (e) { out = (e && e.stdout) || ''; process.stdout.write('⚠️ ' + ((e && e.message) || e) + '\n') }
  // 只回显汇总关键行
  for (const line of out.split('\n')) {
    if (/回测汇总|裸持有|纪律执行|接盘|按情绪周期|按策略|——/.test(line) || /：\d+\/\d+ 胜/.test(line)) process.stdout.write(line + '\n')
  }
  if (v.args.indexOf('--studyAll') >= 0) continue
  // top-1 模式打印成交明细
  const j = JSON.parse(require('fs').readFileSync(path.join(__dirname, '_cache', 'leader-backtest-result.json'), 'utf8'))
  for (const r of j.results) {
    if (r.filled) process.stdout.write('  [成交] ' + r.date + ' ' + r.code + ' ' + r.name + ' ' + r.cycle + '·' + r.strat + ' 分' + r.score +
      ' 10日=' + (r.ret10 * 100).toFixed(1) + '% 执行=' + (r.retExec * 100).toFixed(1) + '% ' + (r.stateExec || '') + '\n')
  }
}
