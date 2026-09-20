#!/usr/bin/env node
/* eslint-disable */
/**
 * ============================================================
 *  龙头战法引擎 · 历史回测  _tests/leader-backtest.js
 * ============================================================
 *  问题：东财涨停池历史只保留 ~15 个交易日，没法直接回测。
 *  方案：用腾讯日线（200 根，全 A ~4600 只）自行重建每天的
 *        涨停 / 炸板 / 跌停 / 连板数，再喂给 screener.js 导出的
 *        同一套引擎（classifyCycle / guardReject / scoreBoard /
 *        scoreDip / dipBuyPrice）逐日模拟选股，次日撮合，10 日定胜负。
 *
 *  撮合纪律（与 screener plan 文案一致）：
 *    打板单：次日最高价触及涨停价才成交（entry=涨停价）；
 *            开盘 >涨停价×1.07（高开超 7% 追高放弃）或 <涨停价×0.97（低开超 3% 放弃）不成交
 *    低吸单：次日最低价 ≤ 买入价成交（entry=min(开盘,买入价)）；
 *            开盘 >买入价×1.03（高开超 3% 不追）不成交
 *    胜负：entry 起 10 个交易日收盘 ≥+2% 胜 / ≤-2% 负；
 *    接盘：entry 后 10 日内最低点 ≤ entry×0.92（最大回撤 -8%）
 *
 *  已知近似（诚实声明）：
 *   · 前复权价在除权日附近涨停判定可能有 ±1 分钱误差（容差 0.005 已吸收大半）
 *   · 流通市值/换手用当前快照近似（60 日内变化一般不大，除权除息除外）
 *   · fbt/fund/炸板次数缺失 → 封板质量按中性 8 分（与云端降级路径同口径）
 *   · 股票池用当前全 A 榜单 → 60 日窗口内退市股极少，忽略
 *
 *  用法（受管 node）：
 *    node _tests/leader-backtest.js --days 60          # 首次会拉全市场K线建缓存（~3-5 分钟）
 *    node _tests/leader-backtest.js --days 60 --refresh # 强制刷新K线缓存
 * ============================================================
 */

const fs = require('fs')
const path = require('path')
const https = require('https')
const E = require('../stock-alert-cloud/screener.js')

const CACHE_DIR = path.join(__dirname, '_cache')
const BARS_CACHE = path.join(CACHE_DIR, 'leader-bars.json')
const IND_CACHE = path.join(CACHE_DIR, 'leader-industry.json')

const args = process.argv
const DAYS = (() => { const i = args.indexOf('--days'); return i >= 0 ? Math.max(10, Number(args[i + 1]) || 60) : 60 })()
const REFRESH = args.includes('--refresh')
// ★ 反向验证模式（用户 2026-09-17 要求）：只在被回避的「冰点 / 退潮(非修复)」日出手，
//   其余管道（候选/防接盘过滤/打分/撮合/止损）与正向完全同口径。
//   若回避条件真是负反馈有效，反向的胜率与收益应显著更差。
const INVERSE = args.includes('--inverse')
// ★ 参数扫描（用户 2026-09-17：优化胜率/收益到最佳）。每个开关都要有逻辑依据，不做暴力网格防过拟合：
//   --stopPct N        止损宽度（默认 5；宽=给龙头波动空间防洗出，窄=快砍）
//   --skipCycle A,B    跳过指定情绪周期（如 启动/高潮）
//   --minDipScore N    低吸候选最低分（默认 P.dipMinScore）
const STOP_PCT = (() => { const i = args.indexOf('--stopPct'); return i >= 0 ? Math.max(1, Number(args[i + 1]) || 5) : 5 })()
const SKIP_CYCLES = (() => { const i = args.indexOf('--skipCycle'); return i >= 0 ? String(args[i + 1] || '').split(',').map(s => s.trim()).filter(Boolean) : [] })()
const MIN_DIP_SCORE = (() => { const i = args.indexOf('--minDipScore'); return i >= 0 ? Number(args[i + 1]) : E.P.dipMinScore })()
const UNI_CACHE = path.join(CACHE_DIR, 'leader-universe.json')
// ★ 研究模式（2026-09-17：找真正的正反馈条件）：结算全部达标候选而非每日 top-1/2，
//   把样本从个位数放大到几百笔，用来看 分数段/连板数段/周期段 的边际胜率——
//   注意：这是「条件边际期望」研究，不代表引擎照单全收的真实收益。
const STUDY_ALL = args.includes('--studyAll')
// ★ L2 假设验证开关（研究模式结论：启动/发酵期低吸与 3 板以上低吸都是负期望群体）
//   --dipCycles 分歧,退潮   低吸只在这些周期出手（退潮=仅修复日；打板不受限）
//   --dipMaxLbc 2           低吸候选昨日连板数上限
const DIP_CYCLES = (() => { const i = args.indexOf('--dipCycles'); return i >= 0 ? String(args[i + 1] || '').split(',').map(s => s.trim()).filter(Boolean) : null })()
const DIP_MAX_LBC = (() => { const i = args.indexOf('--dipMaxLbc'); return i >= 0 ? Number(args[i + 1]) || 99 : 99 })()

