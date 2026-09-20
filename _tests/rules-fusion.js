/* V3 × 筹码透视 融合方案回测（私有研究）
 *
 * 设计原则（防过拟合）：
 *   ① **不新拟合参数** —— 只复用两套规则里已有的常量（ret20>15% 算高位、P.bigMove 透支阈值、
 *      V3 价格结构硬裁决）。融合的是「谁在什么时候说话」的逻辑，不是调数字。
 *   ② **样本内 / 样本外分离** —— 2025 年为内、2026 年为外；先看内、再看外是否同样成立。
 *   ③ **不看总体准确率** —— 总体准确率会被市场单边行情带偏。改看：
 *        · 分市场环境（上涨 / 下跌 / 震荡）
 *        · 极端下跌的召回（大跌前有没有提前说躲）与提升倍数 lift
 *        · 逃顶灵敏度：真正大跌的样本里，信号提前喊躲的比例
 *
 * 融合逻辑（先验：中期定方向，短期定时机）：
 *   基调 = 筹码透视（20 日累计资金流，平滑，抓主力中期意图）+ 散户行为反向修正
 *   覆盖 = V3 价格结构硬裁决（诱多 / 破位）—— 当日量价异常，管「逃顶」
 *   降级 = 高位（20 日涨超 15%）且主力已获利 → 别追
 * 运行：node rules-fusion.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules';
module.paths.push(WS);
const { JSDOM, VirtualConsole } = require(path.join(WS, 'jsdom'));

const FWD = [5, 10, 20];
const WARM = 60;
const MAXF = 20;
const HI = 0.15;              // 复用 V3 的 hi：20 日涨超 15% 算高位
const DROP = -0.05;           // 「大跌」定义：20 日后跌超 5%

const html = fs.readFileSync('D:/mywork/_preview/stock-picker-preview.html', 'utf8');
const vc = new VirtualConsole();
const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: vc, url: 'https://local/' });
const w = dom.window;
const data = JSON.parse(fs.readFileSync(__dirname + '/_cache/bt-data.json', 'utf8')).stocks;
const codes = Object.keys(data).filter(c => data[c].bars.length > WARM + MAXF + 5 && data[c].flows.length > WARM);

function mean(a) { if (!a.length) return NaN; let s = 0; for (const x of a) s += x; return s / a.length; }
function pct(n, d) { return d ? n / d * 100 : NaN; }
function fR(x) { return isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(2) + '%' : '—'; }
function fP(x) { return isFinite(x) ? x.toFixed(1) + '%' : '—'; }

/* ---------- 融合规则（纯逻辑，无可调参数） ---------- */
function fusion(main, retail, overCost, ret20, psFlags, v3k) {
  /* ① 硬裁决覆盖：当日量价出现诱多 / 破位，不管中期基调，一律躲 */
  if (psFlags && (psFlags.force_no_trade || psFlags.sell_bias)) return { act: '躲', why: '硬裁决' };

  /* ② 高位 + 主力已获利 → 别追（降级，不跟） */
  if (isFinite(ret20) && ret20 > HI && (main === 'lift' || main === 'distribute')) return { act: '躲', why: '高位派发' };

  /* ③ 中期基调：主力在收 → 跟；主力在撤 → 躲 */
  if (main === 'accumulate' || main === 'inflow') {
    if (isFinite(overCost) && overCost > 0.25) return { act: '观望', why: '已远离主力成本' };
    if (retail === 'dip-buy') return { act: '观望', why: '主力收但散户在抄底' };
    return { act: '跟', why: '主力在建仓' };
  }
  if (main === 'outflow' || main === 'distribute' || main === 'driftdown') {
    return { act: '躲', why: '主力在撤' };
  }
  /* ④ 散户行为反向修正（筹码从散户转主力 = 可跟；散户在接盘 = 躲） */
  if (retail === 'surrender') return { act: '跟', why: '散户割肉' };
  if (retail === 'chase') return { act: '躲', why: '散户追高' };
  if (retail === 'dip-buy') return { act: '躲', why: '散户抄底' };
  if (main === 'lift') return { act: '观望', why: '主力已获利' };
  return { act: '观望', why: '方向不明' };
}

