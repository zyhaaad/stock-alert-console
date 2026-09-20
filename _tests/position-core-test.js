/* 持仓账本核心算法 · 单元测试（私有）
 * 覆盖 position-core.js 的全部对外函数，并校验「注入到 console.html 的那一份」与云端文件逐字一致。
 * 运行：node _tests/position-core-test.js
 */
'use strict';
const fs = require('fs');
const P = require('D:/mywork/stock-alert-cloud/position-core.js');

let pass = 0, fail = 0; const fails = [];
function ok(cond, name) { if (cond) pass++; else { fail++; fails.push(name); } }
function eq(a, b, name) { ok(a === b, name + '（期望 ' + JSON.stringify(b) + '，实际 ' + JSON.stringify(a) + '）'); }
function near(a, b, name, tol) { ok(Math.abs(a - b) <= (tol || 1e-9), name + '（期望≈' + b + '，实际 ' + a + '）'); }

/* ---------------- num / cleanNum ---------------- */
ok(isNaN(P.num('')), 'num("") → NaN（空串不算 0）');
ok(isNaN(P.num(null)), 'num(null) → NaN');
ok(isNaN(P.num(undefined)), 'num(undefined) → NaN');
ok(isNaN(P.num('abc')), 'num("abc") → NaN');
ok(isNaN(P.num(Infinity)), 'num(Infinity) → NaN');
eq(P.num('3.5'), 3.5, 'num("3.5") → 3.5');
eq(P.num(0), 0, 'num(0) → 0（数值 0 是合法数字）');
eq(P.num('-2'), -2, 'num("-2") → -2');

eq(P.cleanNum(5), 5, 'cleanNum(5) → 5');
eq(P.cleanNum('5'), 5, 'cleanNum("5") → 5');
eq(P.cleanNum(0), undefined, 'cleanNum(0) → undefined（0 不是合法持仓值）');
eq(P.cleanNum(-1), undefined, 'cleanNum(-1) → undefined');
eq(P.cleanNum(''), undefined, 'cleanNum("") → undefined');

/* ---------------- posOf / hasPosition ---------------- */
eq(P.posOf(null), null, 'posOf(null) → null');
eq(P.posOf({}), null, 'posOf({}) → null（无持仓字段）');
eq(P.posOf({ cost: 10 }), null, '只有成本没股数 → null');
eq(P.posOf({ qty: 100 }), null, '只有股数没成本 → null');
eq(P.posOf({ cost: 0, qty: 100 }), null, '成本 0 → null（避免把没填当填了 0）');
eq(P.posOf({ cost: 10, qty: 0 }), null, '股数 0 → null');
eq(P.posOf({ cost: -1, qty: 100 }), null, '成本为负 → null');
eq(P.posOf({ cost: 10, qty: -100 }), null, '股数为负 → null');
eq(P.posOf({ cost: 'abc', qty: 100 }), null, '成本非数字 → null');
const p1 = P.posOf({ cost: 30, qty: 1000 });
ok(p1 && p1.cost === 30 && p1.qty === 1000, '正常持仓 → {cost:30, qty:1000}');
const p2 = P.posOf({ cost: '30.5', qty: '200' });
ok(p2 && p2.cost === 30.5 && p2.qty === 200, '字符串型持仓值被正确解析');
eq(P.hasPosition({ cost: 10, qty: 100 }), true, 'hasPosition 有持仓 → true');
eq(P.hasPosition({ code: '600519' }), false, 'hasPosition 无持仓 → false');

/* ---------------- pnlOf ---------------- */
eq(P.pnlOf({ code: 'a' }, 10), null, '未记持仓 → pnlOf 返回 null（不是 0 元）');

const win = P.pnlOf({ cost: 30, qty: 1000 }, 31.24);
near(win.costVal, 30000, '成本金额 = 30 × 1000');
near(win.mktVal, 31240, '持仓市值 = 31.24 × 1000');
near(win.pnl, 1240, '浮盈 = (31.24 − 30) × 1000');
near(win.pnlPct, 0.04133333, '收益率 = 31.24/30 − 1', 1e-6);
eq(win.hasPrice, true, '有价 → hasPrice true');
eq(P.pnlClass(win.pnl), 'up', '浮盈 → 涨色 up（红）');

const lose = P.pnlOf({ cost: 1620, qty: 100 }, 1565.6);
near(lose.pnl, -5440, '浮亏 = (1565.6 − 1620) × 100');
near(lose.pnlPct, -0.03358024, '亏损率', 1e-6);
eq(P.pnlClass(lose.pnl), 'down', '浮亏 → 跌色 down（绿）');