/* ---------------- http ---------------- */
function getJson(url, tries) {
  const n = tries === undefined ? 2 : tries
  return new Promise((resolve, reject) => {
    const attempt = (left) => {
      const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 15000 }, res => {
        let b = ''
        res.setEncoding('utf8')
        res.on('data', d => (b += d))
        res.on('end', () => {
          try { resolve(JSON.parse(b)) } catch (e) { if (left > 0) return attempt(left - 1); reject(new Error('非JSON')) }
        })
      })
      req.on('error', e => { if (left > 0) return setTimeout(() => attempt(left - 1), 800); reject(e) })
      req.on('timeout', () => { req.destroy(); if (left > 0) return setTimeout(() => attempt(left - 1), 800); reject(new Error('超时')) })
    }
    attempt(n)
  })
}

/* ---------------- 股票池与行业 ---------------- */
async function fetchUniverse() {
  const out = []
  let offset = 0, total = Infinity
  while (offset < total && offset <= 6000) {
    const url = 'https://proxy.finance.qq.com/cgi/cgi-bin/rank/hs/getBoardRankList?board_code=aStock&sort_type=price&direct=down&offset=' + offset + '&count=200'
    const j = await getJson(url)
    const d = j && j.data
    if (j.code !== 0 || !d || !Array.isArray(d.rank_list) || !d.rank_list.length) break
    if (isFinite(d.total)) total = d.total
    out.push.apply(out, d.rank_list)
    offset += d.rank_list.length
  }
  return out
}

async function loadUniverse() {
  if (fs.existsSync(UNI_CACHE) && !REFRESH) {
    try { return JSON.parse(fs.readFileSync(UNI_CACHE, 'utf8')) } catch (e) { /* refetch */ }
  }
  const u = await fetchUniverse()
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(UNI_CACHE, JSON.stringify(u), 'utf8')
  return u
}

async function fetchIndustryMap(codes) {
  if (fs.existsSync(IND_CACHE) && !REFRESH) {
    try { return JSON.parse(fs.readFileSync(IND_CACHE, 'utf8')) } catch (e) { /* rebuild */ }
  }
  const map = {}
  const CHUNK = 100
  for (let i = 0; i < codes.length; i += CHUNK) {
    const part = codes.slice(i, i + CHUNK)
    const secids = part.map(c => (c[0] === '6' ? '1.' : '0.') + c).join(',')
    try {
      const j = await getJson('https://push2.eastmoney.com/api/qt/ulist.np/get?secids=' + secids +
        '&fields=f12,f21,f100&fltt=2&invt=2&np=1', 1)
      const diff = j && j.data && j.data.diff
      if (Array.isArray(diff)) for (const d of diff) {
        // ⚠️ f21（流通市值）单位是**元**（实测 平安银行 ~2.4e12、小盘涨停股 ~2e9 量级），别再乘 1e8
        map[String(d.f12)] = { ind: String(d.f100 || ''), ltsz: Number(d.f21) || NaN }
      }
    } catch (e) { /* 跳过 */ }
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true })
  fs.writeFileSync(IND_CACHE, JSON.stringify(map), 'utf8')
  return map
}

/* ---------------- K 线缓存 ---------------- */
/* K线多源取数：本机 IP 反复触发各源限流（2026-09-17 实测），做逐源轮换 + 失败冷却。
 * 顺位：新浪（不复权，涨停判定最准）→ 腾讯 gtimg（前复权）→ 东财 push2his（前复权）。 */
