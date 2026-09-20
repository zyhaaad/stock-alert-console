/* 探针：确认梦网科技(002123)历史数据可取到 2025-01
 * 用法：node _tests/probe-mw.js
 */
'use strict'
const http = require('http'), https = require('https')

function get(u, isHttps) {
  const lib = isHttps ? https : http
  return new Promise((res, rej) => {
    const q = lib.get(u, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://finance.sina.com.cn' },
      timeout: 25000
    }, r => {
      let b = ''
      r.setEncoding('utf8')
      r.on('data', d => b += d)
      r.on('end', () => res({ s: r.statusCode, b }))
    })
    q.on('error', rej)
    q.setTimeout(25000, () => { q.destroy(); rej(new Error('timeout')) })
  })
}

;(async () => {
  // 0. 名称核对
  try {
    const r = await get('http://qt.gtimg.cn/q=sz002123', false)
    const f = r.b.match(/="(.*)"/)[1].split('~')
    console.log('名称核对：' + f[1] + ' 代码 ' + f[2] + ' 现价 ' + f[3] + ' 流通市值(f44) ' + f[44])
  } catch (e) { console.log('名称失败 ' + e.message) }

  // 1. 腾讯 qfq 日K，取 900 根看能回溯到哪天
  for (const n of [900]) {
    try {
      const r = await get('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sz002123,day,,,' + n + ',qfq', true)
      const j = JSON.parse(r.b)
      const d = j.data && j.data['sz002123']
      const arr = (d && d.qfqday) || (d && d.day) || []
      console.log('腾讯 qfq K线 n=' + n + ' → ' + arr.length + ' 根，' + (arr[0] && arr[0][0]) + ' ~ ' + (arr[arr.length - 1] && arr[arr.length - 1][0]))
    } catch (e) { console.log('腾讯 ' + n + ' 失败 ' + e.message) }
  }

  // 2. 新浪资金流，试 num=400 / 1200
  for (const n of [400, 1200]) {
    try {
      const r = await get('http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow.ssl_qsfx_zjlrqs?daima=sz002123&num=' + n + '&sort=opendate&asc=0', false)
      const j = JSON.parse(r.b)
      const dates = j.map(x => String(x.opendate))
      console.log('新浪资金流 num=' + n + ' → ' + j.length + ' 条，最新 ' + dates[0] + ' 最旧 ' + dates[dates.length - 1] +
        '｜最早几条 ' + dates.slice(-3).join(','))
    } catch (e) { console.log('新浪 ' + n + ' 失败 ' + e.message) }
  }

  // 3. 东财 push2his 资金流（历史长）
  try {
    const u = 'https://push2his.eastmoney.com/api/qt/stock/fflow/daykline/get?lmt=0&klt=101&secid=0.002123&fields1=f1,f2,f3,f7&fields2=f51,f52,f53,f54,f55,f56'
    const r = await get(u, true)
    const j = JSON.parse(r.b)
    const k = j.data && j.data.klines || []
    console.log('东财 fflow → ' + k.length + ' 条，' + (k[0] || '').slice(0, 10) + ' ~ ' + (k[k.length - 1] || '').slice(0, 10))
  } catch (e) { console.log('东财 fflow 失败 ' + e.message) }
})()