const flat = P.pnlOf({ cost: 10, qty: 100 }, 10);
eq(flat.pnl, 0, '平价 → 盈亏 0');
eq(P.pnlClass(flat.pnl), 'flat', '盈亏 0 → 中性色 flat');

const nopx = P.pnlOf({ cost: 30, qty: 1000 }, NaN);
eq(nopx.hasPrice, false, '取不到价 → hasPrice false');
ok(isNaN(nopx.mktVal) && isNaN(nopx.pnl) && isNaN(nopx.pnlPct), '未计价时市值/盈亏/收益率均为 NaN');
near(nopx.costVal, 30000, '未计价时成本金额仍算得出');
const zpx = P.pnlOf({ cost: 30, qty: 1000 }, 0);
eq(zpx.hasPrice, false, '价格为 0 视为无效价 → hasPrice false');
const spx = P.pnlOf({ cost: 30, qty: 1000 }, '31.24');
eq(spx.hasPrice, true, '字符串价格也能算');
near(spx.pnl, 1240, '字符串价格的盈亏正确');

/* ---------------- portfolioOf ---------------- */
const empty = P.portfolioOf([], function () { return NaN; });
eq(empty.hasAny, false, '空组合 → hasAny false');
eq(empty.count, 0, '空组合 → count 0');
ok(isNaN(empty.totalPnl), '空组合 → totalPnl NaN');

const noPos = P.portfolioOf([{ code: 'a' }, { code: 'b' }], function () { return 10; });
eq(noPos.hasAny, false, '都没记持仓 → hasAny false');
eq(noPos.unrecordedCount, 2, '都没记持仓 → unrecordedCount 2');
eq(noPos.count, 0, '都没记持仓 → count 0');

const stocks = [
  { code: 'a', cost: 30, qty: 1000 },     // 31.24 → +1240
  { code: 'b', cost: 1620, qty: 100 },    // 1565.6 → −5440
  { code: 'c' },                          // 未记录
  { code: 'd', cost: 10, qty: 100 }       // 取不到价
];
const px = { a: 31.24, b: 1565.6, d: NaN };
const pf = P.portfolioOf(stocks, px);
eq(pf.count, 3, '记录持仓 3 只（a/b/d）');
eq(pf.unrecordedCount, 1, '未记录持仓 1 只（c）');
eq(pf.pricedCount, 2, '已计价 2 只（a/b）');
eq(pf.unpricedCount, 1, '未计价 1 只（d）');
near(pf.pricedMkt, 31240 + 156560, '已计价市值合计');
near(pf.pricedCost, 30000 + 162000, '已计价成本合计');
near(pf.totalPnl, 1240 - 5440, '总盈亏只按可计价的算（未计价的 d 不参与）');
near(pf.totalPnlPct, (31240 + 156560) / (30000 + 162000) - 1, '总收益率', 1e-9);
near(pf.totalCost, 30000 + 162000 + 1000, 'totalCost 含未计价的 d（1000 元）');
eq(pf.priced.length, 2, 'priced 列表 2 条');
eq(pf.rows.length, 3, 'rows 列表 3 条（含未计价）');

/* 取价函数形式 */
const pfFn = P.portfolioOf([{ code: 'a', cost: 10, qty: 100 }], function (st) { return st.code === 'a' ? 11 : NaN; });
near(pfFn.totalPnl, 100, '函数式取价：100 股 × 1 元 = 100');
/* 对象取价支持 {code:{price}} 形式 */
const pfObj = P.portfolioOf([{ code: 'a', cost: 10, qty: 100 }], { a: { price: 11 } });
near(pfObj.totalPnl, 100, '对象式取价支持 {code:{price}}');
/* 无取价器 */
const pfNone = P.portfolioOf([{ code: 'a', cost: 10, qty: 100 }]);
eq(pfNone.pricedCount, 0, '没给取价器 → 全部未计价');
eq(pfNone.unpricedCount, 1, '没给取价器 → unpricedCount 1');
ok(isNaN(pfNone.totalPnl), '没给取价器 → 总盈亏 NaN（不显示假 0）');

