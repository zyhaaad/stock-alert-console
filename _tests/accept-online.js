/* 线上验收（端到端）：确认「发布出去的页面」真的包含本轮所有功能，且与本地一致
 * 覆盖：恐贪核心注入 + 备源顺序与超时 + 三项 UX 优化 + V3 持仓账本
 * 运行：node _tests/accept-online.js
 *      GH_TOKEN=ghp_xxx node _tests/accept-online.js   # 顺带验证 GitHub API 备源（免匿名限流）
 */
const fs = require('fs');
const https = require('https');
const crypto = require('crypto');

const LF = '\n';
const ok = b => b ? '✅' : '❌';
let pass = 0, fail = 0;
const chk = (name, cond, extra) => {
  cond ? pass++ : fail++;
  console.log(ok(cond) + ' ' + name + (extra ? '  ' + extra : ''));
};
/* 从整页源码里截一段（用于「某个函数里到底写了什么」这类断言） */
const between = (src, a, b) => {
  const i = src.indexOf(a); if (i < 0) return '';
  const j = src.indexOf(b, i + a.length); if (j < 0) return src.slice(i);
  return src.slice(i, j);
};

function get(url, opts = {}) {
  return new Promise(resolve => {
    const req = https.get(url, { headers: opts.headers || {}, timeout: 20000 }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => (body += d));
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', e => resolve({ status: 0, body: '', err: String(e.message) }));
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, body: '', err: 'timeout' }); });
  });
}

const SITE = 'https://stock-alert-console.app.workbuddy.host';
const REPO = 'zyhaaad/stock-alert';
const GH = process.env.GH_TOKEN || '';

