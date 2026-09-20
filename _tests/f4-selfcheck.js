/* F4 自检（2026-09-20 用户诉求复核）
 *
 * 用户真实需求：中长线持股，不需要每天出信号，需要在**关键位置**（量能/结构/位置）说话：
 *   ① 上涨乏力、出货完成、无新增资金拉升
 *   ② 下跌衰竭、也无资金进场
 *   ③ 主力进场开始建仓
 *   并要求用周、月级别数据综合判断。
 *
 * 自检三件事：
 *   A. F4 的日频噪音到底多大（结论寿命、翻转率、多少"跟"其实在无变化区间）
 *   B. F4 缺"位置"维度的代价（高位喊跟 vs 低位喊跟的后续差异）
 *   C. 周/月级三态原型能否分辨（用日K聚合周K + 周级资金流，验证三态后续收益）
 *
 * 数据：_tests/_cache/bt-data.json（腾讯 qfq 日K 640 根 + 新浪 r0 主力净额）
 * 诚实纪律：样本小/不可分的必须如实说，不硬凑结论。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules';
module.paths.push(WS);
const { JSDOM, VirtualConsole } = require(path.join(WS, 'jsdom'));

const HI = 0.15, OVER = 0.25, DROP = -0.05;
const html = fs.readFileSync('D:/mywork/_preview/stock-picker-preview.html', 'utf8');
const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: new VirtualConsole(), url: 'https://local/' });
const w = dom.window;
const data = JSON.parse(fs.readFileSync(__dirname + '/_cache/bt-data.json', 'utf8')).stocks;
const codes = Object.keys(data);

function mean(a) { const v = a.filter(x => x !== null && isFinite(x)); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; }
function pct(n, d) { return d ? n / d * 100 : NaN; }
function fR(x) { return (x !== null && isFinite(x)) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '—'; }
function fP(x) { return (x !== null && isFinite(x)) ? x.toFixed(1) + '%' : '—'; }

/* F4 纯函数（与线上 fusionVerdict 同构） */
function fusion4(main, retail, overCost, ret20, psFlags) {
  if (psFlags && psFlags.force_no_trade) return { act: '躲', why: '诱多过滤' };
  let chip;
  if (isFinite(ret20) && ret20 > HI && (main === 'lift' || main === 'distribute')) chip = { act: '躲', why: '高位派发' };
  else if (main === 'lift') chip = { act: '躲', why: '主力已获利' };
  else if (main === 'outflow' || main === 'distribute' || main === 'driftdown') chip = { act: '观望', why: '主力在撤' };
  else if (retail === 'dip-buy') chip = { act: '观望', why: '散户抄底' };
  else if (main === 'accumulate' || main === 'inflow') {
    if (isFinite(overCost) && overCost > OVER) chip = { act: '观望', why: '远离主力成本' };
    else if (retail === 'surrender') chip = { act: '跟', why: '主力建仓+散户割肉' };
    else chip = { act: '跟', why: '主力在建仓' };
  }
  else if (retail === 'surrender') chip = { act: '跟', why: '散户割肉' };
  else if (retail === 'chase') chip = { act: '躲', why: '散户追高' };
  else chip = { act: '观望', why: '方向不明' };
  if (psFlags && psFlags.sell_bias) {
    if (main === 'outflow' || main === 'distribute') return { act: '躲', why: '破位+主力派发' };
    if (chip.act === '跟') return { act: '跟', why: '回踩·' + chip.why, pullback: true };
    return chip;
  }
  return chip;
}

/* 周线聚合（ISO 周：取该周最后一根日K为周收盘） */
function weekKey(dstr) {
  const d = new Date(dstr + 'T00:00:00Z');
  const day = d.getUTCDay() || 7;              // 周日=7
  d.setUTCDate(d.getUTCDate() + (4 - day));    // 周四在该周（ISO）
  return d.toISOString().slice(0, 10);
}