/* 全未计价时总盈亏必须是 NaN 而不是 0 */
const allNo = P.portfolioOf([{ code: 'a', cost: 10, qty: 100 }], function () { return NaN; });
eq(allNo.hasAny, true, '有持仓记录 → hasAny true');
eq(allNo.pricedCount, 0, '全未计价 → pricedCount 0');
ok(isNaN(allNo.totalPnl), '全未计价 → totalPnl NaN（避免显示成持平 0）');

/* ---------------- pnlClass ---------------- */
eq(P.pnlClass(1), 'up', 'pnlClass(+1) → up');
eq(P.pnlClass(-1), 'down', 'pnlClass(-1) → down');
eq(P.pnlClass(0), 'flat', 'pnlClass(0) → flat');
eq(P.pnlClass(NaN), 'flat', 'pnlClass(NaN) → flat');
eq(P.pnlClass(undefined), 'flat', 'pnlClass(undefined) → flat');

/* ---------------- 格式化 ---------------- */
eq(P.fmtNum(1234567.891, 2), '1,234,567.89', 'fmtNum 千分位');
eq(P.fmtNum(-1234.5, 2), '-1,234.50', 'fmtNum 负数');
eq(P.fmtNum(1234, 0), '1,234', 'fmtNum 零小数');
eq(P.fmtNum(NaN, 2), '—', 'fmtNum NaN → 破折号');

eq(P.fmtMoney(1240), '¥1,240.00', 'fmtMoney 默认两位 + 符号');
eq(P.fmtMoney(1240, { sign: true }), '+¥1,240.00', 'fmtMoney sign → 带 +');
eq(P.fmtMoney(-5440, { sign: true }), '-¥5,440.00', 'fmtMoney 负数带 -');
eq(P.fmtMoney(1240, { sym: false }), '1,240.00', 'fmtMoney sym:false → 不带 ¥');
eq(P.fmtMoney(NaN), '—', 'fmtMoney NaN → 破折号');
eq(P.fmtMoney(123456.789, { dec: 0 }), '¥123,457', 'fmtMoney dec:0 → 四舍五入到元');

eq(P.fmtPct(0.0413333), '+4.13%', 'fmtPct 正数带 +');
eq(P.fmtPct(-0.03358), '-3.36%', 'fmtPct 负数带 -');
eq(P.fmtPct(0), '0.00%', 'fmtPct 0 → 0.00%');
eq(P.fmtPct(NaN), '—', 'fmtPct NaN → 破折号');

eq(P.fmtQty(1000), '1,000', 'fmtQty 整数不显小数');
eq(P.fmtQty(1000.5), '1,000.50', 'fmtQty 非整数保留两位');
eq(P.fmtQty(NaN), '—', 'fmtQty NaN → 破折号');

/* ---------------- posLine ---------------- */
eq(P.posLine(null), '未记录持仓', 'posLine(null) → 未记录持仓');
eq(P.posLine(P.pnlOf({ cost: 30, qty: 1000 }, 31)), '持仓 1,000 股 · 成本 30.00', 'posLine 文案固定');

/* ---------------- 常量 ---------------- */
eq(typeof P.VERSION, 'number', 'VERSION 是数字');
ok(typeof P.FEE_NOTE === 'string' && P.FEE_NOTE.length > 0, 'FEE_NOTE 非空');

/* ============================================================
 *  持仓清单 holdings —— 与监控清单 stocks 是两个独立列表
 * ============================================================ */

/* ---------- normHolding ---------- */
eq(P.normHolding(null), null, 'normHolding(null) → null');
eq(P.normHolding({ code: 'abc', cost: 10, qty: 100 }), null, '代码不是 6 位数字 → null');
eq(P.normHolding({ code: '60051', cost: 10, qty: 100 }), null, '5 位代码 → null');
/* ★ 2026-09-20 规格变更（用户拍板）：持仓只记「持有哪一只」，成本/股数不再是有效性门槛
   —— 老数据的 cost/qty 仍然解析，但缺失或为 0 一律记 0，不再丢弃整条记录。 */
eq(P.normHolding({ code: '600519' }).code, '600519', '★ 只给代码也是一条有效持仓（不再要求成本/股数）');
eq(P.normHolding({ code: '600519', cost: 0, qty: 100 }).cost, 0, '成本 0 → 记 0（不再因此丢记录）');
eq(P.normHolding({ code: '600519', cost: 10, qty: 0 }).qty, 0, '股数 0 → 记 0（不再因此丢记录）');
const nh = P.normHolding({ code: 600519, name: '贵州茅台', cost: '1620', qty: '100', addedAt: '2026-09-01' });
eq(nh.code, '600519', 'normHolding 把 code 规范成字符串');
eq(nh.cost, 1620, 'normHolding 解析字符串成本');
eq(nh.qty, 100, 'normHolding 解析字符串股数');
eq(P.normHolding({ code: '600519', cost: 10, qty: 100 }).name, '600519', '没给名称时用代码兜底');
eq(P.normHolding({ code: '600519', cost: 10, qty: 100 }).addedAt, null, '没给时间 → null（不编造）');

