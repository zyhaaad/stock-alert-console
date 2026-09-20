/* 梦网科技(002123) 专用取数 —— 覆盖 2024-01 ~ 2025-12
 * 用途：按 S1 新系统回看 2025-01-17 / 01-27 / 02-06 / 02-07
 * 用法：node _tests/mw-fetch.js
 */
'use strict'
const fs = require('fs')
const http = require('http'), https = require('https')
const CODE = '002123', SEC = 'sz002123'

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
  // 日K：带日期区间，先试 2023-06-01 起
  let bars = []
  const forms = [
    'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + SEC + ',day,2023-06-01,2025-12-31,900,qfq',
    'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + SEC + ',day,2023-01-01,2025-12-31,900,qfq',
    'https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + SEC + ',day,,,640,qfq'
  ]
  for (const u of forms) {
    try {
      const r = await get(u, true)
      const j = JSON.parse(r.b)
      const d = j.data && j.data[SEC]
      const arr = (d && d.qfqday) || (d && d.day) || []
      console.log('尝试 → ' + arr.length + ' 根 ' + (arr[0] && arr[0][0]) + ' ~ ' + (arr[arr.length - 1] && arr[arr.length - 1][0]))
      if (arr.length > bars.length) bars = arr.map(x => [String(x[0]), +x[1], +x[2], +x[3], +x[4], +x[5]])
      if (bars.length && bars[0][0] <= '2023-12-01' && bars[bars.length - 1][0] >= '2025-06-30') break
    } catch (e) { console.log('失败 ' + e.message) }
    await new Promise(r => setTimeout(r, 350))
  }

  // 资金流
  let flows = []
  try {
    const r = await get('http://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/MoneyFlow.ssl_qsfx_zjlrqs?daima=' + SEC + '&num=1200&sort=opendate&asc=0', false)
    const j = JSON.parse(r.b)
    for (let i = j.length - 1; i >= 0; i--) {
      const m = Number(j[i].r0_net)
      if (!isFinite(m)) continue
      flows.push([String(j[i].opendate), m, -m / 2, -m / 2, 0, m].map(String).join(','))
    }
    console.log('资金流 ' + flows.length + ' 条 ' + flows[0].split(',')[0] + ' ~ ' + flows[flows.length - 1].split(',')[0])
  } catch (e) { console.log('资金流失败 ' + e.message) }

  // 流通股本
  let fs_ = NaN
  try {
    const r = await get('http://qt.gtimg.cn/q=' + SEC, false)
    const f = r.b.match(/="(.*)"/)[1].split('~')
    fs_ = Number(f[44]) * 1e8 / Number(f[3])
    console.log('流通股本 ' + (fs_ / 1e8).toFixed(2) + ' 亿股（按今日 流通市值/现价 折算）')
  } catch (e) { console.log('股本失败 ' + e.message) }

  fs.writeFileSync(__dirname + '/_cache/mw-data.json', JSON.stringify({
    fetchedAt: new Date().toISOString(), code: CODE, name: '梦网科技', bars, flows, floatShares: fs_
  }))
  console.log('→ 已写 _tests/_cache/mw-data.json')
})()
