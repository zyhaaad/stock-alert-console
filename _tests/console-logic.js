/* 抽取 console.html 里的业务函数，跑真值测试 */
const fs = require('fs')
const vm = require('vm')

const html = fs.readFileSync('D:/mywork/stock-alert-console/console.html', 'utf8')
const code = html.match(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/)[1]

/* 只取需要的函数段（避免执行 DOM 相关代码） */
function grab(startMarker, endMarker) {
  const a = code.indexOf(startMarker)
  const b = code.indexOf(endMarker, a)
  if (a < 0 || b < 0) throw new Error('找不到片段: ' + startMarker)
  return code.slice(a, b)
}
const src =
  grab('function secidOf(', '\n/*') +
  '\n' + grab('/* ---------- 涨跌与条件', '/* ---------- 行情') +
  '\nglobalThis.__api = { secidOf, gapInfo, condTextFull, COND, chgClass, chgText }'

const ctx = { console, globalThis: {} }
vm.createContext(ctx)
new vm.Script(src).runInContext(ctx)
const A = ctx.globalThis.__api

const lines = []
let pass = 0, fail = 0
function ok(c, label, extra) {
  if (c) { pass++; lines.push('  [OK]   ' + label) }
  else { fail++; lines.push('  [FAIL] ' + label + (extra !== undefined ? '  -> ' + JSON.stringify(extra) : '')) }
}

/* ---------- secidOf：6 开头归沪市，其余归深市 ---------- */
ok(A.secidOf({ code: '600519' }) === '1.600519', '600519 归沪市')
ok(A.secidOf({ code: '601318' }) === '1.601318', '601318 归沪市')
ok(A.secidOf({ code: '688111' }) === '1.688111', '688111 科创板归沪市')
ok(A.secidOf({ code: '000001' }) === '0.000001', '000001 归深市')
ok(A.secidOf({ code: '002415' }) === '0.002415', '002415 归深市')
ok(A.secidOf({ code: '300750' }) === '0.300750', '300750 创业板归深市')

/* ---------- gapInfo：低于类条件 ---------- */
let g = A.gapInfo('lte', 31.0, 31.24)
ok(g.text === '还差 0.24 元（0.77%）' && g.cls === '', 'lte 现价高于目标 → 还差 0.24（0.77%）', g)
g = A.gapInfo('lte', 31.0, 31.0)
ok(g.text === '已达条件' && g.cls === 'hit', 'lte 现价等于目标 → 已达条件（含等于）', g)
g = A.gapInfo('lte', 31.0, 30.8)
ok(g.text === '已达条件', 'lte 现价低于目标 → 已达条件', g)
g = A.gapInfo('lt', 31.0, 31.0)
ok(g.text === '还差 0.00 元（0.00%）', 'lt 现价等于目标 → 未达标（不含等于）', g)

/* ---------- gapInfo：高于类条件 ---------- */
g = A.gapInfo('gte', 1600, 1565.6)
ok(g.text === '还差 34.40 元（2.15%）', 'gte 现价低于目标 → 还差 34.40（2.15%）', g)
g = A.gapInfo('gte', 1600, 1600)
ok(g.text === '已达条件', 'gte 现价等于目标 → 已达条件', g)
g = A.gapInfo('gt', 1600, 1600)
ok(g.text === '还差 0.00 元（0.00%）', 'gt 现价等于目标 → 未达标（不含等于）', g)

/* ---------- gapInfo：等于条件 ---------- */
g = A.gapInfo('eq', 12.5, 12.5)
ok(g.text === '已达条件', 'eq 完全相等 → 已达条件', g)
g = A.gapInfo('eq', 12.5, 12.3)
ok(g.text === '相差 0.20 元', 'eq 不等 → 相差 0.20 元', g)

/* ---------- gapInfo：异常输入不能崩 ---------- */
g = A.gapInfo('lte', 31.0, NaN)
ok(g.text === '' && g.cls === 'mute', '现价缺失 → 不显示差值，不崩', g)
g = A.gapInfo('lte', 0, 31.24)
ok(g.text === '', '目标价为 0 → 不计算，不崩', g)
g = A.gapInfo('不存在的条件', 10, 5)
ok(typeof g.text === 'string' && g.text === '', '未知条件类型 → 安全返回', g)

/* ---------- condTextFull ---------- */
ok(A.condTextFull('lte', 31) === '价格 ≤ 31.00 元', 'lte 文案')
ok(A.condTextFull('gte', 1600) === '价格 ≥ 1600.00 元', 'gte 文案')
ok(A.condTextFull('eq', 12.5) === '价格 = 12.50 元', 'eq 文案')
ok(A.condTextFull('nonsense', 1) === 'nonsense', '未知条件原样返回')

/* ---------- 涨跌配色（A股：涨红跌绿） ---------- */
ok(A.chgClass(1.2) === 'up', '上涨 → up（红）')
ok(A.chgClass(-1.2) === 'down', '下跌 → down（绿）')
ok(A.chgClass(0) === 'flat', '平盘 → flat（灰）')
ok(A.chgText(2.1) === '+2.10%', '涨幅带正号')
ok(A.chgText(-0.86) === '-0.86%', '跌幅带负号')
ok(A.chgText(NaN) === '', '无数据不显示')

lines.push('')
lines.push('通过 ' + pass + ' 项，失败 ' + fail + ' 项')
fs.writeFileSync('D:/mywork/_tests/logic-result.txt', lines.join('\n'), 'utf8')
console.log(lines.join('\n'))
if (fail) process.exitCode = 1