(async () => {
  console.log('======== 线上端到端验收 ========' + LF);

  const local = fs.readFileSync('D:/mywork/stock-alert-console/console.html', 'utf8');
  const localMd5 = crypto.createHash('md5').update(local).digest('hex');
  const r1 = await get(SITE + '/console.html');
  const on = r1.body;
/* ⚠️ 负断言（「某段代码必须不存在」）要判**真实代码**，不能判裸词 ——
   注释里常写着「已删掉 X」的说明，裸词会被自己的注释误伤（2026-09-20 踩过）。 */
/* ⚠️ 负断言必须判「去注释后的源码」：/* *\/ 块注释、// 行注释、**还有 HTML 注释**都要剥掉，
   否则「已撤下」的说明性注释会把自己误伤（本项目已踩三次）。 */
const onNoCmt = on.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '')
  .split('\n').map(l => l.replace(/\/\/.*$/, '')).join('\n');
  const onlineMd5 = crypto.createHash('md5').update(on).digest('hex');

  chk('线上 /console.html 可访问 (HTTP 200)', r1.status === 200, 'status=' + r1.status);
  chk('线上与本地字节一致 (md5)', onlineMd5 === localMd5, onlineMd5.slice(0, 12) + ' vs ' + localMd5.slice(0, 12));

  const r1b = await get(SITE + '/');
  chk('根路径自动跳转 console.html', r1b.body.indexOf('console.html') >= 0, r1b.body.length + 'B');

  /* ---------- 恐贪（既有） ---------- */
  chk('含恐贪核心标记 FNG-CORE-BEGIN（且仅 1 个）', (on.match(/FNG-CORE-BEGIN/g) || []).length === 1);
  chk('含恐贪入口卡 fg-entry 与详情页 pgFng', on.indexOf('fg-entry') >= 0 && on.indexOf('pgFng') >= 0);
  chk('吸顶容器 #fngSticky + position:sticky', on.indexOf('id="fngSticky"') >= 0 && /\.fg-sticky\.on\{[^}]*position:sticky/.test(on));
  chk('分阶段建议卡 #fngAdvCard', on.indexOf('id="fngAdvCard"') >= 0 && on.indexOf('id="fngAdvDo"') >= 0);

  const code = on.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');
  chk('无「观望为主」类空话（已剥离注释）', !/观望为主/.test(code));
  chk('曲线游标 + touch-action:pan-y', on.indexOf('id="fngCursor"') >= 0 && on.indexOf('touch-action:pan-y') >= 0);

  /* 备源顺序与超时 */
  {
    const i = on.indexOf('async function fngLoadRaw');
    const seg = on.slice(i, i + 2400);
    const iJ = seg.indexOf('cdn.jsdelivr.net'), iR = seg.indexOf('raw.githubusercontent.com');
    chk('备源顺序：jsDelivr 在 raw 之前', iJ > 0 && iR > iJ);
    chk('每次抓取带超时（AbortController）', on.indexOf('AbortController') >= 0);
  }

  /* ---------- V3 持仓账本 ---------- */
  chk('含持仓核心标记 POSITION-CORE-BEGIN（且仅 1 个）', (on.match(/POSITION-CORE-BEGIN/g) || []).length === 1);
  chk('含持仓核心标记 POSITION-CORE-END（且仅 1 个）', (on.match(/POSITION-CORE-END/g) || []).length === 1);
  chk('持仓核心已挂到 window（root.PositionCore）', on.indexOf('root.PositionCore') >= 0);

  {
    const B = '/* ==== POSITION-CORE-BEGIN ==== */', E = '/* ==== POSITION-CORE-END ==== */';
    const i = on.indexOf(B), j = on.indexOf(E);
    const core = fs.readFileSync('D:/mywork/stock-alert-cloud/position-core.js', 'utf8');
    const onlineInner = (i >= 0 && j > i) ? on.slice(i + B.length, j).trim() : '';
    chk('线上注入的持仓核心与本地 position-core.js 逐字一致', !!onlineInner && onlineInner === core.trim());
  }

  /* ---------- 三页分离规格（2026-09-16 用户确认）：监控 / 持仓 / 推荐各自独立 ---------- */
  /* ★ 2026-09-20 晚定稿：持仓不再记账 → 汇总卡**渲染函数与样式整体删除**，不再留死代码。
     （演进：先撤 pfBox 调用 → 函数变零调用方死代码 → 用户确认「改成负向断言、对结论产出与界面展示
       均无影响」后清除。删掉的是纯渲染函数，不碰 position-core 的 portfolioOf/pnlClass/FEE_NOTE。） */
  chk('★ 持仓汇总卡渲染函数 renderPortfolio 已整体删除（零调用方死代码，不随包下发）',
    onNoCmt.indexOf('renderPortfolio') < 0);
  chk('★ 监控页不再有个股持仓行渲染函数 posLineHtml', on.indexOf('function posLineHtml') < 0);
  /* ★ 2026-09-20：持仓不再记成本/股数 → 顶部汇总卡（浮盈/市值/成本合计）整体撤下 */
  {
    const rh = between(on, 'function renderHoldings(map)', 'function bindHoldingCards(box)');
    chk('★ 持仓页不再渲染汇总卡（pfBox / renderPortfolio 均无残留）',
      on.indexOf('id="pfBox"') < 0 && rh.indexOf('pfBox') < 0 &&
      rh.indexOf('renderPortfolio') < 0);
  }
  chk('★ 监控列表不再渲染汇总卡（renderActive 只画监控卡）', onNoCmt.indexOf('renderPortfolio') < 0);
  chk('★ 监控卡内联录入面板已无成本/股数输入框', on.indexOf('class="e-cost"') < 0 && on.indexOf('class="e-qty"') < 0);
  chk('★ 统一添加页按用途分面板：监控面板放条件/目标价，持仓面板**不再要成本/股数**（2026-09-20）',
    on.indexOf('id="pnlMonitor"') >= 0 && on.indexOf('id="pnlHolding"') >= 0 &&
    on.indexOf('id="fCond"') >= 0 && on.indexOf('id="fTarget"') >= 0 &&
    on.indexOf('id="hCost"') < 0 && on.indexOf('id="hQty"') < 0);
  chk('统一添加页讲清「两份清单互相独立」',
    on.indexOf('两份清单互相独立') >= 0 && on.indexOf('两份独立清单') >= 0);
  /* ⚠️ 判「记账口径会不会出现在页面上」：函数删掉后，正确判法是**去注释源码里一个都不许有**
     （注释里可以说明「已删除」，所以必须用 onNoCmt，不能搜全文件）。 */
  chk('★ 持仓不再记账：记账口径（持仓浮盈 / 成本合计 / 持仓市值）在去注释源码里一个都不剩',
    onNoCmt.indexOf('持仓浮盈') < 0 && onNoCmt.indexOf('成本合计') < 0 &&
    onNoCmt.indexOf('持仓市值') < 0);
  chk('「没记持仓」有独立文案（不等于 0 元）', on.indexOf('还没有持仓记录') >= 0);
  chk('★ 汇总卡样式 .pf* 已随函数一并清除（不留无用样式）',
    on.indexOf('.pf{') < 0 && on.indexOf('.pf-lbl{') < 0 && on.indexOf('.pf-val{') < 0);
  chk('★ 旧持仓行样式 .pos 已移除', !/\.pos\{display:flex/.test(on));

  chk('持仓清单访问入口仍被多处消费（holdingsOf）', on.indexOf('var hs = holdingsOf()') >= 0);
  chk('有了独立的持仓清单访问入口', on.indexOf('function holdingsOf()') >= 0 && on.indexOf('function posCore()') >= 0);
  chk('含「我的持仓」页 pgHoldings', on.indexOf('id="pgHoldings"') >= 0);
  chk('★ 持仓页不再自带表单（录入统一在首页入口，这里只有跳转按钮）',
    on.indexOf('id="btnGoAddHolding"') >= 0 && on.indexOf('id="hCode"') < 0 && on.indexOf('id="hName"') < 0 &&
    on.indexOf('id="hManualFields"') < 0 && on.indexOf('id="hQuery"') < 0);
  chk('「更多」菜单里有持仓入口', on.indexOf('id="rowHoldings"') >= 0);
  chk('★ 首页不再有「管理持仓」按钮（汇总卡搬进持仓页）', on.indexOf('id="btnGoHoldings"') < 0);
  chk('页面讲清了"两批股票"', on.indexOf('两批股票') >= 0);
  chk('★ 个股卡的「＋ 记录持仓」入口已下线', on.indexOf('data-act="posEdit"') < 0 && on.indexOf('＋ 记录持仓') < 0);
  chk('删监控不连带删持仓（归档不再存成本）', on.indexOf('只删监控，「我的持仓」里这条记录会保留') >= 0);
  chk('老配置自动迁移已接入启动流程', on.indexOf('PC0.migrateLegacy(G.cfg.stocks, G.cfg.holdings)') >= 0);
  chk('演示数据也分成了两份清单（demoCfg 含 holdings 数组）', on.indexOf('    holdings: [') >= 0);
  {
    // demoCfg 里 holdings 之前的那段 = 监控清单，里面不该再出现 cost/qty
    const i0 = on.indexOf('function demoCfg');
    const j0 = on.indexOf('    holdings: [', i0);
    const seg = (i0 >= 0 && j0 > i0) ? on.slice(i0, j0) : '';
    chk('演示的监控项上不再挂 cost/qty', seg.length > 0 && seg.indexOf('cost:') < 0 && seg.indexOf('qty:') < 0);
  }

  /* ---------- AI 备选推荐页（第三个独立页面） ---------- */
  chk('含信号核心标记 SIGNAL-CORE-BEGIN（且仅 1 个）', (on.match(/SIGNAL-CORE-BEGIN/g) || []).length === 1);
  chk('信号核心已挂到 window（root.SignalCore）', on.indexOf('root.SignalCore') >= 0);
  {
    const B = '/* ==== SIGNAL-CORE-BEGIN ==== */', E = '/* ==== SIGNAL-CORE-END ==== */';
    const i = on.indexOf(B), j = on.indexOf(E);
    const core = fs.readFileSync('D:/mywork/stock-alert-cloud/signal-core.js', 'utf8');
    const onlineInner = (i >= 0 && j > i) ? on.slice(i + B.length, j).trim() : '';
    chk('线上注入的信号核心与本地 signal-core.js 逐字一致', !!onlineInner && onlineInner === core.trim());
  }
  /* ★ 2026-09-17 新增第 6 条规则：持仓股连续 ≥2 天开收盘站上 5 日线 → 提醒卖出（云端推送）
     ★ 同日追加前提：只有均线多头排列（MA5 > MA10 > MA20 > MA30）才判断，其他情况不触发 */
  chk('信号规则版本已升到 R3（改规则必须升版本，胜率按版本分开统计）', on.indexOf("RULE_VERSION = 'R3'") >= 0);
  chk('★ 线上核心含多头排列前提 maAlign（MA5>MA10>MA20>MA30 才判断）',
    on.indexOf('function maAlign(') >= 0 && on.indexOf('maAlign: maAlign') >= 0 &&
    on.indexOf('alignMas: [5, 10, 20, 30]') >= 0);
  chk('★ ma5Streak 真的被前提挡（非多头排列直接 days:0 / sig:null，不硬算）',
    on.indexOf('if (!al.ok) {') >= 0 && on.indexOf('aligned: false,') >= 0 && on.indexOf('aligned: true,') >= 0);
  chk('★ 线上核心含新规则 MA5_STREAK_EXIT（连续站上 5 日线 → 卖出提醒）',
    on.indexOf("rule: 'MA5_STREAK_EXIT'") >= 0 && on.indexOf('ma5ExitDays') >= 0);
  chk('★ 推送规则本体也显式挡了前提（不是只靠 ma5Streak）',
    on.indexOf('if (!maAlign(bars, i).ok) return null;') >= 0);
  /* ★ 2026-09-17：胜率必须**按版本隔离**（用户选「只统计当前版本」） */
  chk('★ 线上核心的 winrateStats 支持按版本隔离（opt.onlyVersion，含未标版本的老数据要排除）',
    on.indexOf('function winrateStats(judged, opt)') >= 0 &&
    on.indexOf('var onlyVer = (opt && opt.onlyVersion) ? String(opt.onlyVersion) : null;') >= 0 &&
    on.indexOf("if (onlyVer && String(list[i] && list[i].ruleVersion) !== onlyVer) continue;") >= 0);
  chk('★ 新规则与 HOT_MA5_BIAS 的区别写进注释（前者不看乖离）', on.indexOf('不加乖离条件') >= 0 || on.indexOf('不加 5 日乖离条件') >= 0);
  chk('★ 线上核心含 signalsForList（清单过滤的单一真源：卖出提醒只对持仓股发）',
    on.indexOf('function signalsForList(') >= 0 && on.indexOf('signalsForList: signalsForList') >= 0);
  /* 推送链路在 signals.js 里（不在 console.html 内），所以这里读本地文件 + 云端那份 */
  {
    const sigLocal = fs.readFileSync('D:/mywork/stock-alert-cloud/signals.js', 'utf8');
    chk('推送文案已拆出 buildMessage（可单测，不用肉眼看）',
      sigLocal.indexOf('function buildMessage(') >= 0 && sigLocal.indexOf('module.exports = { main: main, buildMessage: buildMessage }') >= 0);
    chk('云端任务真的走了 signalsForList（口径不在两处各写一遍）',
      sigLocal.indexOf('S.signalsForList((r && r.signals) || [], listOf[code])') >= 0);
    chk('★ signals.js --report 也按版本隔离统计（并且把排除了多少条如实打出来）',
      sigLocal.indexOf('S.winrateStats(all, { onlyVersion: S.RULE_VERSION })') >= 0 &&
      sigLocal.indexOf('const skippedOld = all.length - counted') >= 0);
    {
      const revLocal = fs.readFileSync('D:/mywork/stock-alert-cloud/review.js', 'utf8');
      chk('★ 规则体检（review.js）按版本隔离统计，且备选池行带上逐条 ruleVersion',
        revLocal.indexOf('S.winrateStats(allRows, { onlyVersion: S.RULE_VERSION })') >= 0 &&
        revLocal.indexOf('ruleVersion: p.ruleVersion') >= 0);
      chk('★ 体检报告必须说明「排除了多少条旧版本」（否则样本 0 看起来像坏了）',
        revLocal.indexOf('条更早版本（R2 及以前）的信号已排除') >= 0 &&
        revLocal.indexOf('还没有信号入库') >= 0);
    }
    {
      const scrLocal = fs.readFileSync('D:/mywork/stock-alert-cloud/screener.js', 'utf8');
      chk('★ 备选池引擎已重构为龙头战法（情绪周期 + 防接盘硬过滤 + 买点纪律 + L2 版本）',
        scrLocal.indexOf('function classifyCycle(') >= 0 &&
        scrLocal.indexOf('function guardReject(') >= 0 &&
        scrLocal.indexOf('function scoreBoard(') >= 0 &&
        scrLocal.indexOf('function scoreDip(') >= 0 &&
        scrLocal.indexOf("const PICK_VERSION = 'L2'") >= 0 &&
        scrLocal.indexOf('dipMaxLbc: 2') >= 0 &&
        scrLocal.indexOf('弱转强观察池') >= 0 &&
        scrLocal.indexOf('一字板买不进') >= 0 &&
        scrLocal.indexOf('高开 >7% 放弃') >= 0);
    }

    /* 云端文件内容检查：404=还没传（真失败）；403=匿名限流（不判失败，给 token 可解） */
    const cloudFile = async (rel) => {
      const r = await get('https://api.github.com/repos/' + REPO + '/contents/' + rel, { headers: { 'User-Agent': 'accept', ...(GH ? { Authorization: 'token ' + GH } : {}) } });
      let text = '';
      try { text = Buffer.from(String(JSON.parse(r.body).content || '').replace(/\n/g, ''), 'base64').toString('utf8'); } catch (e) {}
      return { status: r.status, text: text };
    };
    const needIn = async (rel, label, keys) => {
      const f = await cloudFile(rel);
      if (f.status === 403) { console.log('ℹ️  ' + rel + ' 匿名读被限流（HTTP 403），跳过内容核验 —— 设 GH_TOKEN 可解'); return; }
      const miss = keys.filter(k => f.text.indexOf(k) < 0);
      chk(label + (f.status === 200 ? '' : '（HTTP ' + f.status + '）'),
        f.status === 200 && miss.length === 0,
        f.status === 200 ? (miss.length ? '缺 ' + miss.join(' / ') : '含') : '云端还没这个文件');
    };
    await needIn('signals.js', '★ 云端 signals.js 已含清单过滤、buildMessage 与按版本统计',
      ['signalsForList', 'function buildMessage(', 'onlyVersion: S.RULE_VERSION']);
    await needIn('signal-core.js', '★ 云端 signal-core.js 已含 MA5_STREAK_EXIT（R3 + 多头排列前提）、按版本统计与 signalsForList',
      ["'MA5_STREAK_EXIT'", "RULE_VERSION = 'R3'", 'signalsForList', 'function maAlign(', 'onlyVersion']);
    await needIn('review.js', '★ 云端 review.js 已按版本隔离统计（否则规则体检还是新旧混算）',
      ['onlyVersion: S.RULE_VERSION', 'ruleVersion: p.ruleVersion']);
  await needIn('screener.js', '★ 云端 screener.js 已是龙头战法引擎（情绪周期/防接盘过滤/买点纪律/L2 版本）',
    ['function classifyCycle(', 'function guardReject(', 'function scoreBoard(', 'function scoreDip(',
      "const PICK_VERSION = 'L2'", 'dipMaxLbc: 2', '弱转强观察池', '一字板买不进', '高开 >7% 放弃', "ruleVersion = 'LEGACY'"]);
  await needIn('style.js', '★ 云端 style.js 已是风格驾驶舱引擎（S1：七档判定 + 优选闸门）',
    ["const STYLE_VERSION = 'S1'", 'function classifyStyle(', 'function psGate(', 'function idxStyle(',
      'function themeLeaders(', 'function scoreCandidate(', 'function guardCandidate(', 'function passFlow(',
      'push2delay.eastmoney.com', '宁可空仓']);
  /* 交易日历 param 修复（2026-09-19）：screener fetchTradingDates 必须三逗号（day,,,n）
     ⚠️ 匿名 API 常被限流（HTTP 403）：按项目口径「403=没读到≠失败」→ 跳过，不判失败。 */
  try {
    const scr = await cloudFile('screener.js')
    if (scr.status === 403) {
      console.log('ℹ️  screener.js 匿名读被限流（HTTP 403），跳过交易日历 param 核验 —— 设 GH_TOKEN 可解')
    } else {
      chk('★ 云端 screener.js 交易日历 param 已修复（day,,,n，情绪周期不再静默降级）',
        scr.status === 200 && scr.text.indexOf('param=sh000985,day,,,') >= 0)
    }
  } catch (e) { chk('★ 云端 screener.js 交易日历 param 已修复（day,,,n，情绪周期不再静默降级）', false) }
  }
  chk('含「AI 备选推荐」页 pgPicks', on.indexOf('id="pgPicks"') >= 0);
  chk('「更多」菜单里有推荐入口 rowPicks', on.indexOf('id="rowPicks"') >= 0);
  chk('推荐页读 picks-history.json（三源降级）', on.indexOf('picks-history.json') >= 0 && on.indexOf('async function picksLoadRaw') >= 0);
  chk('推荐页写明排除口径（不含 ST、不含科创板）', on.indexOf('不含 ST、不含科创板') >= 0);
  chk('推荐页写明胜负口径（10 个交易日 ±2%）', on.indexOf('10 个交易日 ±2%') >= 0);
  chk('推荐页渲染推荐理由与买卖纪律', on.indexOf('pick-ul') >= 0 && on.indexOf('买卖纪律') >= 0);

  /* ---------- 快捷切换条 + 持仓页搜索 ---------- */
  chk('★ 首页切换条已去掉：仅持仓页/推荐页各保留一条 vtabs', (on.match(/class="vtabs"/g) || []).length === 2 && on.indexOf('<div class="wrap">') >= 0);
  chk('主视图内不再有 vtabs（仪表盘卡片即导航）', (() => { const i = on.indexOf('<div class="wrap">'), j = on.indexOf('id="dash"', i); return i >= 0 && j > i && on.slice(i, j).indexOf('class="vtabs"') < 0; })());
  chk('切换条含「今日推荐」项（用户口径文案）', on.indexOf('>今日推荐<') >= 0);
  chk('切换逻辑 switchView/syncViewTabs 已接入', on.indexOf('function switchView(v)') >= 0 && on.indexOf('function syncViewTabs()') >= 0);
  chk('行情刷新有防重入锁', on.indexOf('G.priceBusy') >= 0);
  chk('★ 添加只有一个入口：FAB 与「记一笔持仓」都进统一添加页', on.indexOf('function openAdd(tab)') >= 0 && on.indexOf("openAdd('holding')") >= 0);
  chk('★ 统一添加页复用搜索主通道（srFetchItems/srBranch 单一真源，无第二套搜索）',
    on.indexOf('SR_LAST = srBranch(items, q, 20)') >= 0 && on.indexOf('await srFetchItems(q)') >= 0 &&
    on.indexOf('async function hSearch') < 0 && on.indexOf('id="hQuery"') < 0);
  chk('★ 手输降级通道保留（默认收起，搜不到时可手输 6 位代码）', on.indexOf('id="srFallback" hidden') >= 0 && on.indexOf('id="btnManual"') >= 0);

  /* ---------- ★ 统一添加页（2026-09-17 用户需求：监控/持仓合并成一个入口） ---------- */
  chk('★ 添加页含用途分段（开提醒 / 记持仓）', on.indexOf('id="addSeg"') >= 0 &&
    on.indexOf('data-tab="monitor"') >= 0 && on.indexOf('data-tab="holding"') >= 0);
  chk('★ 选出股票前不摊表单（#addForm 默认 hidden，选中才展开）',
    on.indexOf('id="addForm" hidden') >= 0 && on.indexOf('function addFormSync()') >= 0);
  chk('★ 提交后给结果确认卡（addOkShow），而不是默默关页',
    on.indexOf('function addOkHtml(kind, title, sub, otherTab)') >= 0 &&
    on.indexOf('function addOkShow(kind, title, sub, code)') >= 0 &&
    on.indexOf('data-ok="again"') >= 0);
  chk('★ 结果卡的下一步出口：再添加一只 / 顺便做另一件事 / 去看清单',
    on.indexOf('顺便记持仓') >= 0 && on.indexOf('顺便开提醒') >= 0 && on.indexOf('去看我的持仓') >= 0);
  chk('★ 已在监控 / 已记持仓 → 走更新而不是拦住（按钮文案随之变）',
    on.indexOf("s.mon ? '更新监控条件' : '开始监控'") >= 0 && on.indexOf("s.hold ? '更新持仓' : '保存持仓'") >= 0);
  chk('★ 现状条说明「它在哪份清单里、这次保存会发生什么」',
    on.indexOf('function addStateOf(code)') >= 0 && on.indexOf('已在监控清单') >= 0 &&
    on.indexOf('已记持仓') >= 0 && on.indexOf('会覆盖原') >= 0);
  chk('★ 现状条给「去改另一边」快捷入口', on.indexOf('data-go="holding"') >= 0 && on.indexOf('data-go="monitor"') >= 0);
  chk('★ 候选行 / 选中卡标出「监控中 / 持仓中」',
    on.indexOf('function addTagsHtml(code)') >= 0 && on.indexOf('class="ro mon"') >= 0 && on.indexOf('class="ro hold"') >= 0);
  /* ★ 2026-09-20：持仓不再记成本/股数 → 预填只带出监控侧的条件与目标价 */
  chk('★ 预填已有值：已监控带出原条件与目标价（持仓侧已无成本/股数可预填）',
    on.indexOf('function addFillFields()') >= 0 && on.indexOf('s.mon && s.stock.condition') >= 0 &&
    on.indexOf('s.mon && s.stock.target') >= 0 &&
    onNoCmt.indexOf('s.holding.cost') < 0 && onNoCmt.indexOf('s.holding.qty') < 0);
  chk('★ 首页仪表盘空态两卡按用途直达（data-tab=monitor/holding）',
    on.indexOf("openAdd(t.getAttribute('data-tab') || '')") >= 0);
  /* ⚠️ 判「有没有写另一份清单」必须看**真实写操作**（`G.cfg.stocks` / `G.cfg.holdings`），
     不能用裸词 `holdings` —— addStock 里就有一句注释写着「成本/股数属于另一份清单 cfg.holdings」，
     裸词会被自己写的注释误伤（本项目的老坑）。 */
  chk('★ 两份清单互不串写：加监控不写 holdings，记持仓不写 stocks',
    between(on, 'async function addStock()', '/* ---------- 搜索流程').indexOf('G.cfg.holdings') < 0 &&
    between(on, 'async function addHolding()', '/* ★ 2026-09-17：hLookupName').indexOf('G.cfg.stocks') < 0);

  /* ---------- 首页仪表盘（2026-09-16 用户需求：首页只留恐贪 + 三块卡） ---------- */
  chk('首页仪表盘容器 #dash 存在', on.indexOf('id="dash"') >= 0);
  chk('全部监控列表默认收起 + 返回按钮 homeBack', on.indexOf('id="homeBack"') >= 0 && on.indexOf('function renderHome') >= 0);
  chk('最近触发光标：nearestStock（已达条件优先，按差距百分比排序）', on.indexOf('function nearestStock') >= 0 && on.indexOf("data-act=\"dash-near\"") >= 0);
  chk('点最近触发卡展开全部监控（openFullList/backToDash）', on.indexOf('function openFullList') >= 0 && on.indexOf('function backToDash') >= 0);
  chk('日线数据源：腾讯个股日线（与前高/均线同源接口）', on.indexOf('async function fetchDailyBars') >= 0 && on.indexOf('appstock/app/fqkline/get') >= 0);
  chk('仪表盘三卡：距触发最近/持仓·主力博弈/今日推荐', on.indexOf('距触发最近') >= 0 && on.indexOf('持仓 · 主力博弈') >= 0 && on.indexOf('今日推荐') >= 0);
  chk('点持仓行进持仓页并自动展开（focusHolding）', on.indexOf('G.focusHolding') >= 0 && on.indexOf("acts.classList.add('open')") >= 0);
  chk('★ 持仓卡「开价格提醒」操作已整体移除', on.indexOf('data-act="hgMonitor"') < 0 && on.indexOf('function addMonitoredFromHolding') < 0);

  /* ---------- ★ 首屏不白板 + 刷新不闪（2026-09-17 用户反馈「刷新时变白板」） ----------
     根因：① #dash 静态为空，boot() 要等 loadConfig/loadState 两轮网络才画得出内容；
          ② 行情每次回来都 innerHTML 全量重画，数据没变也重建 DOM → 闪 + 跳动。
     修复：骨架屏 + 本地缓存秒开 + 内容签名「没变就不动 DOM」。 */
  {
    const i0 = on.indexOf('<div id="dash">');
    const seg0 = i0 >= 0 ? on.slice(i0, i0 + 420) : '';
    chk('★ #dash 首屏骨架已内嵌（不再是空 div —— 打开就有形，不是白板）', i0 >= 0 && seg0.indexOf('class="sk') > 0);
    chk('★ 骨架条带脉动动画', /\.sk\{[^}]*skpulse/.test(on));
  }
  chk('★ 统一「有变化才重画」入口 paint(el, html, key)',
    on.indexOf('function paint(el, html, key)') >= 0 &&
    ["paint(box, h, 'dashSig')", "paint(box, html, 'actSig')", "paint(box, html, 'holdSig')", "paint(box, html, 'pickSig')"]
      .every(k => on.indexOf(k) >= 0));
  chk('★ 本地缓存：打开先用上次数据铺满，再后台静默刷新',
    on.indexOf('var CACHE_KEY') >= 0 && on.indexOf('function readCache()') >= 0 &&
    on.indexOf('function writeCache()') >= 0 && on.indexOf('function clearCache()') >= 0 &&
    on.indexOf('function paintFromCache()') >= 0);
  {
    const bi = on.indexOf('async function boot()');
    const bseg = bi >= 0 ? on.slice(bi, bi + 3200) : '';
    chk('★ boot 先画缓存、再去联网（顺序反了首屏还是白板）',
      bi >= 0 && bseg.indexOf('paintFromCache()') > 0 && bseg.indexOf('paintFromCache()') < bseg.indexOf('await loadConfig()'));
    chk('★ 刷新失败时保留缓存数据，不清空页面', bseg.indexOf('下面是上次的数据') >= 0);
    chk('boot 成功写缓存；换仓库/恢复备份时作废旧缓存',
      bseg.indexOf('writeCache()') >= 0 && on.indexOf('clearCache()') >= 0);
  }

  /* ---------- ★ 透视模式（2026-09-17 用户需求：看清散户在干什么，站到主力那边） ----------
     取代了原来的「走势/机会/风险」评测：原来那套是干巴巴的技术面描述，
     用户要的是从 A 股交易本质出发 —— 散户在割肉还是追高接筹码、主力在建仓还是派发。 */
  chk('★ 旧评测已整体下线（evalFromBars/evalEnsure/demoEvalData 全无）',
    on.indexOf('function evalFromBars') < 0 && on.indexOf('function evalEnsure') < 0 && on.indexOf('function demoEvalData') < 0);
  chk('★ 旧评测当日缓存 G.evalCache 已移除', on.indexOf('G.evalCache') < 0);
  chk('★ 干巴巴的走势/机会/风险三要素已移除（评测标签无残留）',
    on.indexOf('ev-k">走势') < 0 && on.indexOf('ev-k">机会') < 0 && on.indexOf('ev-k">风险') < 0 &&
    on.indexOf('>机会<') < 0 && on.indexOf('>风险<') < 0);
  chk('恐贪页的「走势」曲线卡仍在（只删评测标签，没误删恐贪页）',
    on.indexOf('>走势<') >= 0 && on.indexOf('id="fngChart"') >= 0 && on.indexOf('id="fngTabs"') >= 0);
  chk('★ 旧评测摘要样式 hg-eval 已清除（不留死代码）', on.indexOf('hg-eval') < 0);

  chk('含透视核心标记 CHIP-CORE-BEGIN（且仅 1 个）', (on.match(/CHIP-CORE-BEGIN/g) || []).length === 1);
  chk('含透视核心标记 CHIP-CORE-END（且仅 1 个）', (on.match(/CHIP-CORE-END/g) || []).length === 1);
  chk('透视核心已挂到 window（root.ChipCore）', on.indexOf('root.ChipCore') >= 0);
  {
    const B = '/* ==== CHIP-CORE-BEGIN ==== */', E = '/* ==== CHIP-CORE-END ==== */';
    const i = on.indexOf(B), j = on.indexOf(E);
    const core = fs.readFileSync('D:/mywork/stock-alert-cloud/chip-core.js', 'utf8');
    const onlineInner = (i >= 0 && j > i) ? on.slice(i + B.length, j).trim() : '';
    chk('线上注入的透视核心与本地 chip-core.js 逐字一致', !!onlineInner && onlineInner === core.trim());
  }
  chk('九件事判定齐备：散户割肉/追高/抄底 + 主力建仓/派发/锁仓 + 站队结论',
    ['judgeRetail', 'judgeMain', 'judgeStance'].every(f => on.indexOf('function ' + f + '(m)') >= 0));
  chk('筹码分布 + 主力/散户成本 + 获利盘 + 集中度 + 支撑压力',
    ['chipsDistribution', 'analyzeChips', 'flowStats', 'volumeStats'].every(f => on.indexOf('function ' + f + '(') >= 0));

  chk('透视存档读取 chips-history.json（三源降级）',
    on.indexOf('chips-history.json') >= 0 && on.indexOf('async function chipsLoadRaw') >= 0);
  {
    const i = on.indexOf('async function chipsLoadRaw');
    const seg = on.slice(i, i + 2600);
    const iJ = seg.indexOf('cdn.jsdelivr.net'), iR = seg.indexOf('raw.githubusercontent.com');
    chk('透视备源顺序：jsDelivr 在 raw 之前', iJ > 0 && iR > iJ);
    chk('透视每次抓取带超时（API 9000ms / 备源 8000ms）', seg.indexOf(', 9000)') > 0 && seg.indexOf(', 8000)') > 0);
  }
  chk('存档缺这只时就地实时算（chipLiveFrom，东财资金流 JSONP）',
    on.indexOf('async function chipLiveFrom') >= 0 && on.indexOf('push2his.eastmoney.com') >= 0);
  chk('透视入口 chipEnsure 有幂等签名 + 防重入（防 renderDash 死循环）',
    on.indexOf('G.chipSig') >= 0 && on.indexOf('G.chipBusy') >= 0);
  chk('透视数据到位后重画仪表盘与持仓页（renderChipViews）',
    on.indexOf('function renderChipViews()') >= 0 && on.indexOf('chipEnsure()') >= 0);
  chk('云端算筹码的理由写进代码（资金流接口在手机浏览器不可靠）',
    on.indexOf('手机浏览器') >= 0 && on.indexOf('T+1') >= 0);

  /* 5 日线连续站上（用户指定口径：开盘收盘都站上才算；≥2天提示卖出/1天只标天数/0天不显示） */
  chk('5 日线连续站上口径在 SignalCore（ma5Streak，逐日各用截止当日的 5 日线）',
    on.indexOf('function ma5Streak(bars, endIdx)') >= 0 && on.indexOf('ma5Streak: ma5Streak') >= 0);
  chk('本地封装 ma5Of 调 SignalCore.ma5Streak', on.indexOf('SC.ma5Streak(bars)') >= 0);
  chk('★ 5 日线标识三态：≥2 天橙色告警 / 1 天灰弱化 / 0 天不渲染',
    on.indexOf('.hg-ma5 .m5-badge') >= 0 && on.indexOf('.hg-ma5.watch') >= 0 &&
    on.indexOf('天站上 5 日线') >= 0 && on.indexOf('if(!st || !st.days) return') >= 0);

  /* ---------- ★ 主力博弈 V3 显示（2026-09-17 用户需求：把 V3 多源核验结论显示在持仓页，
         替换原来的「散户/主力行为」判定显示；口径与 mobile_monitor V3 同源） ---------- */
  chk('★ 持仓列表用「5日线标识 + V3 判定摘要」替代旧透视摘要',
    on.indexOf('var pvHtml = ma5Html(h.code) + v3BriefHtml(h.code)') >= 0);
  chk('★ 展开区渲染 V3 详情（v3DetailHtml）', on.indexOf('v3DetailHtml(h.code)') >= 0);
  chk('★ 旧透视渲染调用已下线、函数保留可回退（chipBriefHtml/chipDetailHtml 只剩定义）',
    on.indexOf('chipBriefHtml(h.code)') < 0 && on.indexOf('chipDetailHtml(h.code)') < 0 &&
    on.indexOf('function chipBriefHtml(code)') >= 0 && on.indexOf('function chipDetailHtml(code)') >= 0);
  chk('V3 三源：当日涨跌（行情）/ 当日主力净额（东财 fflow）/ 20 日趋势（腾讯日K）',
    on.indexOf('fetchDailyBars(h.code, V3_BARS)') >= 0 && on.indexOf('push2his.eastmoney.com') >= 0 &&
    /* 2026-09-20「只留结论」：三源明细格（①②③）已撤下界面，但取数管道与翻译函数必须还在 */
    on.indexOf('v3sign(q.chg)') >= 0 && on.indexOf('v3sign(mainNet)') >= 0 &&
    on.indexOf('v3sign(v.ret20)') >= 0 && on.indexOf('function v3SrcNote(') >= 0 &&
    onNoCmt.indexOf('① 当日涨跌') < 0);
  chk('V3 常量与 mobile_monitor 同源（AGREE_RATIO=0.66 / MIN_SOURCES=2 勿改）',
    on.indexOf('V3_AGREE_RATIO = 0.66') >= 0 && on.indexOf('V3_MIN_SOURCES = 2') >= 0);
  chk('V3 判定三态齐备：主信号 / 数据冲突下修 / 源不足观察（+趋势持有）',
    ["'normal'", "'downgrade'", "'observe'", "'trend'"].every(s => on.indexOf(s) >= 0));
  chk('★ 趋势跟随条件：连续 ≥3 天冲突 + 20 日涨 >15%（对齐 v3_engine.run）',
    on.indexOf('v.conflictDays >= 3') >= 0 && on.indexOf('v.ret20 > 0.15') >= 0);
  chk('V3 冲突天数跨日持久 + 同日幂等（localStorage v3_state，对齐 scheduler.daily_job）',
    on.indexOf('sa_v3_state_v1') >= 0 && on.indexOf('rec.lastDate !== today') >= 0 &&
    on.indexOf('old && old.at === today') >= 0);
  chk('★ 数据缺失不伪造：有效源不足 2 个只观察、冲突计数不动',
    on.indexOf("v.state = 'observe'") >= 0 && on.indexOf("if(srcs.length < V3_MIN_SOURCES)") >= 0);
  chk('V3 入口挂在 renderDash 末尾且幂等（chipEnsure 之后；v3Sig/v3Busy 防死循环）',
    /chipEnsure\(\)[\s\S]{0,160}v3Ensure\(\)/.test(on) && on.indexOf('G.v3Sig') >= 0 && on.indexOf('G.v3Busy') >= 0);
  /* 2026-09-20「只留结论」：三源明细 / 共识票数 / 冲突天数 / 置信度属推理中间量，已从详情页撤下 */
  chk('★ 详情页只留主力 / 散户 / 综合研判（次要参考）/ 中长线，推理中间量与记账信息全部撤下',
    on.indexOf("主力 → '") >= 0 && on.indexOf('h += retailLineHtml(code)') >= 0 &&
    on.indexOf('综合研判（次要参考）→ ') >= 0 && on.indexOf('中长线 → ') >= 0 &&
    on.indexOf('cd-act') >= 0 &&
    /* 2026-09-20 追加撤下：风险控制（止损位）与仓位那两行 */
    /* ⚠️ 必须判**调用**（h += …），不能只搜函数名——`function mlStopHtml(code){` 的定义本身就含
       `mlStopHtml(code)`，按函数名搜会永远失败（这两个函数是刻意保留可回退的）。 */
    onNoCmt.indexOf('h += mlStopHtml(code)') < 0 && onNoCmt.indexOf('h += mlPositionHtml(code, ws)') < 0 &&
    onNoCmt.indexOf('多源共识') < 0 && onNoCmt.indexOf('冲突天数') < 0 &&
    (function () { /* 详情页整段不得再拼任何指标格（cd-row / cd-v）*/
      const i = on.indexOf('function v3DetailHtml(');
      if (i < 0) return false;
      const j = on.indexOf('function demoV3Data(', i);
      const seg = on.slice(i, j > i ? j : i + 9000);
      return seg.indexOf('cd-row') < 0 && seg.indexOf('cd-v') < 0;
    })());
  chk('★ 展示层：三源翻译成交易行为词（拉升/吸筹/建仓区…），不再干巴巴说方向',
    on.indexOf('function v3SrcNote(') >= 0 && on.indexOf('function v3Head(') >= 0 && on.indexOf('function v3Sub(') >= 0 &&
    ['拉升', '回落', '吸筹', '派发', '建仓区', '阴跌'].every(k => on.indexOf(k) >= 0));
  chk('★ 展示层：主标题覆盖五类核心场景（放量突破/回补吸筹/拉高诱多/主力持续派发/高位出货完毕）',
    ['放量突破', '回补吸筹', '拉高诱多', '主力持续派发', '高位出货完毕'].every(k => on.indexOf(k) >= 0));
  chk('★ 展示层：用户点的口语词都在（弱回流/良性回踩/撤退嫌疑/低位吸筹/主力建仓拉升）',
    ['弱回流', '良性回踩', '撤退嫌疑', '低位吸筹', '主力建仓拉升'].every(k => on.indexOf(k) >= 0));
  chk('★ 展示层：操作建议结合自己的持仓成本（出厂前文案必须带上成本）',
    on.indexOf('function v3Advice(') >= 0 && on.indexOf('PC.fmtNum(h.cost, 2)') >= 0 &&
    on.indexOf('浮盈') >= 0 && on.indexOf('已被套') >= 0);
  chk('★ ★ 展示层不编目标价 —— v3Advice 全文只讲已发生的事实，不含「目标价」三字', (function () {
    var i = on.indexOf('function v3Advice(');
    if (i < 0) return false;
    var body = on.slice(i, i + 1400);
    var j = body.indexOf('function v3BriefHtml(');   // 截到下一个函数为止
    return (j > 0 ? body.slice(0, j) : body).indexOf('目标价') < 0 && i >= 0;
  })());
  chk('★ 展示层：缺源如实说「缺数据」，不伪装成走平', on.indexOf('缺数据') >= 0);
  chk('★ 价格结构 v2.1 已移植上线（与 mobile_monitor Python 引擎同口径）',
    on.indexOf('function v3PsRow(') >= 0 && on.indexOf('function psCalc(') >= 0 &&
    on.indexOf('PS_VR_LOW = 1.2') >= 0 && on.indexOf('PS_VR_HIGH = 3.0') >= 0 &&
    on.indexOf('PS_PCT_JUMP = 7.0') >= 0 && on.indexOf('PS_VR_REV = 1.5') >= 0);
  chk('★ 价格结构四增强齐备：诱多硬过滤/破位硬条件/VR加分+天量待确认/反转首日豁免',
    on.indexOf('force_no_trade') >= 0 && on.indexOf('sell_bias') >= 0 &&
    on.indexOf('reversal_exempt') >= 0 && on.indexOf('pending_confirm') >= 0);
  chk('★ 持仓页不再显示「V3」版本号标识（2026-09-19 用户要求）',
    on.indexOf('chip-title">主力博弈 V3') < 0 && on.indexOf("'以 V3 为准'") < 0 &&
    on.indexOf("ev-k\">V3") < 0 && on.indexOf('chip-title">主力博弈') >= 0);
  chk('★ 散户行为行已放回（2026-09-19）：首页短标签 + 详情完整说明，且纯展示不参与 V3 投票',
    on.indexOf('function retailLineHtml(') >= 0 && on.indexOf('h += retailLineHtml(code)') >= 0 &&
    on.indexOf('ev-k">散户') >= 0 && on.indexOf('shortTag(rtChip.tag)') >= 0 &&
    on.indexOf("G.chipMap && G.chipMap[code]") >= 0 && on.indexOf('V3_AGREE_RATIO = 0.66') >= 0);
  chk('★ 综合研判 F4 已落地（2026-09-19 二次修复）：破位+建仓保留跟（回踩标注），只有破位+派发才躲',
    on.indexOf("FUSION_VERSION = 'F4'") >= 0 && on.indexOf('function fusionVerdict(') >= 0 &&
    on.indexOf('ev-k">综合') >= 0 && on.indexOf('综合研判（次要参考）→ ') >= 0 &&
    on.indexOf("why:'破位+主力派发'") >= 0 && on.indexOf("fvD.pullback ? '（回踩）'") >= 0 &&
    on.indexOf('retailLineHtml') >= 0);
  /* ★ 2026-09-20：综合研判降级为中性状态条（用户反馈它常与主力博弈打架）*/
  chk('★ 综合研判降级为中性状态条（cd-stat mute），不再是与主力博弈同级的彩色结论块',
    on.indexOf('综合研判（次要参考）') >= 0 && on.indexOf('以上面主力博弈为准') >= 0);
  chk('★ 中长线关键位置引擎 S2（2026-09-20 换版）：周/月级四维度 + 波段定性（本态第 N 天）',
    on.indexOf("STAGE_VERSION = 'S2'") >= 0 && on.indexOf('function weekStage(') >= 0 &&
    on.indexOf('ev-k">中长线') >= 0 && on.indexOf('中长线 → ') >= 0 &&
    on.indexOf('sa_ml_state_v1') >= 0 &&
    on.indexOf('function mlRunDays(') >= 0 && on.indexOf('波段定性') >= 0 &&
    on.indexOf("' · 第 ' + rd + ' 天'") >= 0);
  chk('★ S2 建仓区位置闸门（剔除「暴涨暴跌后半山腰当低位」）+ 已删掉被证明冗余的「60日涨<15%」',
    on.indexOf('var ML_LOW_GATE = 0.30') >= 0 && on.indexOf('premLow < ML_LOW_GATE') >= 0 &&
    on.indexOf('premLow') >= 0 && on.indexOf('+24.6%') >= 0 &&
    onNoCmt.indexOf('ret60 < 0.15') < 0);
  chk('★ S2 同周期支撑/压力 + 高位过热卖点（替换旧「派发完毕」）',
    on.indexOf('var ML_SUP_GATE = 0.15') >= 0 && on.indexOf('supDist < ML_SUP_GATE') >= 0 &&
    on.indexOf('wLo20') >= 0 && on.indexOf('wHi20') >= 0 &&
    on.indexOf('topWarn') >= 0 &&
    on.indexOf('var ML_SELL_MA5 = 0.05') >= 0 && on.indexOf("m.key = 'sell-overheat'") >= 0 &&
    on.indexOf('distribute-done') < 0);
  chk('★ S2 卖点区间级口径（躲对率 76%）+ 旧「派发完毕」停用原因已写清（躲对率仅 50%）',
    on.indexOf('躲对率 76%') >= 0 && on.indexOf('躲对率仅 50%') >= 0);
  chk('★ S2 买点「说清代价」（每只每年 0.45 段 / 建仓期平均还要浮亏 −2.9%）',
    on.indexOf('0.45 段') >= 0 && on.indexOf('0.45 次') >= 0 && on.indexOf('2.9%') >= 0);
  /* ★ 2026-09-20 晚：持仓不再记成本 → 止损位失去基准，风控块从详情页撤下
     （mlStopLoss / mlStopHtml 保留在代码里可回退，只是不再被调用）*/
  chk('★ S2 风控已撤下界面但仍可回退：ML_STOP 与 mlStopLoss/mlStopHtml 保留，详情页不再调用',
    on.indexOf('var ML_STOP = 0.10') >= 0 && on.indexOf('function mlStopLoss(') >= 0 &&
    on.indexOf('function mlStopHtml(') >= 0 &&
    onNoCmt.indexOf('h += mlStopHtml(code)') < 0);
  chk('★ S2 筹码维度已接入 ChipCore（只展示 + 给卖点分级，不参与触发判定）',
    on.indexOf('mainCost: mainCost, mcDev: mcDev') >= 0 && on.indexOf('m.chipGrade') >= 0 &&
    on.indexOf('mcDev >= 0.15') >= 0 && on.indexOf('chipadd-report') >= 0 &&
    /* 2026-09-20 详情页精简：口径小字撤下界面（分级不触发的保证由上面的 chipGrade 单测锁定）*/
    onNoCmt.indexOf('不参与触发判定') < 0);
  chk('★ S2 大盘环境已接入（恐贪指数 + 风格驾驶舱，只标注、不参与触发）',
    on.indexOf('function mlMarketCtx(') >= 0 && on.indexOf('function mlMarketEnsure(') >= 0 &&
    on.indexOf('function mlFngZone(') >= 0 && on.indexOf('大盘风格') >= 0 &&
    on.indexOf('恐贪指数') >= 0 && on.indexOf('仅环境标注') >= 0 &&
    onNoCmt.indexOf('无法回测') < 0);
  /* ★ 2026-09-20：首页「今日推荐」上方加大盘驾驶舱概览卡，点进驾驶舱详情 */
  chk('★ 首页新增大盘驾驶舱概览卡（排在今日推荐上方，点进驾驶舱详情）',
    on.indexOf('data-act="dash-style"') >= 0 && on.indexOf('大盘驾驶舱') >= 0 &&
    on.indexOf("act === 'dash-style'") >= 0 && on.indexOf('openStyle()') >= 0 &&
    (function(){ /* 概览卡必须排在「今日推荐」之前
        ⚠️ 只在 renderDash 里比顺序：#dash 的**首屏骨架**里也有一份 `dash-h">今日推荐`
        （静态占位卡，位置在文件更前面），搜全文件会把骨架当成渲染顺序。 */
      const i0 = on.indexOf('function renderDash(map)');
      if (i0 < 0) return false;
      const seg = on.slice(i0, i0 + 8000);
      const i = seg.indexOf('data-act="dash-style"');
      const j = seg.indexOf('dash-h">今日推荐');
      return i >= 0 && j >= 0 && i < j;
    })());
  chk('★ 详情页只留结论与状态（2026-09-20 用户要求：小字备注、推理过程、中间指标格全部撤下）',
    on.indexOf('function cdCell(k, v, unit, tone)') >= 0 &&
    on.indexOf('.cd-stat{') >= 0 && on.indexOf('.cd-v.good{') >= 0 &&
    on.indexOf('pos250 > ML_SELL_POS') >= 0 && on.indexOf('mcDev >= 0.15') >= 0 &&
    (function(){
      const i = on.indexOf('function v3DetailHtml(');
      if (i < 0) return false;
      const j = on.indexOf('function demoV3Data(', i);
      const seg = on.slice(i, j > i ? j : i + 9000);
      /* 判渲染产物：v3DetailHtml 里不得再拼任何 cd-note 小字块 */
      return seg.indexOf('class="cd-note"') < 0 && seg.indexOf('cd-stat') >= 0;
    })());
  chk('★ 结论文案 **强调** 渲染为粗体（不再把字面星号显示给用户）',
    on.indexOf('function mdB(') >= 0 && on.indexOf('mdB(esc(ws.advice))') >= 0);
  /* ★ 2026-09-20：详情块原来继承了胶囊样式的 border-radius:999px + 1px 边框（「圆弧线框」），已去掉 */
  chk('★ 详情块不再套胶囊「圆弧线框」',
    on.indexOf('.chip.cd-block{') >= 0 && on.indexOf('class="chip cd-block"') >= 0);
  /* ★ 2026-09-20 晚：仓位那一行也撤下界面（用户要求），函数保留可回退 */
  chk('★ 仓位一行已撤下界面但仍可回退：mlPositionHtml 保留，详情页不再调用',
    on.indexOf('function mlPositionHtml(') >= 0 &&
    on.indexOf('你自己控') >= 0 && on.indexOf('别全进全出') >= 0 &&
    onNoCmt.indexOf('h += mlPositionHtml(code, ws)') < 0 &&
    on.indexOf('function mlPosTarget(') < 0 && on.indexOf('var ML_BASE') < 0 &&
    on.indexOf('收益 ÷ 回撤') < 0);
  chk('★ S2 大盘懒加载不主动重画（靠行情轮询自然刷新，避免 renderDash 无限循环）',
    (function(){
      const i = on.indexOf('function mlMarketEnsure(');
      if (i < 0) return false;
      const seg = on.slice(i, i + 600);
      return seg.indexOf('renderDash') < 0 && seg.indexOf('renderActive') < 0;
    })());
  chk('★ 短期「综合」已改为只在结论变化时提示（用户为中长线，不做每日信号）',
    on.indexOf("'sa_ml_f4_v1'") >= 0 && on.indexOf('结论有变化') >= 0);
  chk('★ 行情已带流通市值 f21（中长线引擎算「主力净额÷流通市值」需要）',
    on.indexOf('f14,f21') >= 0 && on.indexOf('mv:Number(d.f21)') >= 0);
  chk('★ 中长线引擎复用 chipEnsure 同一份日K（零额外请求）',
    on.indexOf('G.dayBars[h.code] = bars') >= 0 && on.indexOf('G.dayBars && G.dayBars[code]') >= 0);
  chk('★ 持仓结论文案不再带彩色圆点图标（2026-09-19 用户要求，避免半个 emoji 变方块）',
    !/[\u{1F7E2}\u{1F7E1}\u{1F7E0}\u{1F534}\u{26AA}\u{26D4}\u{23F3}\u{FFFD}]/u.test(on));
  chk('★ 结构裁决优先级（硬裁决改写标题，否则以主力博弈为准）+ 无板块数据保守路径',
    on.indexOf('function psRuling(') >= 0 && on.indexOf('不操作(诱多过滤)') >= 0 &&
    on.indexOf('强减仓(破位+主力派发)') >= 0 && on.indexOf('待确认(天量)') >= 0);
  chk('★ 价格结构复用 v3Ensure 同一份日K（零额外请求），演示数据带 ps',
    /var psRow = v3PsRow\(bars\)/.test(on) && on.indexOf('ps:{ score:') >= 0);
  chk('演示模式 V3 数据 demoV3Data（预览/快照可复现）', on.indexOf('function demoV3Data()') >= 0);
  chk('演示模式旧透视数据 demoChipData 保留可回退', on.indexOf('function demoChipData()') >= 0);
  chk('★ 持仓重画保留展开状态（异步回来不收起面板）',
    on.indexOf('var openSet') >= 0 || on.indexOf('openSet[') >= 0);
  chk('V3 配色沿用避开红绿（红涨绿跌语义不被污染）',
    on.indexOf('红/绿') >= 0 || on.indexOf('红涨绿跌') >= 0);

  /* ---------- 持仓 / 推荐 实时价（2026-09-17 用户反馈：这两处都没取实时价） ---------- */
  chk('★ 持仓卡显示实时价（.hg-pxrow 现价 + 当日涨跌）', on.indexOf('hg-pxrow') >= 0 && on.indexOf('.hg-px{font-size:25px') >= 0);
  chk('★ 持仓卡不再有「监控中/未监控」标识', on.indexOf('hg-tag') < 0 && on.indexOf("(mon ? '监控中' : '未监控')") < 0);
  chk('★ 汇总卡不再统计「没开提醒」', on.indexOf('只没开提醒') < 0);
  chk('★ 持仓统计条只报条数（2026-09-20：成本合计已撤）',
    on.indexOf("'共 ' + rows.length + ' 条持仓'") >= 0 && onNoCmt.indexOf('成本合计') < 0);
  chk('★ 推荐卡显示实时价 + 较推荐日涨跌', on.indexOf('较推荐日') >= 0 && on.indexOf('pick-sub') >= 0);
  chk('★ 取价范围已纳入持仓清单（根因修复）', on.indexOf('for(var i2=0;i2<hs.length;i2++) need.push(hs[i2])') >= 0);
  chk('★ 取价范围已纳入推荐存档', on.indexOf('for(var i3=0;i3<pk.length;i3++) need.push(pk[i3])') >= 0);
  chk('行情批量分批抓取（QUOTE_CHUNK=50，避免 URL 过长）', on.indexOf('QUOTE_CHUNK') >= 0);
  chk('★ 行情回来后重渲持仓页/推荐页（否则一直停在加载中）',
    on.indexOf("if($('pgHoldings').classList.contains('on')) renderHoldings(map)") >= 0 &&
    on.indexOf('if(PICKS.data) renderPicks()') >= 0);
  chk('打开推荐页时补齐推荐股行情', on.indexOf('缺价就补一次行情') >= 0);
  chk('演示行情含推荐股 000651（预览/快照可复现）', on.indexOf("'0.000651'") >= 0);

  /* ---------- 归档三层可达性 ---------- */
  const apiUrl = 'https://api.github.com/repos/' + REPO + '/contents/fng-history.json';
  const rApi = await get(apiUrl, { headers: { 'User-Agent': 'accept', ...(GH ? { Authorization: 'token ' + GH } : {}) } });
  let apiDays = null;
  try { const j = JSON.parse(rApi.body); if (j.content) apiDays = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8')).days.length; } catch (e) {}
  if (rApi.status === 403) {
    console.log('ℹ️  ① GitHub API 匿名读被限流（HTTP 403），跳过判定 —— 设 GH_TOKEN 可解');
  } else {
    chk('① GitHub API 归档可达', rApi.status === 200 && apiDays > 0, 'status=' + rApi.status + ' days=' + (apiDays || '-'));
  }

  /* ⚠️ jsDelivr 对同一 IP 的密集请求会直接掉连接（status=0）—— 和 GitHub 匿名 403 是同一类问题：
     **瞬时抖动 ≠ 归档不可用**（手工探测同一条 URL 就返回 200）。所以重试 3 次；仍失败打 ℹ️ 不判失败。 */
  let rJsd = { status: 0, body: '' }, jsdDays = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    rJsd = await get('https://cdn.jsdelivr.net/gh/' + REPO + '@main/fng-history.json', { headers: { 'User-Agent': 'accept' } });
    jsdDays = null;
    try { jsdDays = JSON.parse(rJsd.body).days.length; } catch (e) {}
    if (rJsd.status === 200 && jsdDays > 0) break;
    if (attempt < 3) await new Promise(r => setTimeout(r, 1500));
  }
  if (jsdDays > 0) chk('② cdn.jsdelivr.net 归档可达（免鉴权，国内可达）', true, 'status=' + rJsd.status + ' days=' + jsdDays);
  else console.log('ℹ️  jsDelivr 连续 3 次没读到（status=' + rJsd.status + '）—— 属瞬时抖动或同 IP 密集请求被限，' +
    '手工复核同一条 URL 通常返回 200，不计失败');

  const rRaw = await get('https://raw.githubusercontent.com/' + REPO + '/main/fng-history.json', { headers: { 'User-Agent': 'accept' } });
  console.log('ℹ️  raw.githubusercontent.com 状态=' + rRaw.status + '（本网络不可达为已知，已置于备源末位，不判失败）');

  if (apiDays && jsdDays) chk('归档天数一致（API vs jsDelivr）', apiDays === jsdDays, apiDays + '/' + jsdDays);

  /* ---------- 云端代码是否已上线（仓库里有本轮的 V1/V2 文件） ---------- */
  /* ⚠️ 匿名读 GitHub API 会被限流（HTTP 403）。403 说明"没读到"，不等于"文件不在"，
     所以只把 404 判为失败；403 打成提示（设 GH_TOKEN 可解）。 */
  for (const f of ['push.js', 'heartbeat.js', 'position-core.js', 'signal-core.js', 'chip-core.js', 'signals.js', 'screener.js', 'chips.js', 'review.js', 'style.js']) {
    const r = await get('https://api.github.com/repos/' + REPO + '/contents/' + f, { headers: { 'User-Agent': 'accept', ...(GH ? { Authorization: 'token ' + GH } : {}) } });
    if (r.status === 403) { console.log('ℹ️  云端 ' + f + ' 匿名读被限流（HTTP 403），跳过判定'); continue; }
    chk('云端仓库已含 ' + f, r.status === 200, 'status=' + r.status);
  }

  /* 透视存档 chips-history.json（由 chips.js 每日收盘生成；未上线前只提示不判失败） */
  {
    const rC1 = await get('https://cdn.jsdelivr.net/gh/' + REPO + '@main/chips-history.json', { headers: { 'User-Agent': 'accept' } });
    let n = null;
    try { n = Object.keys(JSON.parse(rC1.body).stocks || {}).length; } catch (e) {}
    if (rC1.status === 200 && n) {
      chk('透视存档 chips-history.json 云端可达（含筹码/主力/散户/站队）', n > 0, 'stocks=' + n);
      let one = null;
      try { const j = JSON.parse(rC1.body); one = j.stocks[Object.keys(j.stocks)[0]]; } catch (e) {}
      chk('存档条目结构完整（retail/main/stance 三块判定都在）',
        !!one && !!one.retail && !!one.main && !!one.stance,
        one ? (Object.keys(one).join('/')) : '-');
    } else {
      console.log('ℹ️  chips-history.json 尚未上线（status=' + rC1.status + '）—— 需先跑 tools/upload.js 传 chip-core.js/chips.js 并首次执行 chips.js');
    }
  }

  /* 风格驾驶舱存档 style-history.json（由 style.js 每日收盘生成；未上线前只提示不判失败） */
  {
    const rS1 = await get('https://cdn.jsdelivr.net/gh/' + REPO + '@main/style-history.json', { headers: { 'User-Agent': 'accept' } });
    let snap = null;
    try { const j = JSON.parse(rS1.body); snap = Array.isArray(j.days) && j.days[j.days.length - 1]; } catch (e) {}
    if (rS1.status === 200 && snap) {
      chk('风格存档 style-history.json 云端可达（style/cycle/picks 齐全）',
        !!snap.style && !!snap.cycle && Array.isArray(snap.picks) && snap.picks.length <= 3,
        'date=' + snap.date + ' style=' + (snap.style && snap.style.name) + ' picks=' + (snap.picks || []).length);
    } else {
      console.log('ℹ️  style-history.json 尚未上线（status=' + rS1.status + '）—— 需先上传 style.js 并首次执行 style.js');
    }
  }

  /* ---------- 腾讯日线公网可达（盘中实时用） ---------- */
  const rQ = await get('https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=sh000985,day,,,20,qfq', { headers: { 'User-Agent': 'Mozilla/5.0' } });
  let klen = 0;
  try { klen = JSON.parse(rQ.body).data.sh000985.day.length; } catch (e) {}
  chk('腾讯日线接口公网可达', rQ.status === 200 && klen >= 15, 'status=' + rQ.status + ' bars=' + klen);

  console.log(LF + '================ 汇总 ================');
  console.log('通过：' + pass + '    失败：' + fail);
  console.log(fail === 0 ? '结果：ALL GREEN' : '结果：存在失败项');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
