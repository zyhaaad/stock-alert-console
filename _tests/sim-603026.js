/* 石大胜华 603026 · 日频回放（2026-04-28 → 2026-05-27）
 * 目的：用「当天及以前」的真实数据，驱动控制台里**真实的那几个函数**出结论，
 *       看系统在那段行情里每天会怎么提示。不做任何事后合理化（不引用未来数据解释当天结论）。
 * 数据源：
 *   日K   = 腾讯前复权（web.ifzq.gtimg.cn，qfq），已落盘 _tests/_cache/bars-603026.json
 *          （与腾讯自选股 qfq 逐笔交叉校验：收盘/成交量差异 0）
 *   恐贪  = stock-alert-cloud/fng-history.json（系统自己的归档）
 *   风格  = style-history.json 只有 1 天（2026-09-19），该窗口**无数据** → 大盘风格按缺失处理
 *   资金流 = 该窗口无历史源可得（东财 push2his 本机不通 / 自选股资金流限频 / 筹码归档 2026-09-17 才建）
 *          → 按系统真实的降级路径走：V3 源2 置 null + err「主力资金流不可得」；S2 mainRatio=NaN
 * 运行：node _tests/sim-603026.js
 */
const fs = require('fs');
const path = require('path');
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules';
module.paths.push(WS);
const { JSDOM } = require(path.join(WS, 'jsdom'));

const SRC = 'D:/mywork/stock-alert-console/console.html';
const CODE = '603026';
const FROM = '2026-04-28', TO = '2026-05-27';
const FLOAT_SHARES = 2.327e8;   /* 流通股本：新浪 curr_capital=23270 万股；与换手率反推一致（2.324~2.328 亿）*/

const raw = JSON.parse(fs.readFileSync('D:/mywork/_tests/_cache/bars-603026.json', 'utf8')).bars;
/* 腾讯 qfq: [d, o, c, h, l, v(手)] → normBars 形状 {d,o,c,h,l,v} */
const ALL = raw.map(b => ({ d: b[0], o: +b[1], c: +b[2], h: +b[3], l: +b[4], v: +b[5] }))
  .sort((a, b) => String(a.d).localeCompare(String(b.d)));
const BY_D = {}; ALL.forEach(b => { BY_D[b.d] = b });
const DATES = ALL.map(b => b.d).filter(d => d >= FROM && d <= TO);

const fngJ = JSON.parse(fs.readFileSync('D:/mywork/stock-alert-cloud/fng-history.json', 'utf8'));
const FNG = {}; (fngJ.days || []).forEach(r => { FNG[r[0]] = Number(r[1]) });