function build() {
  const rows = [];
  for (const code of codes) {
    const st = data[code], bars = st.bars, flows = st.flows, fs_ = st.floatShares;
    const flowByDate = {};
    for (const f of flows) { const p = f.split(','); flowByDate[p[0]] = Number(p[1]); }
    const close = bars.map(b => b[2]), vol = bars.map(b => b[5]), dates = bars.map(b => b[0]);
    const WARM = 260, MAXF = 60;               // 需要 250 日分位 + 60 日前瞻
    /* 周表：每周的收盘/量/主力净额（按日聚合，不依赖新接口） */
    const wk = {};
    for (let i = 0; i < bars.length; i++) {
      const k = weekKey(dates[i]);
      if (!wk[k]) wk[k] = { d: k, c: close[i], v: 0, m: 0, last: dates[i] };
      wk[k].c = close[i]; wk[k].v += vol[i]; wk[k].last = dates[i];
      if (isFinite(flowByDate[dates[i]])) wk[k].m += flowByDate[dates[i]];
    }
    const wks = Object.keys(wk).sort().map(k => wk[k]);

    for (let i = WARM; i < bars.length - MAXF; i++) {
      const date = dates[i];
      const mainYi = flowByDate[date];
      if (!isFinite(mainYi)) continue;
      const chg = close[i] / close[i - 1] - 1;
      const ret20 = close[i] / close[i - 20] - 1;
      const ret60 = close[i] / close[i - 60] - 1;
      /* 位置：近 250 日分位 */
      let hi = -Infinity, lo = Infinity;
      for (let j = i - 249; j <= i; j++) { if (close[j] > hi) hi = close[j]; if (close[j] < lo) lo = close[j]; }
      const pos250 = hi > lo ? (close[i] - lo) / (hi - lo) : NaN;

      let v5 = 0; for (let k = 4; k >= 0; k--) v5 += vol[i - k];
      const vr = (v5 / 5) > 0 ? vol[i] / (v5 / 5) : NaN;
      const dirs = [w.v3sign(chg), w.v3sign(mainYi), w.v3sign(ret20)];
      const vote = w.v3Vote(dirs);
      let ps = null;
      try { const row = w.v3PsRow(bars.slice(0, i + 1)); ps = row ? w.psCalc(row) : null } catch (e) { }
      w.G.v3Map = w.G.v3Map || {};
      w.G.v3Map[code] = { state: vote.state, dirs: dirs, srcs: vote.srcs, agreeN: vote.agreeN, majority: vote.majority,
        conf: vote.conf, chg: chg, mainYi: mainYi / 1e8, ret20: ret20, vr: vr, ps: ps || undefined };

      const flowsUpTo = flows.filter(f => f.split(',')[0] <= date);
      let chip = null;
      try { const r = w.ChipCore.analyze({ code: code, name: code, bars: bars.slice(0, i + 1), flows: flowsUpTo, floatShares: fs_ }); if (r && r.ok) chip = r; } catch (e) { }
      if (!chip) continue;
      const mainK = chip.mainBehavior && chip.mainBehavior.key;
      const retailK = chip.retailBehavior && chip.retailBehavior.key;
      const mc = chip.chips && chip.chips.mainCost;
      const overCost = (isFinite(mc) && mc > 0) ? (close[i] / mc - 1) : NaN;
      const fu4 = fusion4(mainK, retailK, overCost, ret20, ps && ps.flags);

      /* ---- 周/月级特征（截止当日，只用 <= date 的数据，无未来函数）---- */
      const wIdx = wks.findIndex(x => x.last > date);
      const wEnd = wIdx < 0 ? wks.length - 1 : wIdx - 1;      // 只用已完成的周
      const wClose = wks.slice(0, wEnd + 1).map(x => x.c);
      const wVol = wks.slice(0, wEnd + 1).map(x => x.v);
      const wMain = wks.slice(0, wEnd + 1).map(x => x.m);
      function wma(n) { if (wClose.length < n) return NaN; let s = 0; for (let j = wClose.length - n; j < wClose.length; j++) s += wClose[j]; return s / n; }
      const volRatio = wVol.length >= 26 ? (wVol.slice(-4).reduce((a, b) => a + b, 0) / 4) / (wVol.slice(-26).reduce((a, b) => a + b, 0) / 26) : NaN;
      /* 主力 4 周净额 / 流通市值（按现价近似流通市值） */
      const mv = fs_ * close[i];
      const main4w = wMain.length >= 4 ? wMain.slice(-4).reduce((a, b) => a + b, 0) / mv : NaN;
      const wma5 = wma(5), wma10 = wma(10), wma20 = wma(20);

      /* 三态原型（用户要的：①上涨乏力/派发完毕 ②下跌衰竭无资金 ③主力建仓） */
      let stage = '趋势运行中';
      if (pos250 > 0.65 && ret60 > 0.20 && (volRatio < 1.0 || main4w < 0)) stage = '①上涨乏力·派发完毕';
      else if (ret60 < -0.15 && volRatio < 0.85 && Math.abs(main4w) < 0.004) stage = '②下跌衰竭·无资金进场';
      else if (main4w > 0.004 && ret60 < 0.15) stage = '③主力进场建仓';

      rows.push({
        code: code, date: date,
        act: fu4.act, why: fu4.why,
        mainK: mainK, retailK: retailK, ret20: ret20, ret60: ret60, pos250: pos250,
        volRatio: volRatio, main4w: main4w, wma5: wma5, wma10: wma10, wma20: wma20, stage: stage,
        fwd: { 20: close[i + 20] / close[i] - 1, 60: close[i + 60] / close[i] - 1 }
      });
    }
  }
  return rows;
}