const SOURCES = ['sina', 'tencent', 'east']
const bannedUntil = { sina: 0, tencent: 0, east: 0 }
const COOL_MS = 90000        // 某源连败即冷却 90s
let lastSourceOK = 'sina'

function fetchSina(code) {
  const sym = (code[0] === '6' ? 'sh' : 'sz') + code
  return new Promise((resolve, reject) => {
    const req = https.get('https://quotes.sina.cn/cn/api/jsonp_v2.php/var%20_x=/CN_MarketDataService.getKLineData?symbol=' + sym +
      '&scale=240&ma=no&datalen=210', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Referer': 'https://finance.sina.com.cn/' }, timeout: 15000 }, res => {
      let b = ''
      res.setEncoding('utf8')
      res.on('data', d => (b += d))
      res.on('end', () => {
        try {
          const m = b.match(/\[(.*)\]/s)
          const arr = m ? JSON.parse('[' + m[1] + ']') : null
          if (arr && arr.length) {
            resolve(arr.map(r => [String(r.day), Number(r.open), Number(r.close), Number(r.high), Number(r.low), Math.round(Number(r.volume) / 100)]))
          } else reject(new Error('sina空'))
        } catch (e) { reject(new Error('sina非JSON')) }
      })
    })
    req.on('error', reject)
    req.on('timeout', () => { req.destroy(); reject(new Error('sina超时')) })
  })
}

function fetchTencent(code) {
  const secid = (code[0] === '6' ? 'sh' : 'sz') + code
  return getJson('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=' + secid + ',day,,,210,qfq', 1).then(j => {
    const key = j.data && Object.keys(j.data)[0]
    const raw = j.data[key] && (j.data[key].qfqday || j.data[key].day)
    if (!raw || !raw.length) throw new Error('tencent空')
    return raw.map(r => [String(r[0]), Number(r[1]), Number(r[2]), Number(r[3]), Number(r[4]), Number(r[5])])
  })
}

function fetchEast(code) {
  const secid = (code[0] === '6' ? '1.' : '0.') + code
  return getJson('https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=' + secid +
    '&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=210', 1).then(j => {
    const kl = j && j.data && j.data.klines
    if (!kl || !kl.length) throw new Error('east空')
    return kl.map(s => { const f = s.split(','); return [String(f[0]), Number(f[1]), Number(f[2]), Number(f[3]), Number(f[4]), Number(f[5])] })
  })
}

const FETCHERS = { sina: fetchSina, tencent: fetchTencent, east: fetchEast }

async function fetchBarsMulti(code) {
  const order = [lastSourceOK].concat(SOURCES.filter(s => s !== lastSourceOK))
  for (const src of order) {
    if (Date.now() < bannedUntil[src]) continue
    try {
      const r = await FETCHERS[src](code)
      lastSourceOK = src
      return r
    } catch (e) {
      // 同一源连败就冷却（简化：任何一次失败都给该源一小段冷却，成功即复位）
      bannedUntil[src] = Date.now() + COOL_MS
    }
  }
  throw new Error('all-sources-failed')
}

async function fetchAllBars(codes) {
  if (fs.existsSync(BARS_CACHE) && !REFRESH) {
    process.stdout.write('  读取K线缓存…\n')
    try {
      const j = JSON.parse(fs.readFileSync(BARS_CACHE, 'utf8'))
      if (Object.keys(j).length >= 100) return j
      process.stdout.write('  缓存为空/不完整，重建\n')
    } catch (e) { /* rebuild */ }
  }
  const out = {}
  let next = 0, done = 0, fail = 0
  const t0 = Date.now()
  async function worker() {
    while (next < codes.length) {
      const code = codes[next++]
      try {
        const r = await fetchBarsMulti(code)
        out[code] = r
      } catch (e) { fail++ }
      if (++done % 400 === 0) {
        fs.mkdirSync(CACHE_DIR, { recursive: true })
        fs.writeFileSync(BARS_CACHE, JSON.stringify(out), 'utf8')
        process.stdout.write('  K线 ' + done + '/' + codes.length + '（' + Math.round((Date.now() - t0) / 1000) + 's，失败 ' + fail + '）\n')
      }
    }
  }
  await Promise.all(new Array(4).fill(0).map(worker))
  fs.writeFileSync(BARS_CACHE, JSON.stringify(out), 'utf8')
  process.stdout.write('  K线缓存完成 ' + Object.keys(out).length + ' 只（失败 ' + fail + '），用时 ' + Math.round((Date.now() - t0) / 1000) + 's\n')
  return out
}