(async () => {
  const dom = new JSDOM(fs.readFileSync(SRC, 'utf8'), { runScripts: 'dangerously', pretendToBeVisual: true,
    url: 'https://stock-alert-console.app.workbuddy.host/console.html?demo=1' });
  const w = dom.window;
  await new Promise(r => setTimeout(r, 800));

  const secid = w.secidOf({ code: CODE });
  /* 假设：4/28 收盘建仓（成本 = 当日收盘）—— 止损位/浮盈都需要成本，这是唯一外部假设，已声明 */
  const COST = BY_D[DATES[0]].c;
  const rows = [];

  for (const D of DATES) {
    w.todayStr = () => D;                                  /* 让「本态第 N 天 / 冲突计数」按回放日算，而不是今天 */
    const idxAll = ALL.findIndex(b => b.d === D);
    const bars = ALL.slice(Math.max(0, idxAll - 499), idxAll + 1);   /* 控制台实际取 500 根 */
    const c = bars[bars.length - 1].c;
    const prev = bars.length > 1 ? bars[bars.length - 2].c : NaN;
    const chgPct = (isFinite(prev) && prev > 0) ? (c / prev - 1) * 100 : NaN;

    w.G.dayBars = { [CODE]: bars };
    w.G.quoteMap = { [secid]: { price: c, chg: chgPct, mv: FLOAT_SHARES * c, name: '石大胜华' } };
    /* 筹码/资金流：该窗口无数据 → 只给流通股本，让 mainRatio/mainCost 走 NaN（系统的诚实降级）*/
    w.G.chipMap = { [CODE]: { floatShares: FLOAT_SHARES, chips: {}, flows: {}, flowDaily: null } };
    w.G.cfg.holdings = [{ code: CODE, name: '石大胜华', cost: COST, qty: 1000 }];

    /* ---- V3 三源：完全照抄 v3Ensure 里的构造逻辑，只把「取数」换成回放数据 ---- */
    const v = { at: D, state: 'observe', dirs: [null, null, null], srcs: 0, agreeN: 0, majority: null,
      chg: NaN, mainYi: NaN, ret20: NaN, conflictDays: 0, conf: 0.2, err: '', ps: null, psErr: '' };
    v.dirs[0] = w.v3sign(chgPct); v.chg = chgPct;                       /* 源1 当日涨跌 */
    v.err = '主力资金流不可得';                                          /* 源2 缺失（如实标注）*/
    const b40 = bars.slice(-40);
    if (b40.length >= 21) {
      const cNow = w.v3CloseAt(b40, b40.length - 1), cPrev = w.v3CloseAt(b40, b40.length - 21);
      if (isFinite(cNow) && isFinite(cPrev) && cPrev > 0) { v.ret20 = cNow / cPrev - 1; v.dirs[2] = w.v3sign(v.ret20) }
      const psRow = w.v3PsRow(b40);
      if (psRow) v.ps = w.psCalc(psRow); else v.psErr = 'K线不足';
    }
    v.srcs = v.dirs.filter(d => d !== null).length;
    const vote = w.v3Vote(v.dirs);
    v.agreeN = vote.agreeN; v.majority = vote.majority;
    const st = w.v3StateLoad();                                          /* 冲突天数跨日持久（同真实系统）*/
    if (vote.state === 'observe') { v.state = 'observe' }
    else if (vote.state === 'downgrade') {
      const rec = st[CODE] || {};
      if (rec.lastDate !== D) { rec.conflictDays = (rec.conflictDays || 0) + 1; rec.lastDate = D; st[CODE] = rec; w.v3StateSave(st) }
      v.conflictDays = rec.conflictDays || 0;
      if (v.conflictDays >= 3 && isFinite(v.ret20) && v.ret20 > 0.15) { v.state = 'trend'; v.conf = 0.7 }
      else { v.state = 'downgrade'; v.conf = 0.2 }
    } else {
      const rec2 = st[CODE] || {};
      if (rec2.lastDate && rec2.lastDate !== D && (rec2.conflictDays || 0) > 0) { st[CODE] = { conflictDays: 0, lastDate: D }; w.v3StateSave(st) }
      v.state = 'normal'; v.conf = 0.8;
    }
    w.G.v3Map = { [CODE]: v };

    /* ---- 大盘：恐贪按回放日喂；风格该窗口无数据（归档只有 1 天）---- */
    const fngSeries = (fngJ.days || []).filter(r => r[0] <= D).map(r => ({ d: r[0], v: Number(r[1]) }));
    w.FNG.loaded = true; w.FNG.series = fngSeries; w.FNG.live = null;
    w.STYLE.loaded = false; w.STYLE.data = null;
    const mkt = w.mlMarketCtx();

    /* ---- 出结论（调用真实函数）---- */
    const ws = w.weekStage(CODE);
    const rul = w.psRuling(v);
    const fv = w.fusionVerdict({ code: CODE });
    const stop = w.mlStopLoss(CODE);
    const hd = w.v3Head(CODE);

    let run = 0;
    if (ws && ws.key !== 'trending') {
      const isNew = w.mlChanged(CODE, ws.key, 'sa_ml_state_v1');
      run = isNew ? 1 : Math.max(1, w.mlRunDays(CODE, ws.key));
    }

    rows.push({
      d: D, c: c, chg: chgPct,
      s2key: ws ? ws.key : '(无)', s2act: ws ? ws.act : '(K线不足)', s2tone: ws ? ws.tone : '',
      run: run,
      pos250: ws ? ws.pos250 : NaN, overMa5: ws ? ws.overMa5 : NaN, streak5: ws ? ws.streak5 : 0,
      topWarn: ws ? ws.topWarn : false, topStrong: ws ? ws.topStrong : false,
      volRatio: ws ? ws.volRatio : NaN, ret60: ws ? ws.ret60 : NaN,
      supDist: ws ? ws.supDist : NaN,
      v3state: v.state, dirs: v.dirs.slice(), conf: v.conf, cd: v.conflictDays, ret20: v.ret20, agreeN: v.agreeN,
      ps: v.ps ? (v.ps.score + '分·' + v.ps.bias) : (v.psErr || '—'),
      psFlags: v.ps ? Object.keys(v.ps.flags || {}).filter(k => v.ps.flags[k]) : [],
      rul: rul && rul.t ? rul.t : '以主力博弈为准',
      fv: fv ? (fv.act + '（' + fv.why + (fv.pullback ? '·回踩' : '') + '）') : '(无筹码数据→不出)',
      v3head: hd ? hd.t : '', v3adv: hd ? hd.a : '',
      stop: stop ? stop.stop : NaN, gap: stop ? stop.gap : NaN, hit: stop ? stop.hit : false,
      fng: mkt && isFinite(mkt.fng) ? mkt.fng : NaN,
      fngZone: mkt && isFinite(mkt.fng) ? w.mlFngZone(mkt.fng) : '',
      advice: ws ? ws.advice : ''
    });
  }

  /* ---------- 输出 ---------- */
  const pct = (x, n) => (isFinite(x) ? (x * 100).toFixed(n == null ? 1 : n) + '%' : '—');
  const num = (x, n) => (isFinite(x) ? x.toFixed(n == null ? 2 : n) : '—');
  const V3TXT = { normal: '主信号', downgrade: '数据冲突·下修', observe: '源不足·观察', trend: '趋势跟随' };

  console.log('===== 石大胜华 603026 日频回放（前复权）=====');
  console.log('窗口 ' + FROM + ' → ' + TO + '，共 ' + DATES.length + ' 个交易日；假设成本 = 首日收盘 ' + num(COST) + ' 元');
  console.log('资金流该窗口无历史源 → V3 源2 缺失、S2 资金维度为 NaN（按系统真实降级路径，非事后补数）\n');

  console.log('日期        收盘    涨跌     S2状态              第N天  一年位置  偏离MA5  连站  量能比   恐贪        V3判定          冲突  止损位   距止损  系统提示');
  console.log('—'.repeat(150));
  for (const r of rows) {
    console.log(
      r.d + '  ' + num(r.c).padStart(7) + ' ' + (isFinite(r.chg) ? (r.chg > 0 ? '+' : '') + r.chg.toFixed(2) + '%' : '  —  ').padStart(7) +
      '  ' + (r.s2act + (r.s2key !== '(无)' ? '' : '')).padEnd(18) +
      '  ' + String(r.run || '-').padStart(4) +
      '   ' + pct(r.pos250, 0).padStart(5) + '   ' + pct(r.overMa5).padStart(7) + '  ' + String(r.streak5).padStart(3) +
      '  ' + num(r.volRatio).padStart(6) + '  ' + (isFinite(r.fng) ? (r.fng.toFixed(1) + '·' + r.fngZone) : '—').padStart(10) +
      '  ' + (V3TXT[r.v3state] || r.v3state).padEnd(14) + '  ' + String(r.cd).padStart(3) +
      '  ' + num(r.stop).padStart(7) + '  ' + pct(r.gap).padStart(7) +
      '  ' + (r.s2key === 'sell-overheat' ? '⚠ 减仓（分批兑现，不是清仓）'
        : r.s2key === 'accumulate-zone' ? '买点：分批建仓'
        : r.s2key === 'fall-not-done' ? '⚠ 未跌完，别抄底'
        : r.s2key === 'trending' ? '趋势运行中·无需操作' : '—')
    );
  }

  console.log('\n===== 逐日明细（结论原文 + 三源）=====');
  for (const r of rows) {
    console.log('\n【' + r.d + '】收盘 ' + num(r.c) + '（' + (isFinite(r.chg) ? (r.chg > 0 ? '+' : '') + r.chg.toFixed(2) : '—') + '%）');
    console.log('  中长线 S2：' + r.s2act + (r.run ? '（第 ' + r.run + ' 天）' : '') + ' ｜ ' + r.s2key);
    if (r.advice) console.log('    → ' + r.advice.replace(/\s+/g, ' '));
    console.log('  指标：一年位置 ' + pct(r.pos250, 0) + ' ｜ 距周级支撑 ' + pct(r.supDist) + ' ｜ 偏离MA5 ' + pct(r.overMa5) +
      ' ｜ 连站MA5 ' + r.streak5 + ' 日 ｜ 周量能比 ' + num(r.volRatio) + ' ｜ 60日 ' + pct(r.ret60) +
      ' ｜ 资金 ' + '—(无数据)');
    console.log('  三源：①涨跌 ' + w.v3SignTxt(r.dirs[0]) + '（' + (isFinite(r.chg) ? (r.chg > 0 ? '+' : '') + r.chg.toFixed(2) + '%' : '—') + '）' +
      ' ｜ ②主力净额 ' + w.v3SignTxt(r.dirs[1]) + '（源缺失）｜ ③20日 ' + w.v3SignTxt(r.dirs[2]) + '（' + pct(r.ret20) + '）');
    console.log('  V3：' + (V3TXT[r.v3state] || r.v3state) + '（' + (r.agreeN == null ? '-' : r.agreeN) + ' 源一致 / 共 ' + r.dirs.filter(x => x !== null).length +
      ' 源，置信 ' + r.conf.toFixed(2) + '，冲突 ' + r.cd + ' 天）｜ 价格结构 ' + r.ps +
      (r.psFlags.length ? ' [' + r.psFlags.join(',') + ']' : '') + ' ｜ 裁决 ' + r.rul);
    console.log('  综合研判：' + r.fv + ' ｜ 风控：止损位 ' + num(r.stop) + '，现价距 ' + pct(r.gap) + (r.hit ? '（已跌破）' : '') +
      ' ｜ 大盘：恐贪 ' + (isFinite(r.fng) ? r.fng.toFixed(1) + '·' + r.fngZone : '—') + '，风格 无数据');
  }

  /* ---------- 汇总 ---------- */
  const sell = rows.filter(r => r.s2key === 'sell-overheat');
  const brk = rows.filter(r => r.hit);
  const cnt = {}; rows.forEach(r => { cnt[r.v3state] = (cnt[r.v3state] || 0) + 1 });
  const fg = rows.filter(r => isFinite(r.fng)).map(r => r.fng);
  console.log('\n===== 汇总 =====');
  console.log('S2 高位过热·减仓：' + (sell.length ? sell.map(r => r.d + '(收盘' + num(r.c) + ')').join('、') : '无'));
  console.log('止损位 ' + num(rows[0].stop) + ' 被跌破的收盘日：' + (brk.length ? brk.map(r => r.d).join('、') : '无'));
  console.log('V3 判定分布：' + Object.keys(cnt).map(k => (V3TXT[k] || k) + ' ' + cnt[k] + ' 天').join(' ｜ '));
  console.log('恐贪区间：' + (fg.length ? Math.min.apply(null, fg).toFixed(1) + ' → ' + Math.max.apply(null, fg).toFixed(1) : '—'));
  console.log('\n缺失与降级（如实标注，未用未来数据补）：');
  console.log('  · 主力资金流：该窗口无历史源可得 → V3 源2 恒为 null（err「主力资金流不可得」），S2 资金维度 NaN。');
  console.log('    影响：① V3 只剩 2 源，两源不一致时 1/2=50% < 66% → 判「数据冲突·下修」（三源齐全时可能不同）；');
  console.log('          ② 「主力建仓区」因 mainRatio 为 NaN **不可能触发**（fail-closed）；');
  console.log('          ③ 「下跌未完」的 |mainRatio|<0.004 分支在缺数据时按代码逻辑为真（fail-open），本窗口 ret60 未达 −20%，未触发。');
  console.log('  · 筹码：归档 2026-09-17 才建立 → 该窗口无数据，综合研判走「破位待核验」分支，S2 只说「筹码数据没取到」。');
  console.log('  · 大盘风格：style-history.json 仅 1 天（2026-09-19）→ 该窗口无数据，大盘块只剩恐贪。');
  console.log('  · 未受影响、完全由真实前复权行情驱动：S2 位置/结构/量能/高位过热、V3 源1+源3、价格结构 v2.1、−10% 止损、恐贪。');
  process.exit(0);
})().catch(e => { console.log('回放崩溃：' + (e && e.stack || e)); process.exit(1); });
