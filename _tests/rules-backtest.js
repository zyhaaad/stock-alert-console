/* 两套规则对比回测（私有研究，不进回归清单）
 *
 * 问题：V3（主力博弈 三源投票）与 筹码透视（主力/散户博弈 + 站队）哪套更能让人站对边？
 *
 * 做法：**不复刻规则** —— 用 jsdom 加载预览副本，直接调用线上同一份代码：
 *   · 筹码透视：ChipCore.analyze({bars, flows, floatShares}) → stance.action
 *   · V3       ：v3Vote(dirs) + v3Head(code) → k（good/bad/warn/mute）
 * 输入同一份数据（腾讯前复权日K + 新浪超大单资金流），保证横向公平。
 *
 * 统一动作：跟 / 躲 / 观望，再按前瞻 5/10/20 日收益算方向准确率与区分度。
 * 运行：node rules-backtest.js [股票只数]
 */
'use strict';
const fs = require('fs');
const path = require('path');

const WS = 'C:/Users/29086/.workbuddy/binaries/node/workspace/node_modules';
module.paths.push(WS);
const { JSDOM, VirtualConsole } = require(path.join(WS, 'jsdom'));

const LIMIT = Number(process.argv[2] || 0);
const FWD = [5, 10, 20];
const WARM = 60;          // 预热：20日趋势 + 筹码分布需要的前置K线
const MAXF = Math.max.apply(null, FWD);

/* ---------- 加载线上同一份代码 ---------- */
const html = fs.readFileSync('D:/mywork/_preview/stock-picker-preview.html', 'utf8');
const vc = new VirtualConsole();
const dom = new JSDOM(html, { runScripts: 'dangerously', virtualConsole: vc, url: 'https://local/' });
const w = dom.window;

const data = JSON.parse(fs.readFileSync(__dirname + '/_cache/bt-data.json', 'utf8')).stocks;
const codes = Object.keys(data).filter(c => data[c].bars.length > WARM + MAXF + 5 && data[c].flows.length > WARM);
const use = LIMIT ? codes.slice(0, LIMIT) : codes;

/* ---------- 动作归一 ---------- */
/* V3：k 值 → 动作 */
function v3Act(k) { return k === 'good' ? '跟' : (k === 'bad' ? '躲' : '观望'); }
/* 筹码透视 stance.action → 动作 */
function chipAct(a) {
  if (a === 'hold') return '跟';
  if (a === 'trim' || a === 'reduce') return '躲';
  return '观望';
}

function mean(a) { if (!a.length) return NaN; let s = 0; for (const x of a) s += x; return s / a.length; }
function pct(n, d) { return d ? (n / d * 100) : NaN; }