/* ---------------- 重建每日涨停/炸板/跌停 ---------------- */

function normBars(raw) { return raw.map(r => ({ d: r[0], o: r[1], c: r[2], h: r[3], l: r[4], v: r[5] })) }

function rebuildDay(date, universe, barsMap, indMap) {
  const zt = [], zb = [], dt = []
  for (const u of universe) {
    const bars = barsMap[u.code]
    if (!bars) continue
    const i = bars.findIndex(b => b.d === date)
    if (i < 1) continue
    const b = bars[i], prev = bars[i - 1]
    const lim = E.limitPrice(u.code, prev.c)
    const limDn = Math.round(prev.c * (u.code[0] === '3' ? 0.8 : 0.9) * 100) / 100
    if (!isFinite(lim) || lim <= 0) continue
    // 连板数（从 D 往前数连续涨停）
    let lbc = 0
    for (let k = i; k >= 1; k--) {
      const limK = E.limitPrice(u.code, bars[k - 1].c)
      if (bars[k].c >= limK - 0.005 && bars[k].c <= limK + 0.005) lbc++
      else break
    }
    const info = indMap[u.code] || {}
    const shares = (isFinite(info.ltsz) && info.ltsz > 0 && u.price > 0) ? info.ltsz / u.price : NaN
    const hs = (isFinite(shares) && shares > 0) ? b.v * 100 / shares * 100 : NaN
    const row = {
      code: u.code, name: u.name, price: b.c, pct: b.c / prev.c - 1,
      ltsz: info.ltsz || NaN, hs, lbc, fbt: 0, lbt: 0, fund: 0, zbc: NaN,
      hybk: info.ind || '未知', zttj: null, amount: 0
    }
    if (b.c >= lim - 0.005 && b.c <= lim + 0.005) zt.push(row)
    else if (b.h >= lim - 0.005) zb.push(row)
    if (b.c <= limDn + 0.005) dt.push(row)
  }
  return { zt, zb, dt }
}

/* ---------------- 回测主流程 ---------------- */

