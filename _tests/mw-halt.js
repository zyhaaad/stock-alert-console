/* 验证：2025-01-02 ~ 01-15 是「腾讯K线缺失」还是「该股停牌」
 * 交叉源：① 腾讯不复权日K ② 新浪日K ③ 新浪资金流（已知这 10 天为 0）
 * 用法：node _tests/mw-halt.js
 */
'use strict'
const http = require('http'), https = require('https')
function get(u, isHttps) {
  const lib = isHttps ? https : http
  return new Promise((res, rej) => {
    const q = lib.get(u, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.sina.com.cn' }, timeout: 25000 }, r => {
      let b = ''; r.setEncoding('utf8'); r.on('data', d => b += d); r.on('end', () => res(b))
    })
    q.on('error', rej); q.setTimeout(25000, () => { q.destroy(); rej(new Error('timeout')) })
  })
}
const LO = '2024-12-25', HI = '2025-01-25'
const inWin = d => d >= LO && d <= HI

;(async () => {
  // ① 腾讯不复权
  try {
    const b = await get('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sz002123,day,2024-12-01,2025-02-28,200,', true)
    const j = JSON.parse(b), d = j.data['sz002123']
    const arr = (d && d.day) || (d && d.qfqday) || []
    console.log('① 腾讯【不复权】日K：' + arr.length + ' 根，窗口内 ' + arr.filter(x => inWin(String(x[0]))).map(x => x[0] + '(' + x[2] + ')').join(' '))
  } catch (e) { console.log('① 失败 ' + e.message) }

  // ② 新浪日K
  try {
    const b = await get('https://money.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_MarketData.getKLineData?symbol=sz002123&scale=240&ma=no&datalen=400', true)
    const j = JSON.parse(b)
    const arr = j.map(x => ({ d: String(x.day).slice(0, 10), c: x.close })).filter(x => inWin(x.d))
    console.log('② 新浪日K：窗口内 ' + arr.length + ' 天 → ' + arr.map(x => x.d + '(' + x.c + ')').join(' '))
  } catch (e) { console.log('② 失败 ' + e.message) }

  // ③ 腾讯分时/停复牌线索：用 K线全量找 2025-01 的所有日期
  console.log('')
  console.log('窗口 = ' + LO + ' ~ ' + HI)
  console.log('预期交易日（周一~周五，不含元旦/春节）：2024-12-25~27, 12-30~31, 2025-01-02~03, 01-06~10, 01-13~17, 01-20~24')
})()