function run() {
  const rows = [];
  const seenAct = { v3: {}, chip: {} };
  for (const code of use) {
    const st = data[code];
    const bars = st.bars;                       // [日期,开,收,高,低,量(手)] 升序
    const flows = st.flows;                     // "日期,主力,小,中,大,超大" 升序
    const floatShares = st.floatShares;
    /* 资金流按日期建索引 */
    const flowByDate = {};
    for (const f of flows) { const p = f.split(','); flowByDate[p[0]] = Number(p[1]); }

    /* 只跑既有K线又有资金流的交易日 */
    for (let i = WARM; i < bars.length - MAXF; i++) {
      const date = bars[i][0];
      const mainYi = flowByDate[date];
      if (!isFinite(mainYi)) continue;

      const close = bars.map(b => b[2]);
      const vol = bars.map(b => b[5]);
      const chg = close[i] / close[i - 1] - 1;
      const ret20 = close[i] / close[i - 20] - 1;
      let v5 = 0; for (let k = 4; k >= 0; k--) v5 += vol[i - k];
      const vr = (v5 / 5) > 0 ? vol[i] / (v5 / 5) : NaN;

      /* --- V3：三源投票 + 场景 --- */
      const dirs = [w.v3sign(chg), w.v3sign(mainYi), w.v3sign(ret20)];
      const vote = w.v3Vote(dirs);
      w.G.v3Map = w.G.v3Map || {};
      w.G.v3Map[code] = {
        state: vote.state, dirs: dirs, srcs: vote.srcs, agreeN: vote.agreeN,
        majority: vote.majority, conf: vote.conf, chg: chg, mainYi: mainYi / 1e8, ret20: ret20, vr: vr
      };
      const hd = w.v3Head(code);
      if (!hd) continue;

      /* --- 筹码透视：主力/散户行为 + 站队 --- */
      const barsUpTo = bars.slice(0, i + 1);
      const flowsUpTo = flows.filter(f => f.split(',')[0] <= date);
      let chip = null;
      try {
        const r = w.ChipCore.analyze({ code: code, name: code, bars: barsUpTo, flows: flowsUpTo, floatShares: floatShares });
        if (r && r.ok && r.stance) chip = r;
      } catch (e) { /* 单日失败跳过 */ }
      if (!chip) continue;

      const fwd = {};
      for (const n of FWD) fwd[n] = close[i + n] / close[i] - 1;

      rows.push({
        code: code, date: date,
        v3k: hd.k, v3t: hd.t, v3a: v3Act(hd.k),
        chipAction: chip.stance.action, chipTag: chip.stance.tag,
        chipMain: chip.mainBehavior && chip.mainBehavior.key,
        chipRetail: chip.retailBehavior && chip.retailBehavior.key,
        cAct: chipAct(chip.stance.action),
        fwd: fwd
      });
      seenAct.v3[hd.k] = (seenAct.v3[hd.k] || 0) + 1;
      seenAct.chip[chip.stance.action] = (seenAct.chip[chip.stance.action] || 0) + 1;
    }
  }
  return { rows: rows, seenAct: seenAct };
}

/* ---------- 统计 ---------- */
function stat(rows, field) {
  const g = { '跟': [], '躲': [], '观望': [] };
  for (const r of rows) g[r[field]].push(r);
  const out = {};
  for (const act of ['跟', '躲', '观望']) {
    const list = g[act];
    const o = { n: list.length };
    for (const n of FWD) {
      const arr = list.map(r => r.fwd[n]);
      o['avg' + n] = mean(arr);
      /* 方向准确率：跟=看多（fwd>0 算对）；躲=看空（fwd<0 算对）；观望不计方向 */
      let hit = 0, tot = 0;
      for (const v of arr) {
        if (!isFinite(v)) continue;
        tot++;
        if (act === '跟' && v > 0) hit++;
        if (act === '躲' && v < 0) hit++;
      }
      o['hit' + n] = pct(hit, tot);
      o['n' + n] = tot;
    }
    out[act] = o;
  }
  return out;
}

function fmtP(x) { return isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) + '%' : '—'; }
function fmtR(x) { return isFinite(x) ? (x >= 0 ? '+' : '') + (x * 100).toFixed(1) + '%' : '—'; }