async function main() {
  process.stdout.write('== 龙头战法回测（' + DAYS + ' 个交易日） ==\n')
  const uni = await loadUniverse()
  const universe = []
  for (const r of uni) {
    const code = String(r.code || '').replace(/^(sh|sz|bj)/, '')
    const name = String(r.name || '')
    if (name.indexOf('ST') >= 0 || name.indexOf('退') >= 0) continue
    if (!/^(60|00|30)/.test(code)) continue
    if (!(r.state === 'S') && isFinite(Number(r.zxj))) universe.push({ code, name, price: Number(r.zxj) })
  }
  process.stdout.write('  股票池 ' + universe.length + ' 只\n')

  const indMap = await fetchIndustryMap(universe.map(u => u.code))
  // 行业映射兜底：东财 ulist 被限流时（2026-09-17 实测：44 批全挂 → 行业全「未知」→ 题材打分全失真），
  // 用涨停池最近 15 个交易日的 hybk 补（push2ex 与 push2 不同主机，通常不被限）
  if (Object.keys(indMap).length < 500) {
    process.stdout.write('  ⚠️ 东财行业映射覆盖不足（' + Object.keys(indMap).length + '），用涨停池 hybk 兜底\n')
    const ut = 'ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=320&sort=fbt%3Aasc'
    for (let i = 0; i < 20; i++) {
      const d = new Date(Date.now() - i * 86400000)
      const ds = new Date(d.getTime() + (8 * 60 + d.getTimezoneOffset()) * 60000).toISOString().slice(0, 10).replace(/-/g, '')
      try {
        const j = await getJson('https://push2ex.eastmoney.com/getTopicZTPool?' + ut + '&date=' + ds, 1)
        for (const r of (j && j.data && j.data.pool) || []) {
          const code = String(r.c)
          if (!indMap[code]) indMap[code] = { ind: String(r.hybk || ''), ltsz: Number(r.ltsz) || NaN }
        }
      } catch (e) { /* 单日失败跳过 */ }
    }
    process.stdout.write('  兜底后行业映射覆盖 ' + Object.keys(indMap).length + '\n')
  }
  const barsMapRaw = await fetchAllBars(universe.map(u => u.code))
  const barsMap = {}
  for (const k of Object.keys(barsMapRaw)) barsMap[k] = normBars(barsMapRaw[k])

  // 交易日历：取指数日期（用任意大盘股的日期并集简化——直接用平安银行，交易日必有）
  const calBars = barsMap['000001']
  if (!calBars || calBars.length < DAYS + 60) { console.error('交易日历不足'); process.exit(1) }
  const allDates = calBars.map(b => b.d)
  const testDates = allDates.slice(-DAYS)
  process.stdout.write('  回测区间 ' + testDates[0] + ' ~ ' + testDates[testDates.length - 1] + '\n')

  // 预建每只股票的日期→索引
  const idxMap = {}
  for (const u of universe) {
    const bars = barsMap[u.code]
    if (!bars) continue
    const m = {}
    for (let i = 0; i < bars.length; i++) m[bars[i].d] = i
    idxMap[u.code] = m
  }

  const results = []
  const emHist = []   // 情绪快照（升序）

  for (const date of testDates) {
    const day = rebuildDay(date, universe, barsMap, indMap)
    // 昨涨停溢价
    let prem = NaN
    if (emHist.length) {
      const prevZt = emHist[emHist.length - 1].rows
      const pcts = []
      for (const r of prevZt) {
        const bars = barsMap[r.code], m = idxMap[r.code]
        const i = m ? m[date] : -1
        if (bars && i > 0 && bars[i - 1].d === emHist[emHist.length - 1].date) {
          pcts.push(bars[i].c / bars[i - 1].c - 1)
        }
      }
      if (pcts.length) prem = pcts.reduce((a, b) => a + b, 0) / pcts.length
    }
    const lbcList = day.zt.map(r => r.lbc).filter(x => x > 0)
    const emo = {
      date, zt: day.zt.length, dt: day.dt.length, zb: day.zb.length,
      zbRate: (day.zt.length + day.zb.length) ? day.zb.length / (day.zt.length + day.zb.length) : 0,
      maxLbc: lbcList.length ? Math.max.apply(null, lbcList) : 0,
      twoPlus: lbcList.filter(x => x >= 2).length,
      threePlus: lbcList.filter(x => x >= 3).length,
      prem, rows: day.zt, zbCodes: day.zb.map(r => r.code)
    }
    emHist.push(emo)
    const cc = E.classifyCycle(emHist.slice())
    const avoided = cc.cycle === '冰点' || (cc.cycle === '退潮' && !cc.repaired)
    if (!INVERSE && avoided) continue          // 正向：冰点/退潮不选股
    if (INVERSE && !avoided) continue          // 反向：只在被回避的日子选股
    if (!INVERSE && SKIP_CYCLES.indexOf(cc.cycle) >= 0) continue   // 参数扫描：跳过指定周期

    const maxBoardAll = emo.maxLbc
    const thToday = E.themeStats(day.zt)
    const zbYest = emHist.length >= 2 ? (emHist[emHist.length - 2].zbCodes || []) : []

    const iDate = idxMap['000001'][date]

    const mkFeat = (code, known) => {
      const bars = barsMap[code], m = idxMap[code]
      if (!bars || m === undefined || m[date] === undefined) return { ok: false, why: '无K线' }
      const i = m[date]
      return E.analyzeBars(code, bars.slice(0, i + 1), known)
    }

    // 打板候选（行业数据在本机拿不全 → 题材分用全场口径近似，isThemeTop 恒 false）
    const boardCands = []
    for (const r of day.zt) {
      const feat = mkFeat(r.code, true)
      const rej = E.guardReject(r, feat, { isMaxBoard: r.lbc >= maxBoardAll && maxBoardAll > 0, wasZbYesterday: zbYest.indexOf(r.code) >= 0 })
      if (rej) continue
      const sc = E.scoreBoard(r, feat, emo, { count: Math.max(2, Math.round(emo.zt / 6)), maxLbc: emo.maxLbc, isThemeTop: false, isMaxBoard: r.lbc >= maxBoardAll && maxBoardAll > 0 })
      boardCands.push({ cand: r, feat, sc })
    }
    boardCands.sort((a, b) => b.sc.score - a.sc.score)

    // 低吸候选（行业数据拿不全 → 题材未死门改用「同板联动队列」：昨日同日涨停群今天还剩几家）
    const dipCands = []
    let cohortCount = 0, cohortMaxLbc = 0
    if (emHist.length >= 2) {
      const prevZtRows = emHist[emHist.length - 2].rows
      const ztTodaySet = new Set(day.zt.map(r => r.code))
      const cohortToday = prevZtRows.filter(r => ztTodaySet.has(r.code))
      cohortCount = cohortToday.length
      cohortMaxLbc = cohortToday.reduce((m, r) => Math.max(m, r.lbc || 0), 0)
      for (const r of prevZtRows) {
        if (ztTodaySet.has(r.code)) continue
        if ((r.lbc || 0) < 2) continue                      // ★ 与生产端一致：1 板没有分歧低吸地位
        const feat = mkFeat(r.code, false)
        if (!feat.ok) continue
        const pct = feat.close / feat.prevClose - 1
        if (pct < E.P.guard.dipMinPct / 100 || pct > E.P.guard.dipMaxPct / 100) continue
        const rej = E.guardReject({ code: r.code, name: r.name, ltsz: r.ltsz, hs: NaN, zbc: NaN, fbt: 0, lbc: r.lbc, hybk: r.hybk }, feat, { isMaxBoard: false, wasZbYesterday: false, isDip: true })
        if (rej) continue
        const dip = { pct, ylbc: r.lbc || 1, volRatio: feat.volNow / Math.max(1, feat.volPrev), feat, hybk: r.hybk }
        const sc = E.scoreDip(dip, { count: cohortCount, maxLbc: cohortMaxLbc }, emo)
        if (!sc) continue
        const bp = E.dipBuyPrice(feat)
        if (!isFinite(bp)) continue
        dipCands.push({ cand: r, feat, sc, buyPrice: bp })
      }
      dipCands.sort((a, b) => b.sc.score - a.sc.score)
    }

    // 反向模式把被回避日当普通日处理：打板/低吸口子都开（ Otherwise 与正向完全同口径）
    const allowBoard = INVERSE || cc.cycle === '启动' || cc.cycle === '发酵'
    let chosen = []
    const dipCycleOk = !DIP_CYCLES || DIP_CYCLES.indexOf(cc.cycle) >= 0 || (cc.cycle === '退潮' && cc.repaired && DIP_CYCLES.indexOf('退潮') >= 0)
    if (STUDY_ALL) {
      // 研究模式：全部达标候选都结算（打板/低吸各自独立统计）
      if (allowBoard) for (const b of boardCands.filter(x => x.sc.score >= E.P.boardMinScore)) chosen.push({ ...b, strat: '打板' })
      if (cohortCount >= 2 && dipCycleOk) for (const d of dipCands.filter(x => x.sc.score >= MIN_DIP_SCORE && (x.cand.lbc || 0) <= DIP_MAX_LBC)) chosen.push({ ...d, strat: '低吸' })
    } else {
      if (allowBoard) {
        const b = boardCands.find(x => x.sc.score >= E.P.boardMinScore)
        if (b) chosen.push({ ...b, strat: '打板' })
      }
      if (chosen.length < E.P.pickCount && cohortCount >= 2 && dipCycleOk) {
        const d = dipCands.find(x => x.sc.score >= MIN_DIP_SCORE && (x.cand.lbc || 0) <= DIP_MAX_LBC && !chosen.some(c => c.cand.code === x.cand.code))
        if (d) chosen.push({ ...d, strat: '低吸' })
      }
    }

    // 撮合与结算
    for (const c of chosen) {
      const code = c.cand.code
      const bars = barsMap[code], m = idxMap[code]
      const iD = m ? m[date] : -1
      if (iD < 0 || iD + 10 >= bars.length) continue   // 未来数据不足（最近几天）
      const nextBar = bars[iD + 1]
      let entry = NaN, skipped = ''
      if (c.strat === '打板') {
        const bp = Math.round(E.limitPrice(code, bars[iD].c) * 100) / 100
        if (nextBar.o > bp * 1.07) skipped = '高开>7%放弃'
        else if (nextBar.o < bp * 0.97) skipped = '低开>3%放弃'
        else if (nextBar.h >= bp - 0.005) entry = bp
        else skipped = '未封板未成交'
      } else {
        const bp = c.buyPrice
        if (nextBar.o > bp * 1.03) skipped = '高开>3%不追'
        else if (nextBar.l <= bp) entry = Math.min(nextBar.o, bp)
        else skipped = '未回踩未成交'
      }
      const rec = {
        date, cycle: cc.cycle + (cc.repaired ? '·修复' : ''), strat: c.strat, cycleWhy: cc.why.join('；'),
        code, name: c.cand.name, industry: c.cand.hybk, score: c.sc.score,
        scoreBand: c.sc.score >= 70 ? '70+' : c.sc.score >= 60 ? '60-69' : c.sc.score >= 50 ? '50-59' : '<50',
        lbc: isFinite(c.cand.lbc) && c.cand.lbc > 0 ? c.cand.lbc : (c.feat ? c.feat.streak : NaN),
        lbcBand: (() => { const l = isFinite(c.cand.lbc) && c.cand.lbc > 0 ? c.cand.lbc : (c.feat ? c.feat.streak : NaN); return l >= 5 ? '5+' : l >= 4 ? '4' : l >= 3 ? '3' : l >= 2 ? '2' : l >= 1 ? '1' : '0' })(),
        reasons: c.sc.reasons, buyPrice: c.buyPrice || Math.round(E.limitPrice(code, bars[iD].c) * 100) / 100,
        recPrice: bars[iD].c, filled: isFinite(entry), entry, skipped
      }
      if (isFinite(entry)) {
        const win = bars[iD + 10].c / entry - 1
        let lo = Infinity
        for (let k = iD + 1; k <= iD + 10; k++) if (bars[k].l < lo) lo = bars[k].l
        rec.ret10 = win
        rec.maxDD = lo / entry - 1
        rec.state = win >= 0.02 ? 'win' : win <= -0.02 ? 'lose' : 'flat'
        rec.bagHold = rec.maxDD <= -0.08
        // ★ 纪律执行口径：plan 写明统一止损（默认 -5%，可用 --stopPct 扫描）—— 10 日内最低价触及 entry×(1-stop) 即按止损价出局
        const stopLine = 1 - STOP_PCT / 100
        let stopped = false
        for (let k = iD + 1; k <= iD + 10; k++) {
          if (bars[k].l <= entry * stopLine) { stopped = true; break }
        }
        rec.retExec = stopped ? -STOP_PCT / 100 : win
        rec.stopped = stopped
        rec.stateExec = stopped ? 'lose' : rec.state
      }
      results.push(rec)
    }
  }

  /* -------- 汇总（两套口径：裸持有 10 日 / 按纪律执行止损） -------- */
  const filled = results.filter(r => r.filled)
  const wins = filled.filter(r => r.state === 'win')
  const loses = filled.filter(r => r.state === 'lose')
  const flats = filled.filter(r => r.state === 'flat')
  const bags = filled.filter(r => r.bagHold)
  const stops = filled.filter(r => r.stopped)
  const execWins = filled.filter(r => r.stateExec === 'win')
  const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN
  process.stdout.write('\n===== 回测汇总（成交 ' + filled.length + ' / 触发 ' + results.length + '） =====\n')
  process.stdout.write('裸持有 10 日：胜 ' + wins.length + ' / 平 ' + flats.length + ' / 负 ' + loses.length +
    '，胜率 ' + (filled.length ? Math.round(wins.length / filled.length * 100) : '—') + '%' +
    '，平均收益 ' + (filled.length ? (avg(filled.map(r => r.ret10)) * 100).toFixed(1) + '%' : '—') + '\n')
  process.stdout.write('★ 纪律执行（-' + STOP_PCT + '% 止损）：胜率 ' + (filled.length ? Math.round(execWins.length / filled.length * 100) : '—') + '%' +
    '，平均收益 ' + (filled.length ? (avg(filled.map(r => r.retExec)) * 100).toFixed(1) + '%' : '—') +
    '，止损触发 ' + stops.length + ' 笔\n')
  process.stdout.write('接盘（裸持有 10 日内最大回撤 ≤-8%）' + bags.length + ' 笔，占成交 ' +
    (filled.length ? Math.round(bags.length / filled.length * 100) : '—') + '%（纪律执行口径下止损把这部分截断在 -5%）\n')
  process.stdout.write('纪律跳过（高开/低开/未封板/未回踩）' + (results.length - filled.length) + ' 笔——买点纪律真实拦截了追高\n')

  const group = (label, stateField, retField) => {
    const g = {}
    for (const r of filled) { const k = r[label]; (g[k] = g[k] || []).push(r) }
    for (const k of Object.keys(g)) {
      const arr = g[k]
      const w = arr.filter(r => r[stateField] === 'win').length
      process.stdout.write('  ' + k + '：' + w + '/' + arr.length + ' 胜（' + Math.round(w / arr.length * 100) + '%），均收益 ' +
        (avg(arr.map(r => r[retField])) * 100).toFixed(1) + '%\n')
    }
  }
  process.stdout.write('\n—— 按情绪周期（裸持有） ——\n'); group('cycle', 'state', 'ret10')
  process.stdout.write('\n—— 按情绪周期（纪律执行） ——\n'); group('cycle', 'stateExec', 'retExec')
  process.stdout.write('\n—— 按策略（纪律执行） ——\n'); group('strat', 'stateExec', 'retExec')
  if (STUDY_ALL) {
    process.stdout.write('\n—— 研究·按分数段（纪律执行） ——\n'); group('scoreBand', 'stateExec', 'retExec')
    process.stdout.write('\n—— 研究·按连板数（纪律执行） ——\n'); group('lbcBand', 'stateExec', 'retExec')
    process.stdout.write('\n—— 研究·按周期×策略（纪律执行） ——\n')
    const g2 = {}
    for (const r of filled) { const k = r.cycle + '·' + r.strat; (g2[k] = g2[k] || []).push(r) }
    for (const k of Object.keys(g2)) {
      const arr = g2[k]
      const w = arr.filter(r => r.stateExec === 'win').length
      process.stdout.write('  ' + k + '：' + w + '/' + arr.length + ' 胜（' + Math.round(w / arr.length * 100) + '%），均收益 ' +
        (avg(arr.map(r => r.retExec)) * 100).toFixed(1) + '%\n')
    }
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true })
  const RESULT_TAG = (INVERSE ? '-inverse' : '') + (STUDY_ALL ? '-all' : '') + (STOP_PCT !== 5 ? '-s' + STOP_PCT : '') +
    (SKIP_CYCLES.length ? '-x' + SKIP_CYCLES.join('') : '') + (MIN_DIP_SCORE !== E.P.dipMinScore ? '-m' + MIN_DIP_SCORE : '') +
    (DIP_CYCLES ? '-dc' + DIP_CYCLES.join('') : '') + (DIP_MAX_LBC !== 99 ? '-dl' + DIP_MAX_LBC : '')
  fs.writeFileSync(path.join(CACHE_DIR, 'leader-backtest-result' + RESULT_TAG + '.json'), JSON.stringify({
    mode: INVERSE ? 'inverse' : 'forward',
    stopPct: STOP_PCT, skipCycles: SKIP_CYCLES, minDipScore: MIN_DIP_SCORE,
    studyAll: STUDY_ALL, dipCycles: DIP_CYCLES, dipMaxLbc: DIP_MAX_LBC,
    days: DAYS, range: [testDates[0], testDates[testDates.length - 1]],
    summary: { filled: filled.length, wins: wins.length, loses: loses.length, flats: flats.length, bags: bags.length },
    results
  }, null, 1), 'utf8')
  fs.writeFileSync(path.join(CACHE_DIR, 'leader-backtest-result.json'), fs.readFileSync(path.join(CACHE_DIR, 'leader-backtest-result' + RESULT_TAG + '.json'), 'utf8'), 'utf8')
  process.stdout.write('\n明细已写 _tests/_cache/leader-backtest-result' + RESULT_TAG + '.json\n')
}

main().catch(e => { console.error('出错: ' + (e && e.message ? e.message : e)); process.exit(1) })