/* ---------- validHoldings ---------- */
const vh = P.validHoldings([
  { code: '600519', cost: 1620, qty: 100 },
  { code: 'bad' },
  { code: '300750', cost: 180, qty: 100 },
  null
]);
eq(vh.length, 2, 'validHoldings 过滤掉残缺记录，只留 2 条');
eq(P.validHoldings(null).length, 0, 'validHoldings(null) → []');
eq(P.validHoldings(undefined).length, 0, 'validHoldings(undefined) → []');

/* ---------- findHolding ---------- */
const HS = [
  { code: '600519', name: '贵州茅台', cost: 1620, qty: 100 },
  { code: '300750', name: '宁德时代', cost: 180, qty: 100 }
];
eq(P.findHolding(HS, '600519').cost, 1620, 'findHolding 按代码命中');
eq(P.findHolding(HS, 300750).qty, 100, 'findHolding 数字代码也能命中');
eq(P.findHolding(HS, '000001'), null, '查不到 → null');
eq(P.findHolding(HS, '600519') === HS[0], false, '返回的是规范化副本，不是原对象引用');
eq(P.findHolding([{ code: '600519' }], '600519').code, '600519', '★ 命中代码即算已记持仓（成本/股数不再是门槛）');
eq(P.findHolding(null, '600519'), null, 'findHolding(null, ...) → null，不抛异常');

/* ---------- upsertHolding ---------- */
const up1 = P.upsertHolding(HS, { code: '600036', name: '招商银行', cost: 28, qty: 2000 });
eq(up1.length, 3, '新增一条 → 长度 3');
eq(HS.length, 2, 'upsertHolding 不改原数组（纯函数）');
eq(up1[2].code, '600036', '新记录追加在末尾');
const up2 = P.upsertHolding(HS, { code: '600519', name: '贵州茅台', cost: 1700, qty: 200 });
eq(up2.length, 2, '同代码 → 覆盖而不是新增');
eq(up2[0].cost, 1700, '覆盖后成本为新值');
eq(up2[0].qty, 200, '覆盖后股数为新值');
const up3 = P.upsertHolding([{ code: '600519', cost: 10, qty: 1 }, { code: '600519', cost: 20, qty: 2 }], { code: '600519', cost: 30, qty: 3 });
eq(up3.length, 1, '原有重复记录在 upsert 时被顺手去重');
eq(up3[0].cost, 30, '去重后保留最新值');
eq(P.upsertHolding(HS, { code: 'bad' }).length, 2, '非法记录 → 原样返回副本，不写入');

/* ---------- removeHolding ---------- */
eq(P.removeHolding(HS, '600519').length, 1, 'removeHolding 删掉一条');
eq(P.removeHolding(HS, '600519')[0].code, '300750', '删掉的是指定那条');
eq(P.removeHolding(HS, '999999').length, 2, '删不存在的代码 → 不变');
eq(P.removeHolding(null, '600519').length, 0, 'removeHolding(null, ...) → 空数组');
eq(HS.length, 2, 'removeHolding 不改原数组');

/* ---------- holdingsWithFlag ---------- */
const fl = P.holdingsWithFlag(
  [{ code: '600519', cost: 1620, qty: 100 }, { code: '600036', cost: 28, qty: 2000 }, { code: 'bad' }],
  [{ code: '600519' }, { code: '300750' }]
);
eq(fl.length, 2, 'holdingsWithFlag 只输出有效持仓');
eq(fl[0].monitored, true, '600519 同时在监控清单 → monitored true');
eq(fl[1].monitored, false, '600036 只持有、未监控 → monitored false');
eq(fl[0].holding.cost, 1620, '同时带回规范化后的持仓对象');
eq(P.holdingsWithFlag(null, null).length, 0, '两个入参为空 → []');