;(async () => {
  await new Promise(r => setTimeout(r, 300));
  if (!w.ChipCore || !w.v3PsRow) { console.log('❌ 缺全局函数'); process.exit(1) }
  const rows = build();
  console.log('样本：' + codes.length + ' 只 × ' + rows.length + ' 点（2024-01~2026-09，需 250 日分位预热 + 60 日前瞻）');
  console.log('基准：20 日 ' + fR(mean(rows.map(r => r.fwd[20]))) + '，60 日 ' + fR(mean(rows.map(r => r.fwd[60]))) +
    '，60 日内跌超 5% ' + fP(pct(rows.filter(r => r.fwd[60] <= DROP).length, rows.length)));

  /* ===== A. F4 日频噪音 ===== */
  console.log('\n===== A. F4 的日频噪音 =====');
  const byCode = {};
  for (const r of rows) (byCode[r.code] = byCode[r.code] || []).push(r);
  let switchTotal = 0, dayTotal = 0, flip10 = 0, followTot = 0;
  for (const c of Object.keys(byCode)) {
    const rs = byCode[c];
    let sw = 0;
    for (let i = 1; i < rs.length; i++) if (rs[i].act !== rs[i - 1].act) sw++;
    switchTotal += sw; dayTotal += rs.length;
    /* 喊"跟"后 10 个样本日内结论是否翻成躲/观望 */
    for (let i = 0; i < rs.length - 10; i++) {
      if (rs[i].act === '跟') {
        followTot++;
        let flipped = false;
        for (let j = i + 1; j <= i + 10; j++) if (rs[j].act !== '跟') { flipped = true; break }
        if (flipped) flip10++;
      }
    }
  }
  console.log('结论平均寿命：' + (dayTotal / Math.max(switchTotal, 1)).toFixed(1) + ' 个样本日切换一次结论（切换 ' + switchTotal + ' 次 / ' + dayTotal + ' 点）');
  console.log('喊「跟」后 10 日内结论翻转比例：' + fP(pct(flip10, followTot)) + '（n=' + followTot + '）→ 这就是"每天都出信号"的噪音来源');
  const dist = {};
  for (const r of rows) dist[r.act] = (dist[r.act] || 0) + 1;
  console.log('结论分布：' + JSON.stringify(dist));

  /* ===== B. 位置维度缺失的代价 ===== */
  console.log('\n===== B. F4 缺「位置」维度的代价（同一"跟"信号，按近一年分位拆开）=====');
  const g = rows.filter(r => r.act === '跟');
  for (const [lab, fn] of [['高位 pos>0.7', r => r.pos250 > 0.7], ['中位 0.3~0.7', r => r.pos250 >= 0.3 && r.pos250 <= 0.7], ['低位 pos<0.3', r => r.pos250 < 0.3]]) {
    const l = g.filter(fn);
    if (!l.length) { console.log(lab + '：无样本'); continue }
    console.log(lab.padEnd(16) + 'n=' + String(l.length).padEnd(7) + '20日 ' + fR(mean(l.map(r => r.fwd[20]))).padEnd(9) +
      '60日 ' + fR(mean(l.map(r => r.fwd[60]))).padEnd(9) + '60日内跌超5% ' + fP(pct(l.filter(r => r.fwd[60] <= DROP).length, l.length)));
  }

  /* ===== C. 周/月级三态原型 ===== */
  console.log('\n===== C. 周/月级三态原型（用户要的三类关键位置）=====');
  const segs = [['2025H1', '2025-01-01', '2025-06-30'], ['2025H2', '2025-07-01', '2025-12-31'],
  ['2026H1', '2026-01-01', '2026-06-30'], ['2026Q3', '2026-07-01', '2026-12-31']];
  console.log('阶段'.padEnd(20) + '占比'.padEnd(8) + '20日'.padEnd(9) + '60日'.padEnd(9) + '60日跌超5%'.padEnd(12) + '分时段60日');
  const stg = {};
  for (const r of rows) (stg[r.stage] = stg[r.stage] || []).push(r);
  for (const k of ['①上涨乏力·派发完毕', '②下跌衰竭·无资金进场', '③主力进场建仓', '趋势运行中']) {
    const l = stg[k] || [];
    if (!l.length) { console.log(k + '：无样本'); continue }
    const seg = segs.map(([lab, a, b]) => (fR(mean(l.filter(r => r.date >= a && r.date <= b).map(r => r.fwd[60])))).padEnd(9));
    console.log(k.padEnd(22) + fP(pct(l.length, rows.length)).padEnd(9) + fR(mean(l.map(r => r.fwd[20]))).padEnd(10) +
      fR(mean(l.map(r => r.fwd[60]))).padEnd(10) + fP(pct(l.filter(r => r.fwd[60] <= DROP).length, l.length)).padEnd(13) + seg.join(''));
  }

  /* ===== D. 三态 × 位置 × 量能 的交叉（看有没有更强的关键位置信号）===== */
  console.log('\n===== D. 关键位置交叉验证 =====');
  const combos = [
    ['③建仓 + 低位(pos<0.4)', r => r.stage === '③主力进场建仓' && r.pos250 < 0.4],
    ['③建仓 + 缩量(volRatio<0.9)', r => r.stage === '③主力进场建仓' && r.volRatio < 0.9],
    ['③建仓 + 放量(volRatio>1.2)', r => r.stage === '③主力进场建仓' && r.volRatio > 1.2],
    ['②衰竭 + 周线站上MA20', r => r.stage === '②下跌衰竭·无资金进场' && isFinite(r.wma20) && r.wma5 > r.wma20],
    ['②衰竭 + 周线仍在MA20下', r => r.stage === '②下跌衰竭·无资金进场' && isFinite(r.wma20) && r.wma5 <= r.wma20],
    ['①派发 + 高位(pos>0.8)', r => r.stage === '①上涨乏力·派发完毕' && r.pos250 > 0.8],
    ['基准（全部）', () => true]
  ];
  for (const [lab, fn] of combos) {
    const l = rows.filter(fn);
    if (!l.length) { console.log(lab + '：无样本'); continue }
    const seg = segs.map(([lab2, a, b]) => (fR(mean(l.filter(r => r.date >= a && r.date <= b).map(r => r.fwd[60])))).padEnd(9));
    console.log(lab.padEnd(26) + 'n=' + String(l.length).padEnd(7) + '20日 ' + fR(mean(l.map(r => r.fwd[20]))).padEnd(9) +
      '60日 ' + fR(mean(l.map(r => r.fwd[60]))).padEnd(9) + '跌超5% ' + fP(pct(l.filter(r => r.fwd[60] <= DROP).length, l.length)).padEnd(9) + seg.join(''));
  }


  /* ===== E. 「真正的底部」是什么形态（用户要的②，实测原定义是陷阱，找替代）===== */
  console.log('\n===== E. 底部形态再验证：下跌之后必须看到资金进场 =====');
  const combos2 = [
    ['深跌(ret60<-20%) 无资金条件', r => r.ret60 < -0.20],
    ['深跌 + 主力净流入(main4w>0.4%)', r => r.ret60 < -0.20 && r.main4w > 0.004],
    ['深跌 + 主力净流入 + 低位(pos<0.4)', r => r.ret60 < -0.20 && r.main4w > 0.004 && r.pos250 < 0.4],
    ['深跌 + 缩量 + 主力净流入', r => r.ret60 < -0.20 && r.volRatio < 0.9 && r.main4w > 0.004],
    ['深跌 + 缩量 + 无资金（原②陷阱）', r => r.ret60 < -0.20 && r.volRatio < 0.9 && Math.abs(r.main4w) < 0.004],
    ['③建仓 强门槛(main4w>0.8%)', r => r.main4w > 0.008 && r.ret60 < 0.15],
    ['③建仓 + 低位 + 周线多头(wMA5>wMA20)', r => r.stage === '③主力进场建仓' && r.pos250 < 0.4 && isFinite(r.wma20) && r.wma5 > r.wma20]
  ];
  for (const [lab, fn] of combos2) {
    const l = rows.filter(fn);
    if (!l.length) { console.log(lab + '：无样本'); continue }
    const seg = segs.map(([lab2, a, b]) => (fR(mean(l.filter(r => r.date >= a && r.date <= b).map(r => r.fwd[60])))).padEnd(9));
    console.log(lab.padEnd(34) + 'n=' + String(l.length).padEnd(6) + '20日 ' + fR(mean(l.map(r => r.fwd[20]))).padEnd(9) +
      '60日 ' + fR(mean(l.map(r => r.fwd[60]))).padEnd(9) + '跌超5% ' + fP(pct(l.filter(r => r.fwd[60] <= DROP).length, l.length)).padEnd(9) + seg.join(''));
  }

  fs.writeFileSync(__dirname + '/_cache/f4-selfcheck-rows.json', JSON.stringify(rows.filter((_, i) => i % 7 === 0)));
  console.log('\n（抽样已存 _cache/f4-selfcheck-rows.json，供后续迭代）');
  process.exit(0);
})().catch(e => { console.log('❌ ' + (e && e.message || e)); process.exit(1) });
