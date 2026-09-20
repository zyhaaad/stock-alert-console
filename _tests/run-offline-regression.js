#!/usr/bin/env node
/* eslint-disable */
/* 全量离线回归（按依赖顺序），逐项退出码，最后汇总 */
const { execFileSync } = require('child_process')
const path = require('path')
const T = (f) => path.join(__dirname, f)
const NODE = process.execPath

const STEPS = [
  { name: 'build-preview（DOM 测试前置，必须先跑）', file: T('build-preview.js') },
  { name: 'fng-core-test', file: T('fng-core-test.js') },
  { name: 'fng-fallback-test', file: T('fng-fallback-test.js') },
  { name: 'fng-heartbeat-test', file: T('fng-heartbeat-test.js') },
  { name: 'fng-extreme-test', file: T('fng-extreme-test.js') },
  { name: 'fng-ux-test', file: T('fng-ux-test.js') },
  { name: 'fng-dom-test', file: T('fng-dom-test.js') },
  { name: 'position-core-test', file: T('position-core-test.js') },
  { name: 'chip-test', file: T('chip-test.js') },
  { name: 'signal-core-test', file: T('signal-core-test.js') },
  { name: 'signals-push-test', file: T('signals-push-test.js') },
  { name: 'leader-engine-test（龙头战法纯函数）', file: T('leader-engine-test.js') },
  { name: 'style-engine-test（风格驾驶舱纯函数）', file: T('style-engine-test.js') },
  { name: 'console-logic', file: T('console-logic.js') },
  { name: 'console-check', file: T('console-check.js') },
  { name: 'position-dom-test（依赖 build-preview 产物）', file: T('position-dom-test.js') },
]

let fail = 0
for (const s of STEPS) {
  process.stdout.write('>> ' + s.name + '\n')
  let out = ''
  let code = 0
  try { out = execFileSync(NODE, [s.file], { encoding: 'utf8', timeout: 5 * 60 * 1000 }) } catch (e) { code = e.status || 1; out = (e.stdout || '') + (e.stderr || '') }
  const lines = out.trim().split('\n')
  for (const l of lines.slice(-6)) process.stdout.write('   ' + l + '\n')
  if (code !== 0) { fail++; process.stdout.write('   ❌ 退出码 ' + code + '\n') }
}
process.stdout.write('\n===== 回归汇总：' + (fail ? fail + ' 项失败' : '全部通过') + ' =====\n')
process.exit(fail ? 1 : 0)