/* F2：在 F1 基础上做「躲信号收敛」——躲 = 卖出，代价高，只在稳健证据下才喊。
   依据全部取自**样本内 2025**（不是全样本），再用 2026 样本外验证，避免过拟合：
     · 主力在撤（drift/outflow/distribute）：2025H1 +3.92% / 2025H2 +2.61% → 后续仍涨，降为观望
     · 散户抄底：2025H1 +4.65% / 2025H2 +1.08% → 同样降为观望
     · 主力已获利 lift：2025H1 -3.97% / 2025H2 -0.43% → 4/4 时段为负，升为躲
   参数一个没加，仍是复用 HI=15% 与 overCost 25%。 */
function fusion2(main, retail, overCost, ret20, psFlags) {
  if (psFlags && (psFlags.force_no_trade || psFlags.sell_bias)) return { act: '躲', why: '硬裁决' };
  if (isFinite(ret20) && ret20 > HI && (main === 'lift' || main === 'distribute')) return { act: '躲', why: '高位派发' };
  if (main === 'lift') return { act: '躲', why: '主力已获利' };
  if (main === 'outflow' || main === 'distribute' || main === 'driftdown') return { act: '观望', why: '主力在撤' };
  if (retail === 'dip-buy') return { act: '观望', why: '散户抄底' };
  if (main === 'accumulate' || main === 'inflow') {
    if (isFinite(overCost) && overCost > 0.25) return { act: '观望', why: '远离主力成本' };
    return { act: '跟', why: '主力在建仓' };
  }
  if (retail === 'surrender') return { act: '跟', why: '散户割肉' };
  if (retail === 'chase') return { act: '躲', why: '散户追高' };
  return { act: '观望', why: '方向不明' };
}

/* F3：修 F2 的「全市场普跌时全是躲」缺陷（2026-09-19 用户实盘反馈 16 只里 15 只躲）。
   不加新参数，只改覆盖逻辑 —— 依据 V3 自身 psRuling 的既有语义（破位+主力派发=强减仓）：
     · force_no_trade（诱多过滤，罕见且最准）→ 保留硬躲
     · sell_bias（破位）→ 只有主力同向在撤（outflow/distribute）才升躲；
       否则只当买入门禁：跟→观望（暂缓买入），观望/躲维持
   先验来自用户诉求：跟随主力建仓买入 > 逃顶；回踩中的建仓不该被 MA5<MA10 一票否决。 */
function fusion3(main, retail, overCost, ret20, psFlags) {
  if (psFlags && psFlags.force_no_trade) return { act: '躲', why: '诱多过滤' };
  /* 先算筹码侧结论（同 fusion2，去掉 ps 硬裁决分支） */
  let chip;
  if (isFinite(ret20) && ret20 > HI && (main === 'lift' || main === 'distribute')) chip = { act: '躲', why: '高位派发' };
  else if (main === 'lift') chip = { act: '躲', why: '主力已获利' };
  else if (main === 'outflow' || main === 'distribute' || main === 'driftdown') chip = { act: '观望', why: '主力在撤' };
  else if (retail === 'dip-buy') chip = { act: '观望', why: '散户抄底' };
  else if (main === 'accumulate' || main === 'inflow') {
    if (isFinite(overCost) && overCost > 0.25) chip = { act: '观望', why: '远离主力成本' };
    else chip = { act: '跟', why: '主力在建仓' };
  }
  else if (retail === 'surrender') chip = { act: '跟', why: '散户割肉' };
  else if (retail === 'chase') chip = { act: '躲', why: '散户追高' };
  else chip = { act: '观望', why: '方向不明' };
  /* sell_bias：主力同向在撤 → 躲（强减仓语义）；否则只挡买入 */
  if (psFlags && psFlags.sell_bias) {
    if (main === 'outflow' || main === 'distribute') return { act: '躲', why: '破位+主力派发' };
    if (chip.act === '跟') return { act: '观望', why: '破位暂缓买入' };
    return chip;
  }
  return chip;
}

/* F4：修 F3 的「破位门禁拦掉回踩买点」（2026-09-19 用户反馈：观望又全屏）。
   回测证据（F3 分支表）：破位暂缓买入 n=1093，10日 +2.61% / 20日 +4.53% / 中继率 20.6%，
   分时段 +2.34/+5.69/+2.91/+9.12 全正 —— 被拦下的恰恰是「建仓+回踩」的好买点（比非回踩建仓 +1.24% 更好）。
   F4：sell_bias 不再挡买入，只在「破位+主力同向派发」时升躲；跟信号保留但标注（回踩）。
   原则：躲=卖出，代价高，只在两源同向时喊；买入判断交给筹码侧中期方向。 */
