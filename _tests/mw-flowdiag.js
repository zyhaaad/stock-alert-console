/* 诊断：真代码取「末 20 条 flowDaily」vs 我复现取「末 20 根K线的资金」为何不同
 * 用法：node _tests/mw-flowdiag.js
 */
'use strict'
const fs = require('fs')
const D = JSON.parse(fs.readFileSync(__dirname + '/_cache/mw-data.json', 'utf8'))
const bars = D.bars, flows = D.flows
const flow = flows.map(r => { const p = r.split(','); return { d: p[0], main: Number(p[1]) } })
const fd = {}
flow.forEach(x => fd[x.d] = x.main)

const TARGET = '2025-01-16'
const i = bars.findIndex(b => b[0] === TARGET)
console.log('目标日 ' + TARGET + ' 在下标 ' + i)
console.log('K线根数 ' + bars.length + '（' + bars[0][0] + '~' + bars[bars.length-1][0] + '）')
console.log('资金流条数 ' + flows.length + '（' + flow[0].d + '~' + flow[flow.length-1].d + '）')

/* 法一：真代码 —— 取日期 <= TARGET 的末 20 条资金流 */
const upto = flow.filter(x => x.d <= TARGET)
const last20flow = upto.slice(-20)
console.log('')
console.log('【法一 · 真代码口径】末 20 条资金流：')
last20flow.forEach(x => console.log('   ' + x.d + '  ' + (x.main/1e8).toFixed(4) + ' 亿'))
console.log('   合计 ' + (last20flow.reduce((a,x)=>a+x.main,0)/1e8).toFixed(4) + ' 亿')

/* 法二：我复现 —— 取末 20 根K线的日期对应的资金流 */
const last20bars = bars.slice(i - 19, i + 1).map(b => b[0])
console.log('')
console.log('【法二 · 我复现口径】末 20 根K线：')
let s2 = 0, miss = 0
last20bars.forEach(d => { const v = fd[d]; if (!isFinite(v)) miss++; else s2 += v; console.log('   ' + d + '  ' + (isFinite(v) ? (v/1e8).toFixed(4) + ' 亿' : '❌ 无资金记录')) })
console.log('   合计 ' + (s2/1e8).toFixed(4) + ' 亿｜缺失 ' + miss + ' 天')

/* 差异来源 */
const setA = new Set(last20flow.map(x => x.d)), setB = new Set(last20bars)
console.log('')
console.log('仅法一有：' + [...setA].filter(d => !setB.has(d)).join(',') || '（无）')
console.log('仅法二有：' + [...setB].filter(d => !setA.has(d)).join(',') || '（无）')

/* 找出资金流里日期与K线不匹配的日子 */
const barSet = new Set(bars.map(b => b[0]))
const badFlow = flow.filter(x => x.d >= bars[0][0] && x.d <= bars[bars.length-1][0] && !barSet.has(x.d))
console.log('')
console.log('资金流有、K线没有的日期（近段）：' + (badFlow.slice(-15).map(x => x.d).join(',') || '（无）'))
const flowSet = new Set(flow.map(x => x.d))
const badBar = bars.filter(b => b[0] >= flow[0].d && !flowSet.has(b[0]))
console.log('K线有、资金流没有的日期（全部）：' + (badBar.map(b => b[0]).join(',') || '（无）'))
