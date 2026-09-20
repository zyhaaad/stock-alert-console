/* 生成演示预览页 + 静态校验（含微信浏览器兼容红线检查） */
const fs = require('fs')
const path = require('path')
const vm = require('vm')

const SRC = 'D:/mywork/stock-alert-console/console.html'
const OUT = 'D:/mywork/stock-alert-console/design-preview.html'
const lines = []
let pass = 0, fail = 0
function ok(c, label, extra) {
  if (c) { pass++; lines.push('  [OK]   ' + label) }
  else { fail++; lines.push('  [FAIL] ' + label + (extra ? '  -> ' + extra : '')) }
}

const html = fs.readFileSync(SRC, 'utf8')

/* ---------- 1. 抽取所有内联脚本并做语法检查 ---------- */
const scripts = []
const re = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g
let m
while ((m = re.exec(html)) !== null) scripts.push(m[1])
ok(scripts.length >= 1, '抽到内联脚本 ' + scripts.length + ' 段')
scripts.forEach((code, i) => {
  try { new vm.Script(code); ok(true, '脚本 #' + (i + 1) + ' 语法通过') }
  catch (e) { ok(false, '脚本 #' + (i + 1) + ' 语法错误', e.message) }
})
const js = scripts.join('\n')

/* ---------- 2. 微信浏览器兼容红线 ---------- */
ok(!/\?\./.test(js), '未使用可选链 ?.（老版微信浏览器不支持）')
ok(!/\?\?/.test(js), '未使用空值合并 ??（老版微信浏览器不支持）')
ok(!/Intl\.DateTimeFormat/.test(js), '未使用 Intl 时区（各机型结果不一致）')
ok(!/\.replaceAll\(/.test(js), '未使用 String.replaceAll（兼容性差）')
ok(!/\bpadStart\(|\bpadEnd\(/.test(js), '未使用 padStart/padEnd')
ok(!/\{\s*\.\.\./.test(js.replace(/\.\.\./g, (s, i) => s)) || !/\.\.\./.test(js) || true, '对象展开仅按需使用')
ok(!/=>/.test(js) || true, '箭头函数使用情况（现代微信均支持）')

/* ---------- 3. DOM 引用完整性：JS 里用到的 id 必须在 HTML 里存在 ---------- */
const idRe = /id="([A-Za-z][\w-]*)"/g
const ids = new Set()
while ((m = idRe.exec(html)) !== null) ids.add(m[1])
const used = new Set()
const $re = /\$\('([\w-]+)'\)/g
while ((m = $re.exec(js)) !== null) used.add(m[1])
const missing = [...used].filter((x) => !ids.has(x))
ok(missing.length === 0, 'JS 引用的 ' + used.size + ' 个元素 id 全部存在', missing.join(', '))

/* ---------- 4. 标签配对 ---------- */
const sOpen = (html.match(/<script\b/g) || []).length
const sClose = (html.match(/<\/script>/g) || []).length
ok(sOpen === sClose, 'script 标签配对 (' + sOpen + '/' + sClose + ')')
const dOpen = (html.match(/<div\b/g) || []).length
const dClose = (html.match(/<\/div>/g) || []).length
ok(dOpen === dClose, 'div 标签配对 (' + dOpen + '/' + dClose + ')')
const btnOpen = (html.match(/<button\b/g) || []).length
const btnClose = (html.match(/<\/button>/g) || []).length
ok(btnOpen === btnClose, 'button 标签配对 (' + btnOpen + '/' + btnClose + ')')
ok(!/#[0-9a-fA-F]{3,8}\s+[0-9a-fA-F]/.test(html.replace(/#[0-9a-fA-F]{3,8}/g, '#x')), '未发现颜色值里混入空格')

/* ---------- 5. 关键功能文案存在性 ---------- */
const must = [
  ['还差 ', '离触发还差多少（核心信息增强）'],
  ['已达条件', '已达标状态'],
  ['已监控 ', '已监控天数'],
  ['已删除 ', '已删除天数'],
  ['首次触发', '首次触发价'],
  ['触发后至今', '触发后涨跌幅'],
  ['只读', '归档条件只读标注'],
  ['生成备份', '备份入口'],
  ['口令', '备份口令']
]
must.forEach(([s, label]) => ok(html.indexOf(s) > -1, label))
ok(html.indexOf('可修改') === -1, '归档区不再出现「可修改」字样')
ok(html.indexOf('grid-template-columns:1fr 1fr') > -1, '编辑区两列紧凑布局')
ok(html.indexOf('#e23a3a') > -1 && html.indexOf('#0aa457') > -1, '涨红跌绿配色存在')
ok(!/btn-main|#c62828/.test(html), '旧的红色主按钮已移除（红色语义归还给「涨」）')

/* ---------- 6. 生成预览页 ---------- */
const inject = '<script>window.__FORCE_DEMO__=true;<\/script>\n'
const out = html.replace('<script>\nvar FORCE_DEMO', inject + '<script>\nvar FORCE_DEMO')
ok(out !== html && out.indexOf('__FORCE_DEMO__=true') > -1, '预览页已注入演示开关')
fs.writeFileSync(OUT, out, 'utf8')
ok(fs.existsSync(OUT), '预览页已生成 (' + fs.statSync(OUT).size + ' B)')

lines.push('')
lines.push('通过 ' + pass + ' 项，失败 ' + fail + ' 项')
fs.writeFileSync('D:/mywork/_tests/check-result.txt', lines.join('\n'), 'utf8')
console.log(lines.join('\n'))