/* ---------- monitoredWithoutHolding ---------- */
const mw = P.monitoredWithoutHolding(
  [{ code: '600519' }, { code: '300750' }, { code: '600733' }],
  [{ code: '600519', cost: 1620, qty: 100 }, { code: '999999', cost: 1, qty: 1 }]
);
eq(mw.length, 2, '监控 3 只、已持有 1 只 → 还差 2 只没记持仓');
eq(mw[0].code, '300750', '输出顺序沿用监控清单顺序');
eq(mw[1].code, '600733', '第二只也正确');
eq(P.monitoredWithoutHolding([{ code: '600519' }], [{ code: '600519', cost: 1620, qty: 100 }]).length, 0, '全部已记持仓 → 空列表（界面据此隐藏"快速添加"）');
eq(P.monitoredWithoutHolding([{ code: '600519' }], [{ code: '600519', cost: 0, qty: 100 }]).length, 0, '★ 同代码、哪怕成本为 0 → 也算已记持仓（2026-09-20 新口径）');

/* ---------- migrateLegacy ---------- */
const legacy = [
  { code: '002415', name: '海康威视', condition: 'lte', target: 31, cost: 30, qty: 1000, addedAt: '2026-08-21' },
  { code: '300750', name: '宁德时代', condition: 'gte', target: 200, addedAt: '2026-09-10' }
];
const mg = P.migrateLegacy(legacy, []);
eq(mg.changed, true, '老结构 → changed 为 true（界面据此决定要不要落盘）');
eq('cost' in mg.stocks[0], false, '迁移后股票上不再有 cost');
eq('qty' in mg.stocks[0], false, '迁移后股票上不再有 qty');
eq(mg.stocks[0].code, '002415', '迁移保留了股票其它字段');
eq(mg.stocks[0].target, 31, '迁移保留 target');
eq(mg.holdings.length, 1, '成本/股数被搬进 holdings');
eq(mg.holdings[0].cost, 30, '迁移后的成本正确');
eq(mg.holdings[0].qty, 1000, '迁移后的股数正确');
eq(mg.holdings[0].name, '海康威视', '迁移带上名称');
eq(legacy[0].cost, 30, 'migrateLegacy 不改原数组（纯函数）');

const mg2 = P.migrateLegacy(mg.stocks, mg.holdings);
eq(mg2.changed, false, '再迁一次 → changed 为 false（幂等，不会产生噪音提交）');
eq(mg2.holdings.length, 1, '幂等：不会重复添加持仓');
eq(JSON.stringify(mg2.stocks), JSON.stringify(mg.stocks), '幂等：stocks 完全一致');

const mg3 = P.migrateLegacy(
  [{ code: '600519', name: '贵州茅台', condition: 'gte', target: 1600, cost: 9999, qty: 1 }],
  [{ code: '600519', name: '贵州茅台', cost: 1620, qty: 100 }]
);
eq(mg3.holdings.length, 1, '已有持仓时迁移不会覆盖成旧值');
eq(mg3.holdings[0].cost, 1620, 'holdings 里的记录优先（用户手改过的更可信）');
eq(mg3.changed, true, '但股票上的残留字段仍会被摘掉，故 changed 为 true');

eq(P.migrateLegacy(null, null).changed, false, '空入参 → changed false，不抛异常');
eq(P.migrateLegacy(null, null).holdings.length, 0, '空入参 → holdings 为空数组');

/* ---------------- 注入一致性：console.html 里的那份必须与云端文件逐字一致 ---------------- */
const B = '/* ==== POSITION-CORE-BEGIN ==== */', E = '/* ==== POSITION-CORE-END ==== */';
const html = fs.readFileSync('D:/mywork/stock-alert-console/console.html', 'utf8');
const i = html.indexOf(B), j = html.indexOf(E);
ok(i >= 0 && j > i, 'console.html 含 POSITION-CORE 标记对');
if (i >= 0 && j > i) {
  const inner = html.slice(i + B.length, j).trim();
  const core = fs.readFileSync('D:/mywork/stock-alert-cloud/position-core.js', 'utf8').trim();
  eq(inner, core, '注入块内容与 position-core.js 逐字一致');
}
eq((html.match(/POSITION-CORE-BEGIN/g) || []).length, 1, 'BEGIN 标记只有一个');
eq((html.match(/POSITION-CORE-END/g) || []).length, 1, 'END 标记只有一个');

/* ---------------- 汇总输出 ---------------- */
console.log('position-core 单元测试：' + pass + ' 通过 / ' + fail + ' 失败');
if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  ✗ ' + f)); process.exit(1); }
console.log('ALL GREEN');