function fusion4(main, retail, overCost, ret20, psFlags) {
  if (psFlags && psFlags.force_no_trade) return { act: '躲', why: '诱多过滤' };
  let chip;
  if (isFinite(ret20) && ret20 > HI && (main === 'lift' || main === 'distribute')) chip = { act: '躲', why: '高位派发' };
  else if (main === 'lift') chip = { act: '躲', why: '主力已获利' };
  else if (main === 'outflow' || main === 'distribute' || main === 'driftdown') chip = { act: '观望', why: '主力在撤' };
  else if (retail === 'dip-buy') chip = { act: '观望', why: '散户抄底' };
  else if (main === 'accumulate' || main === 'inflow') {
    if (isFinite(overCost) && overCost > 0.25) chip = { act: '观望', why: '远离主力成本' };
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

function build() {
  const rows = [];
  for (const code of codes) {
    const st = data[code], bars = st.bars, flows = st.flows, fs_ = st.floatShares;
    const flowByDate = {};
    for (const f of flows) { const p = f.split(','); flowByDate[p[0]] = Number(p[1]); }
    const close = bars.map(b => b[2]), vol = bars.map(b => b[5]);
    for (let i = WARM; i < bars.length - MAXF; i++) {
      const date = bars[i][0];
      const mainYi = flowByDate[date];
      if (!isFinite(mainYi)) continue;
      const chg = close[i] / close[i - 1] - 1;
      const ret20 = close[i] / close[i - 20] - 1;
      let v5 = 0; for (let k = 4; k >= 0; k--) v5 += vol[i - k];
      const vr = (v5 / 5) > 0 ? vol[i] / (v5 / 5) : NaN;

      const dirs = [w.v3sign(chg), w.v3sign(mainYi), w.v3sign(ret20)];
      const vote = w.v3Vote(dirs);
      const barsUpTo = bars.slice(0, i + 1);
      let ps = null;
      /* ⚠️ 修正（2026-09-19）：此前只调了 v3PsRow（评分行），漏了 psCalc ——
         导致回测里 ps 硬裁决分支从未触发，与线上 fusionVerdict 行为不一致。
         现在与线上 v3Ensure 同口径：v3PsRow → psCalc → flags。 */
      try { const row = w.v3PsRow(barsUpTo); ps = row ? w.psCalc(row) : null } catch (e) { }
      w.G.v3Map = w.G.v3Map || {};
      w.G.v3Map[code] = {
        state: vote.state, dirs: dirs, srcs: vote.srcs, agreeN: vote.agreeN, majority: vote.majority,
        conf: vote.conf, chg: chg, mainYi: mainYi / 1e8, ret20: ret20, vr: vr, ps: ps || undefined
      };
      const hd = w.v3Head(code);
      if (!hd) continue;
      const rul = ps ? w.psRuling(w.G.v3Map[code]) : null;

      const flowsUpTo = flows.filter(f => f.split(',')[0] <= date);
      let chip = null;
      try {
        const r = w.ChipCore.analyze({ code: code, name: code, bars: barsUpTo, flows: flowsUpTo, floatShares: fs_ });
        if (r && r.ok && r.stance) chip = r;
      } catch (e) { }
      if (!chip) continue;

      const mainK = chip.mainBehavior && chip.mainBehavior.key;
      const retailK = chip.retailBehavior && chip.retailBehavior.key;
      const mc = chip.chips && chip.chips.mainCost;
      const overCost = (isFinite(mc) && mc > 0) ? (close[i] / mc - 1) : NaN;
      const fu = fusion(mainK, retailK, overCost, ret20, ps && ps.flags, hd.k);
      const fu2 = fusion2(mainK, retailK, overCost, ret20, ps && ps.flags);
      const fu3 = fusion3(mainK, retailK, overCost, ret20, ps && ps.flags);
      const fu4 = fusion4(mainK, retailK, overCost, ret20, ps && ps.flags);

      rows.push({
        code: code, date: date,
        v3a: hd.k === 'good' ? '跟' : (hd.k === 'bad' ? '躲' : '观望'), v3t: hd.t,
        cAct: chip.stance.action === 'hold' ? '跟' : ((chip.stance.action === 'trim' || chip.stance.action === 'reduce') ? '躲' : '观望'),
        fa: fu.act, why: fu.why,
        fa2: fu2.act, why2: fu2.why,
        fa3: fu3.act, why3: fu3.why,
        fa4: fu4.act, why4: fu4.why,
        mainK: mainK, retailK: retailK, ret20: ret20,
        hardRuling: !!(ps && ps.flags && (ps.flags.force_no_trade || ps.flags.sell_bias)),
        psHard: (ps && ps.flags && ps.flags.force_no_trade) ? 'force' : ((ps && ps.flags && ps.flags.sell_bias) ? 'sell' : ''),
        fwd: { 5: close[i + 5] / close[i] - 1, 10: close[i + 10] / close[i] - 1, 20: close[i + 20] / close[i] - 1 }
      });
    }
  }
  return rows;
}

/* ---------- 评估 ---------- */
function evalAct(rows, field, label) {
  const g = { '跟': [], '躲': [], '观望': [] };
  for (const r of rows) g[r[field]].push(r);
  const out = { label: label };
  for (const a of ['跟', '躲']) {
    const list = g[a];
    const f10 = mean(list.map(r => r.fwd[10]));
    const f20 = mean(list.map(r => r.fwd[20]));
    let hit = 0, tot = 0;
    for (const r of list) { const v = r.fwd[10]; if (!isFinite(v)) continue; tot++; if ((a === '跟' && v > 0) || (a === '躲' && v < 0)) hit++; }
    out[a] = { n: list.length, f10: f10, f20: f20, hit10: pct(hit, tot) };
  }
  out['观望'] = { n: g['观望'].length };
  return out;
}

/* 极端下跌：躲信号有没有提前预警（逃顶） */
function dropEval(rows, field) {
  const all = rows.filter(r => isFinite(r.fwd[20]));
  const baseDrop = all.filter(r => r.fwd[20] <= DROP).length;           // 基准大跌数
  const baseRate = pct(baseDrop, all.length);
  const dodge = all.filter(r => r[field] === '躲');
  const dodgeDrop = dodge.filter(r => r.fwd[20] <= DROP).length;
  const prec = pct(dodgeDrop, dodge.length);                            // 说躲 → 真大跌（精准）
  const recall = pct(dodgeDrop, baseDrop);                              // 真大跌 → 提前说躲（召回）
  const lift = prec / baseRate;                                         // 相对基准的提升倍数
  const follow = all.filter(r => r[field] === '跟');
  const followDrop = pct(follow.filter(r => r.fwd[20] <= DROP).length, follow.length);
  return { n: all.length, baseRate: baseRate, dodgeN: dodge.length, prec: prec, recall: recall, lift: lift, followDropRate: followDrop };
}

/* 市场状态：按「当日全部样本股的 20 日涨幅中位数」分段 */
function splitEnv(rows) {
  const byDate = {};
  for (const r of rows) { (byDate[r.date] = byDate[r.date] || []).push(r.ret20); }
  const env = {};
  for (const d of Object.keys(byDate)) {
    const a = byDate[d].slice().sort((x, y) => x - y);
    const m = a[Math.floor(a.length / 2)];
    env[d] = m > 0.05 ? '上涨' : (m < -0.05 ? '下跌' : '震荡');
  }
  return env;
}

(async () => {
  await new Promise(r => setTimeout(r, 300));
  if (!w.ChipCore || !w.v3Head || !w.v3PsRow) { console.log('❌ 缺全局函数，先跑 build-preview.js'); process.exit(1) }
  const rows = build();
  const env = splitEnv(rows);
  for (const r of rows) r.env = env[r.date] || '震荡';
  const inS = rows.filter(r => r.date < '2026-01-01');
  const outS = rows.filter(r => r.date >= '2026-01-01');

  console.log('样本 ' + codes.length + ' 只 × ' + rows.length + ' 点 | 样本内(2025) ' + inS.length + ' / 样本外(2026) ' + outS.length);
  const base20 = mean(rows.map(r => r.fwd[20]));
  console.log('基准：20 日后平均 ' + fR(base20) + '，其中跌超 5% 的比例 ' + fP(pct(rows.filter(r => r.fwd[20] <= DROP).length, rows.length)));

  const sets = [['全样本', rows], ['样本内 2025', inS], ['样本外 2026', outS]];
  console.log('\n===== 一、跟/躲 表现（10 日）=====');
  console.log('数据集'.padEnd(14) + '方案'.padEnd(16) + '跟(数/10日收益/准)'.padEnd(30) + '躲(数/10日收益/准)');
  for (const [nm, rs] of sets) {
    for (const [f, lb] of [['v3a', 'V3'], ['cAct', '筹码透视'], ['fa', '融合F1'], ['fa2', '★ 融合F2'], ['fa3', '★ 融合F3'], ['fa4', '★ 融合F4']]) {
      const e = evalAct(rs, f, lb);
      console.log(nm.padEnd(15) + lb.padEnd(16) +
        (e['跟'].n + ' / ' + fR(e['跟'].f10) + ' / ' + fP(e['跟'].hit10)).padEnd(32) +
        (e['躲'].n + ' / ' + fR(e['躲'].f10) + ' / ' + fP(e['躲'].hit10)));
    }
    console.log('');
  }

  console.log('\n===== 二、逃顶能力（20 日内跌超 5%）=====');
  console.log('数据集'.padEnd(14) + '方案'.padEnd(16) + '喊躲数'.padEnd(8) + '精准(说躲真跌)'.padEnd(16) + '召回(真跌有预警)'.padEnd(17) + 'lift'.padEnd(9) + '跟后大跌率');
  for (const [nm, rs] of sets) {
    for (const [f, lb] of [['v3a', 'V3'], ['cAct', '筹码透视'], ['fa', '融合F1'], ['fa2', '★ 融合F2'], ['fa3', '★ 融合F3'], ['fa4', '★ 融合F4']]) {
      const d = dropEval(rs, f);
      console.log(nm.padEnd(15) + lb.padEnd(16) + String(d.dodgeN).padEnd(9) +
        fP(d.prec).padEnd(17) + fP(d.recall).padEnd(18) +
        (isFinite(d.lift) ? d.lift.toFixed(2) + 'x' : '—').padEnd(10) + fP(d.followDropRate));
    }
    console.log('    基准大跌率 ' + fP(dropEval(rs, 'v3a').baseRate));
    console.log('');
  }

  console.log('\n===== 三、分市场环境（融合方案 vs 两套）=====');
  for (const e of ['上涨', '震荡', '下跌']) {
    const rs = rows.filter(r => r.env === e);
    if (rs.length < 200) { console.log(e + '：样本不足（' + rs.length + '）'); continue }
    console.log('\n[' + e + '市] 样本 ' + rs.length + '，基准 20 日 ' + fR(mean(rs.map(r => r.fwd[20]))));
    for (const [f, lb] of [['v3a', 'V3'], ['cAct', '筹码透视'], ['fa', '融合F1'], ['fa2', '★ 融合F2'], ['fa3', '★ 融合F3'], ['fa4', '★ 融合F4']]) {
      const ev = evalAct(rs, f, lb);
      const d = dropEval(rs, f);
      console.log('  ' + lb.padEnd(14) + '跟 ' + fR(ev['跟'].f10).padEnd(9) + '（准 ' + fP(ev['跟'].hit10) + '，n=' + ev['跟'].n + '）' +
        '  躲 ' + fR(ev['躲'].f10).padEnd(9) + '  躲后大跌率 ' + fP(d.prec) + '  lift ' + (isFinite(d.lift) ? d.lift.toFixed(2) + 'x' : '—'));
    }
  }

  console.log('\n===== 四、融合方案的信号来源分布 =====');
  const byWhy = {};
  for (const r of rows) { (byWhy[r.why] = byWhy[r.why] || []).push(r) }
  Object.keys(byWhy).sort((a, b) => byWhy[b].length - byWhy[a].length).forEach(k => {
    const l = byWhy[k];
    console.log('  ' + k.padEnd(16) + 'n=' + String(l.length).padEnd(7) + '10日 ' + fR(mean(l.map(r => r.fwd[10]))).padEnd(9) +
      '20日 ' + fR(mean(l.map(r => r.fwd[20]))).padEnd(9) + '20日内大跌率 ' + fP(pct(l.filter(r => r.fwd[20] <= DROP).length, l.length)));
  });
  const segs = [['2025H1', '2025-01-01', '2025-06-30'], ['2025H2', '2025-07-01', '2025-12-31'],
  ['2026H1', '2026-01-01', '2026-06-30'], ['2026Q3', '2026-07-01', '2026-12-31']];

  console.log('\n===== 四之二、融合F2 各分支表现 =====');
  const byWhy2 = {};
  for (const r of rows) { (byWhy2[r.why2] = byWhy2[r.why2] || []).push(r) }
  Object.keys(byWhy2).sort((a, b) => byWhy2[b].length - byWhy2[a].length).forEach(k => {
    const l = byWhy2[k];
    const seg = segs.map(([lab, a, b]) => {
      const s = l.filter(r => r.date >= a && r.date <= b).map(r => r.fwd[20]);
      return (fR(mean(s))).padEnd(9);
    });
    console.log('  ' + k.padEnd(16) + 'n=' + String(l.length).padEnd(7) + '10日 ' + fR(mean(l.map(r => r.fwd[10]))).padEnd(9) +
      '20日 ' + fR(mean(l.map(r => r.fwd[20]))).padEnd(9) + '大跌率 ' + fP(pct(l.filter(r => r.fwd[20] <= DROP).length, l.length)).padEnd(8) +
      ' | 分时段20日 ' + seg.join(''));
  });

  console.log('\n===== 四之三、融合F3 各分支表现 =====');
  const byWhy3 = {};
  for (const r of rows) { (byWhy3[r.why3] = byWhy3[r.why3] || []).push(r) }
  Object.keys(byWhy3).sort((a, b) => byWhy3[b].length - byWhy3[a].length).forEach(k => {
    const l = byWhy3[k];
    const seg = segs.map(([lab, a, b]) => {
      const s = l.filter(r => r.date >= a && r.date <= b).map(r => r.fwd[20]);
      return (fR(mean(s))).padEnd(9);
    });
    console.log('  ' + k.padEnd(16) + 'n=' + String(l.length).padEnd(7) + '10日 ' + fR(mean(l.map(r => r.fwd[10]))).padEnd(9) +
      '20日 ' + fR(mean(l.map(r => r.fwd[20]))).padEnd(9) + '大跌率 ' + fP(pct(l.filter(r => r.fwd[20] <= DROP).length, l.length)).padEnd(8) +
      ' | 分时段20日 ' + seg.join(''));
  });

  console.log('\n===== 四之四、融合F4 各分支表现 =====');
  const byWhy4 = {};
  for (const r of rows) { (byWhy4[r.why4] = byWhy4[r.why4] || []).push(r) }
  Object.keys(byWhy4).sort((a, b) => byWhy4[b].length - byWhy4[a].length).forEach(k => {
    const l = byWhy4[k];
    const seg = segs.map(([lab, a, b]) => (fR(mean(l.filter(r => r.date >= a && r.date <= b).map(r => r.fwd[20])))).padEnd(9));
    console.log('  ' + k.padEnd(16) + 'n=' + String(l.length).padEnd(7) + '10日 ' + fR(mean(l.map(r => r.fwd[10]))).padEnd(9) +
      '20日 ' + fR(mean(l.map(r => r.fwd[20]))).padEnd(9) + '大跌率 ' + fP(pct(l.filter(r => r.fwd[20] <= DROP).length, l.length)).padEnd(8) +
      ' | 分时段20日 ' + seg.join(''));
  });

  console.log('\n===== 五、分时段稳健性：跟−躲 10 日收益差（pp，越大越有区分度）=====');
  console.log('方案'.padEnd(12) + segs.map(s => s[0].padEnd(11)).join('') + '  为正的时段数');
  for (const [f, lb] of [['v3a', 'V3'], ['cAct', '筹码透视'], ['fa', '融合F1'], ['fa2', '★ 融合F2'], ['fa3', '★ 融合F3'], ['fa4', '★ 融合F4']]) {
    let pos = 0;
    const line = segs.map(([lab, a, b]) => {
      const rs = rows.filter(r => r.date >= a && r.date <= b);
      const e = evalAct(rs, f, lb);
      const d = (e['跟'].f10 - e['躲'].f10) * 100;
      if (d > 0) pos++;
      return ((d >= 0 ? '+' : '') + d.toFixed(2)).padEnd(11);
    });
    console.log(lb.padEnd(13) + line.join('') + '  ' + pos + '/4');
  }

  console.log('\n===== 六、融合各分支的时段稳健性（20 日收益 %）=====');
  const whys = Object.keys(byWhy).sort((a, b) => byWhy[b].length - byWhy[a].length);
  console.log('分支'.padEnd(18) + segs.map(s => s[0].padEnd(13)).join(''));
  for (const k of whys) {
    const line = segs.map(([lab, a, b]) => {
      const l = byWhy[k].filter(r => r.date >= a && r.date <= b).map(r => r.fwd[20]);
      return (fR(mean(l)) + '(' + l.length + ')').padEnd(13);
    });
    console.log(k.padEnd(20) + line.join(''));
  }

  console.log('\n===== 七、买入侧专项（用户诉求：跟主力建仓买入 > 逃顶；怕抄在下跌中继）=====');
  /* 「下跌中继率」= 买入后 20 日内跌超 5% 的比例（期末口径）；
     「最差20日」= 买入信号样本 20 日收益的 5% 分位（尾部风险，约最差 5% 的经历） */
  const buys = [
    ['筹码 主力建仓(accumulate)', r => r.mainK === 'accumulate' || r.mainK === 'inflow'],
    ['筹码 建仓+散户割肉', r => (r.mainK === 'accumulate' || r.mainK === 'inflow') && r.retailK === 'surrender'],
    ['筹码 建仓+散户未抄底', r => (r.mainK === 'accumulate' || r.mainK === 'inflow') && r.retailK !== 'dip-buy'],
    ['★ F2 综合给出「跟」', r => r.fa2 === '跟'],
    ['★ F3 综合给出「跟」', r => r.fa3 === '跟'],
    ['V3 低位吸筹', r => r.v3t === '低位吸筹'],
    ['V3 主力建仓拉升', r => r.v3t === '主力建仓拉升'],
    ['V3 良性回踩', r => r.v3t === '良性回踩'],
    ['基准（不看信号全买）', () => true]
  ];
  console.log('信号'.padEnd(26) + '样本'.padEnd(8) + '10日'.padEnd(9) + '20日'.padEnd(9) + '中继率(20日内跌5%)'.padEnd(18) + '最差5%经历');
  for (const [nm, fn] of buys) {
    const l = rows.filter(fn);
    if (!l.length) { console.log(nm + '：无样本'); continue }
    const f10 = mean(l.map(r => r.fwd[10])), f20 = mean(l.map(r => r.fwd[20]));
    const relay = pct(l.filter(r => r.fwd[20] <= DROP).length, l.length);
    const s = l.map(r => r.fwd[20]).filter(isFinite).sort((a, b) => a - b);
    const worst = s[Math.floor(s.length * 0.05)] || s[0];
    console.log(nm.padEnd(28) + String(l.length).padEnd(8) + fR(f10).padEnd(10) + fR(f20).padEnd(10) +
      fP(relay).padEnd(19) + fR(worst));
  }
  /* 关键反例：看着像建仓、实际是中继的组合 */
  console.log('\n—— 「假建仓」反例：主力看似在收、散户却在抄底 ——');
  const trap = rows.filter(r => (r.mainK === 'accumulate' || r.mainK === 'inflow') && r.retailK === 'dip-buy');
  const pure = rows.filter(r => (r.mainK === 'accumulate' || r.mainK === 'inflow') && r.retailK !== 'dip-buy');
  console.log('建仓+散户抄底（F2 拦下为观望）：n=' + trap.length + '，10日 ' + fR(mean(trap.map(r => r.fwd[10]))) +
    '，20日 ' + fR(mean(trap.map(r => r.fwd[20]))) + '，中继率 ' + fP(pct(trap.filter(r => r.fwd[20] <= DROP).length, trap.length)));
  console.log('建仓+散户未抄底（F2 放行为跟）：n=' + pure.length + '，10日 ' + fR(mean(pure.map(r => r.fwd[10]))) +
    '，20日 ' + fR(mean(pure.map(r => r.fwd[20]))) + '，中继率 ' + fP(pct(pure.filter(r => r.fwd[20] <= DROP).length, pure.length)));
  /* 分时段验证黄金组合 */
  console.log('\n—— 「建仓+散户未抄底」分时段 20 日收益（稳健性）——');
  const segLine = segs.map(([lab, a, b]) => {
    const l = pure.filter(r => r.date >= a && r.date <= b).map(r => r.fwd[20]);
    return (fR(mean(l)) + '(' + l.length + ')').padEnd(14);
  });
  console.log('  ' + segLine.join(''));

  console.log('\n===== 八、F2→F3 修复专项：两类硬裁决点位拆开看 =====');
  const forcePts = rows.filter(r => r.psHard === 'force');
  const sellPts = rows.filter(r => r.psHard === 'sell');
  console.log('force_no_trade（诱多）点位：n=' + forcePts.length +
    '，20日 ' + fR(mean(forcePts.map(r => r.fwd[20]))) +
    '，大跌率 ' + fP(pct(forcePts.filter(r => r.fwd[20] <= DROP).length, forcePts.length)) + '（F2/F3 都喊躲，不变）');
  console.log('sell_bias（破位）点位：n=' + sellPts.length + '，基准 20 日 ' + fR(mean(sellPts.map(r => r.fwd[20]))) +
    '，大跌率 ' + fP(pct(sellPts.filter(r => r.fwd[20] <= DROP).length, sellPts.length)));
  const sF2duo = sellPts; /* F2 在此全喊躲 */
  console.log('  F2 全喊躲：躲后10日 ' + fR(mean(sF2duo.map(r => r.fwd[10]))) + '，躲对率(10日跌) ' +
    fP(pct(sF2duo.filter(r => r.fwd[10] < 0).length, sF2duo.filter(r => isFinite(r.fwd[10])).length)));
  const sF3duo = sellPts.filter(r => r.why3 === '破位+主力派发');
  const sF3hold = sellPts.filter(r => r.why3 !== '破位+主力派发');
  console.log('  F3 拆开后——升躲(主力同向在撤)：n=' + sF3duo.length + '，10日 ' + fR(mean(sF3duo.map(r => r.fwd[10]))) +
    '，躲对率 ' + fP(pct(sF3duo.filter(r => r.fwd[10] < 0).length, sF3duo.filter(r => isFinite(r.fwd[10])).length)) +
    '，20日大跌率 ' + fP(pct(sF3duo.filter(r => r.fwd[20] <= DROP).length, sF3duo.filter(r => isFinite(r.fwd[20])).length)));
  console.log('  F3 拆开后——不再喊躲：n=' + sF3hold.length + '，10日 ' + fR(mean(sF3hold.map(r => r.fwd[10]))) +
    '，20日 ' + fR(mean(sF3hold.map(r => r.fwd[20]))) +
    '，20日大跌率 ' + fP(pct(sF3hold.filter(r => r.fwd[20] <= DROP).length, sF3hold.filter(r => isFinite(r.fwd[20])).length)));
  const segF3d = segs.map(([lab, a, b]) => {
    const l = sF3duo.filter(r => r.date >= a && r.date <= b).map(r => r.fwd[20]);
    return (fR(mean(l)) + '(' + l.length + ')').padEnd(14);
  });
  const segF3h = segs.map(([lab, a, b]) => {
    const l = sF3hold.filter(r => r.date >= a && r.date <= b).map(r => r.fwd[20]);
    return (fR(mean(l)) + '(' + l.length + ')').padEnd(14);
  });
  console.log('    升躲分时段20日：' + segF3d.join(''));
  console.log('    放行分时段20日：' + segF3h.join(''));
  /* 放行点位里，原被 F2 盖掉的「建仓/黄金组合」值不值钱 */
  const released = sF3hold.filter(r => r.mainK === 'accumulate' || r.mainK === 'inflow');
  const releasedGold = released.filter(r => r.retailK === 'surrender');
  console.log('  被放行的「主力在建仓」：n=' + released.length + '，10日 ' + fR(mean(released.map(r => r.fwd[10]))) +
    '，20日 ' + fR(mean(released.map(r => r.fwd[20]))) + '，中继率 ' +
    fP(pct(released.filter(r => r.fwd[20] <= DROP).length, released.filter(r => isFinite(r.fwd[20])).length)));
  console.log('  其中黄金组合(建仓+散户割肉)：n=' + releasedGold.length + '，10日 ' + fR(mean(releasedGold.map(r => r.fwd[10]))) +
    '，20日 ' + fR(mean(releasedGold.map(r => r.fwd[20]))));

  fs.writeFileSync(__dirname + '/_cache/fusion-rows.json', JSON.stringify(rows.slice(0, 3000)));
  process.exit(0);
})();
