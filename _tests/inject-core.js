/* 把 stock-alert-cloud 下的「核心算法」文件原样注入 console.html 的对应标记块。
 * 目的：云端（Node）与手机控制台（浏览器）用**同一份**代码，杜绝两端算不一致。
 * 幂等：重复运行结果相同；内容一致则不改动文件。
 * 运行：
 *   node _tests/inject-core.js            → 注入全部登记的核心文件
 *   node _tests/inject-core.js fng        → 只注入恐贪核心
 *   node _tests/inject-core.js position   → 只注入持仓核心
 */
'use strict';
const fs = require('fs');

const PAGE = 'D:/mywork/stock-alert-console/console.html';
const CLOUD = 'D:/mywork/stock-alert-cloud';

/* 登记表：加新的核心文件只改这里 */
const REG = [
  { name: 'fng',      file: 'fng-core.js',      begin: '/* ==== FNG-CORE-BEGIN ==== */',      end: '/* ==== FNG-CORE-END ==== */' },
  { name: 'position', file: 'position-core.js', begin: '/* ==== POSITION-CORE-BEGIN ==== */', end: '/* ==== POSITION-CORE-END ==== */' },
  { name: 'signal',   file: 'signal-core.js',   begin: '/* ==== SIGNAL-CORE-BEGIN ==== */',   end: '/* ==== SIGNAL-CORE-END ==== */' },
  { name: 'chip',     file: 'chip-core.js',     begin: '/* ==== CHIP-CORE-BEGIN ==== */',     end: '/* ==== CHIP-CORE-END ==== */' }
];

const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
const targets = only.length ? REG.filter(r => only.indexOf(r.name) >= 0) : REG;
if (!targets.length) {
  console.error('未匹配到要注入的核心文件，可选：' + REG.map(r => r.name).join(' / '));
  process.exit(1);
}

let html = fs.readFileSync(PAGE, 'utf8');
let failed = 0;

for (const r of targets) {
  const core = fs.readFileSync(CLOUD + '/' + r.file, 'utf8');
  if (core.indexOf(r.begin) >= 0 || core.indexOf(r.end) >= 0) {
    console.error('[' + r.name + '] ' + r.file + ' 里出现了标记文本，会造成注入嵌套，已中止');
    failed++;
    continue;
  }
  const i = html.indexOf(r.begin);
  const j = html.indexOf(r.end);
  if (i < 0 || j < 0 || j < i) {
    console.error('[' + r.name + '] console.html 里找不到 ' + r.begin.replace(/\/\*|\*\//g, '').trim() + ' 标记对');
    failed++;
    continue;
  }
  html = html.slice(0, i + r.begin.length) + '\n' + core.trim() + '\n' + html.slice(j);
}

if (failed) { console.error('注入中止：有标记缺失，请先补齐标记再跑'); process.exit(1); }

/* 写回（内容相同则不写，保持幂等、不制造噪音 diff） */
const before = fs.readFileSync(PAGE, 'utf8');
if (before === html) {
  console.log('console.html 已是注入后的内容，未改动（幂等）');
} else {
  fs.writeFileSync(PAGE, html, 'utf8');
  console.log('已写入：' + PAGE);
}

/* 自检：每个标记块恰好一对，且块内内容与云端文件逐字一致 */
const chk = fs.readFileSync(PAGE, 'utf8');
let bad = 0;
for (const r of REG) {
  const cntB = (chk.match(new RegExp(r.begin.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  const cntE = (chk.match(new RegExp(r.end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
  const a = chk.indexOf(r.begin), b = chk.indexOf(r.end);
  const inner = (a >= 0 && b > a) ? chk.slice(a + r.begin.length, b).trim() : '';
  const core = fs.readFileSync(CLOUD + '/' + r.file, 'utf8').trim();
  const same = inner === core;
  console.log('  ' + r.name.padEnd(9) + ' 标记 ' + cntB + '/' + cntE + '（应 1/1）  内容一致：' + same);
  if (cntB !== 1 || cntE !== 1 || !same) bad++;
}
const total = (chk.match(/==== \w+-CORE-BEGIN ====/g) || []).length;
const totalE = (chk.match(/==== \w+-CORE-END ====/g) || []).length;
console.log('标记总数 BEGIN=' + total + ' END=' + totalE + '（应为 ' + REG.length + '/' + REG.length + '）');
console.log('文件 ' + Math.round(chk.length / 1024) + ' KB，' + chk.split('\n').length + ' 行');
if (bad || total !== REG.length || totalE !== REG.length) { console.error('自检失败'); process.exit(1); }
console.log('ALL GREEN');