(async () => {
  await new Promise(r => setTimeout(r, 300));   // 等预览脚本挂上全局
  if (!w.ChipCore || !w.v3Vote || !w.v3Head) {
    console.log('❌ 预览副本没挂上 ChipCore / v3Vote / v3Head（先跑 build-preview.js）');
    process.exit(1);
  }
  const t0 = Date.now();
  const { rows, seenAct } = run();
  console.log('样本：' + use.length + ' 只股票，' + rows.length + ' 个交易日·股票点，耗时 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's');
  console.log('日期范围：' + rows[0].date + ' ~ ' + rows[rows.length - 1].date);
  console.log('V3 k 值分布：' + JSON.stringify(seenAct.v3));
  console.log('筹码 stance.action 分布：' + JSON.stringify(seenAct.chip));

  const sv = stat(rows, 'v3a'), sc = stat(rows, 'cAct');
  const base = {};
  for (const n of FWD) base[n] = mean(rows.map(r => r.fwd[n]));

  console.log('\n基准（全样本不做选择，买入持有）：' + FWD.map(n => n + '日 ' + fmtR(base[n])).join(' / '));

  for (const [name, s] of [['V3 主力博弈', sv], ['筹码透视 站队结论', sc]]) {
    console.log('\n===== ' + name + ' =====');
    console.log('动作   样本数  ' + FWD.map(n => (n + '日均收益').padEnd(11)).join('') + '  ' + FWD.map(n => (n + '日方向准').padEnd(10)).join(''));
    for (const act of ['跟', '躲', '观望']) {
      const o = s[act];
      console.log(act.padEnd(6) + String(o.n).padEnd(8) +
        FWD.map(n => fmtR(o['avg' + n]).padEnd(13)).join('') + '  ' +
        FWD.map(n => (act === '观望' ? '—' : (isFinite(o['hit' + n]) ? o['hit' + n].toFixed(1) + '%' : '—')).padEnd(12)).join(''));
    }
    const ng = s['跟'].n, nd = s['躲'].n;
    const tot = ng + nd;
    let hit = 0, ct = 0;
    for (const r of rows) {
      const a = name.indexOf('V3') >= 0 ? r.v3a : r.cAct;
      if (a === '观望') continue;
      const v = r.fwd[10];
      if (!isFinite(v)) continue;
      ct++;
      if ((a === '跟' && v > 0) || (a === '躲' && v < 0)) hit++;
    }
    const spread = s['跟']['avg10'] - s['躲']['avg10'];
    console.log('→ 综合方向准确率（跟且涨 + 躲且跌，10日）：' + pct(hit, ct).toFixed(1) + '%  （有效样本 ' + ct + '）');
    console.log('→ 跟/躲 10 日收益差（区分度）：' + fmtP2(spread * 100));
  }

  /* 只在两套都给出明确方向（跟/躲）的样本上直接对打 */
  console.log('\n===== 同日同股直接对打（两边都给了跟/躲）=====');
  const both = rows.filter(r => r.v3a !== '观望' && r.cAct !== '观望');
  console.log('样本数：' + both.length);
  let v3win = 0, chipwin = 0, tie = 0;
  const v3eq = [], chipEq = [];
  for (const r of both) {
    const f = r.fwd[10];
    if (!isFinite(f)) continue;
    const v3right = (r.v3a === '跟' && f > 0) || (r.v3a === '躲' && f < 0);
    const cright = (r.cAct === '跟' && f > 0) || (r.cAct === '躲' && f < 0);
    if (v3right && !cright) v3win++;
    else if (cright && !v3right) chipwin++;
    else if (v3right && cright) tie++;
  }
  console.log('都对：' + tie + '   只有 V3 对：' + v3win + '   只有筹码对：' + chipwin);
  /* 按信号模拟：跟=满仓持有10日，躲=空仓 */
  for (const [nm, f] of [['V3', 'v3a'], ['筹码', 'cAct']]) {
    let s = 0, n = 0;
    for (const r of both) { const x = r.fwd[10]; if (!isFinite(x)) continue; n++; s += (r[f] === '跟' ? x : (r[f] === '躲' ? 0 : 0)); }
    console.log(nm + ' 按信号操作（跟=持有10日 / 躲=空仓）累计：' + fmtR(s / n * 10) + '（按每笔 10 日计，' + n + ' 笔）');
  }
  let sBase = 0, nBase = 0;
  for (const r of both) { const x = r.fwd[10]; if (!isFinite(x)) continue; nBase++; sBase += x; }
  console.log('基准（不做选择，每笔都持有10日）：' + fmtR(sBase / nBase * 10));

  /* ===== 场景级细分：到底哪个具体信号有用 ===== */
  const base10 = base[10];
  console.log('\n\n########## 场景级细分（后续 10 日；基准 ' + fmtR(base10) + '）##########');
  function scene(label, keyFn, actFn) {
    const g = {};
    for (const r of rows) { const k = keyFn(r); if (!k) continue; (g[k] = g[k] || []).push(r); }
    const arr = Object.keys(g).map(k => {
      const list = g[k];
      const f10 = mean(list.map(r => r.fwd[10]));
      let up = 0, tot = 0;
      for (const r of list) { const v = r.fwd[10]; if (!isFinite(v)) continue; tot++; if (v > 0) up++; }
      return { k: k, n: list.length, f10: f10, up: pct(up, tot), act: actFn(list[0]) };
    }).sort((a, b) => (isFinite(b.f10) ? b.f10 : -9) - (isFinite(a.f10) ? a.f10 : -9));
    console.log('\n--- ' + label + ' ---');
    console.log('场景'.padEnd(16) + '动作'.padEnd(6) + '样本'.padEnd(7) + '10日后收益'.padEnd(13) + '相对基准'.padEnd(13) + '10日上涨占比');
    for (const a of arr) {
      const rel = isFinite(a.f10) ? (a.f10 - base10) * 100 : NaN;
      console.log(String(a.k).padEnd(18) + String(a.act || '').padEnd(6) + String(a.n).padEnd(8) +
        fmtR(a.f10).padEnd(14) + (isFinite(rel) ? (rel >= 0 ? '+' : '') + rel.toFixed(2) + 'pp' : '—').padEnd(14) +
        (isFinite(a.up) ? a.up.toFixed(1) + '%' : '—'));
    }
  }
  /* ===== 分时段稳健性：关键信号是不是只在某段行情里成立 ===== */
  console.log('\n\n########## 分时段稳健性（10 日后收益 %）##########');
  const segs = [['2025H1', '2025-01-01', '2025-06-30'], ['2025H2', '2025-07-01', '2025-12-31'],
  ['2026H1', '2026-01-01', '2026-06-30'], ['2026Q3', '2026-07-01', '2026-12-31']];
  const keys = [
    ['散户割肉 surrender', r => r.chipRetail === 'surrender'],
    ['散户抄底 dip-buy', r => r.chipRetail === 'dip-buy'],
    ['主力建仓 accumulate', r => r.chipMain === 'accumulate'],
    ['主力拉升 lift', r => r.chipMain === 'lift'],
    ['V3 主力持续派发', r => r.v3t === '主力持续派发'],
    ['V3 主力建仓拉升', r => r.v3t === '主力建仓拉升'],
    ['V3 高位出货完毕', r => r.v3t === '高位出货完毕']
  ];
  console.log('信号'.padEnd(22) + segs.map(s => s[0].padEnd(11)).join(''));
  for (const [nm, fn] of keys) {
    const line = segs.map(([lab, a, b]) => {
      const list = rows.filter(r => fn(r) && r.date >= a && r.date <= b).map(r => r.fwd[10]);
      return (fmtR(mean(list)) + '(' + list.length + ')').padEnd(11);
    });
    console.log(nm.padEnd(24) + line.join(''));
  }

  scene('V3 十二场景（k 值决定跟/躲）', r => r.v3t, r => r.v3a);
  scene('筹码透视 站队结论', r => r.chipTag, r => r.cAct);
  scene('筹码透视 · 主力行为', r => r.chipMain, r => r.cAct);
  scene('筹码透视 · 散户行为', r => r.chipRetail, r => r.cAct);

  fs.writeFileSync(__dirname + '/_cache/bt-rows.json', JSON.stringify(rows.slice(0, 4000)));
  console.log('\n明细已存 _tests/_cache/bt-rows.json（前 4000 行）');
  process.exit(0);
})();

function fmtP2(x) { return isFinite(x) ? (x >= 0 ? '+' : '') + x.toFixed(2) + '个百分点' : '—'; }
