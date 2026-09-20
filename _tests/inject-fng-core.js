/* 兼容入口（历史命令）：只注入恐贪核心。
 * 等价于：node _tests/inject-core.js fng
 * 新的推荐入口是 _tests/inject-core.js（一把注入全部核心文件）。
 */
process.argv.splice(2, process.argv.length, 'fng');
require('./inject-core.js');
