/* Phase 4 · 独立攻击测试（评审官严过审自写，不复用改造者 console-picker.js）
 * 运行： "C:\Users\29086\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" D:\mywork\_tests\phase4-attack.js
 * 目标：从 SR-LOGIC 标记块与流程代码中抽取真实函数，攻击改造者未覆盖的边界。
 */
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');

var NODE = process.execPath;
var FILE = 'D:/mywork/stock-alert-console/console.html';
var html = fs.readFileSync(FILE, 'utf8');

var PASS = 0, FAIL = 0, WARN = 0;
var failures = [], warnings = [];
function ok(cond, msg){ if(cond){ PASS++; } else { FAIL++; failures.push(msg); console.log('  FAIL  ' + msg); } }
function warn(cond, msg){ if(cond){ PASS++; } else { WARN++; warnings.push(msg); console.log('  WARN  ' + msg); } }
function section(t){ console.log('\n== ' + t + ' =='); }
function pad2(n){ return (n < 10 ? '0' : '') + n; }

/* ---------- 抽取真实函数 ---------- */
function between(src, a, b){
  var i = src.indexOf(a); if(i < 0) return '';
  var j = src.indexOf(b, i + a.length); if(j < 0) return src.slice(i);
  return src.slice(i, j);
}
var logicBlock = between(html, '/* ==== SR-LOGIC-BEGIN ==== */', '/* ==== SR-LOGIC-END ==== */');
var inputFns   = between(html, 'function srInputMode(q)', 'async function srFetchItems');
var selFn      = between(html, 'function srSelCardHtml(st, others)', 'function srRowHtml(');
var escMock = "function esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\\\"/g,'&quot;') }\n";
/* ★ 2026-09-17：选中卡现在会带「监控中 / 持仓中」小标，而那两个标要看两份清单
   （cfg.stocks / cfg.holdings）—— 那是浏览器侧的状态，抽测环境里没有。
   这里给个空实现的桩，抽测仍可独立跑。 */
var stateMock = "function addTagsHtml(){ return '' }\n";
var modSrc = escMock + stateMock + logicBlock + '\n' + inputFns + '\n' + selFn + '\n';
var mod;
try {
  mod = new Function(modSrc +
    'return {srNameOf:srNameOf,srCodeOf:srCodeOf,srNormName:srNormName,srIsA:srIsA,srMarketLabel:srMarketLabel,' +
    'srCategory:srCategory,srRank:srRank,srSuggest:srSuggest,srBranch:srBranch,' +
    'srNormQuery:srNormQuery,srInputMode:srInputMode,srSearchUrl:srSearchUrl,srSelCardHtml:srSelCardHtml};')();
} catch(e){ console.log('模块抽取失败: ' + e.message); process.exit(2); }

function A(code, name, type, cls, mkt){ return { Code:code, Name:name, SecurityTypeName:(type || '沪A'), Classify:(cls || 'AStock'), MktNum:(mkt || '1') }; }

/* ============================================================
 * A. 逻辑攻击面
 * ============================================================ */
section('A1. SecurityTypeName 缺失但 Classify===AStock');
var rA1 = mod.srIsA({ Code:'600519', Classify:'AStock' });
console.log('  · 实际返回 srIsA(Classify=AStock, 无 SecurityTypeName) = ' + rA1);
ok(rA1 === true, 'A1 无 SecurityTypeName + Classify=AStock → true（A4 兜底分支已实现，由 warn 收紧为 ok）');
ok(mod.srIsA({ Code:'200011', Name:'深物业B', SecurityTypeName:'深B', Classify:'BStock', MktNum:'0' }) === false, 'A1b 深B + BStock（MktNum 与深市 A 股相同）→ 必须仍被挡住');
ok(mod.srIsA({ Code:'751240', Name:'平安银行', SecurityTypeName:'债券', Classify:'Bond', MktNum:'1' }) === false, 'A1c 债券 → 必须仍被挡住');
ok(mod.srIsA({ Code:'920185', Name:'贝特瑞', SecurityTypeName:'京A', Classify:'NEEQ', MktNum:'0' }) === true, 'A1d 北交所（京A/NEEQ）→ 必须收下');
ok(mod.srIsA(null) === false && mod.srIsA({}) === false, 'A1e null / 空对象 → false，不抛异常');

section('A2. Name 缺失 / null / 数字');
var threw2 = false;
try {
  mod.srNameOf({}); mod.srNameOf({ Name:null }); mod.srNameOf({ Name:0 }); mod.srNameOf({ Name:12345 });
  mod.srNormName(mod.srNameOf({ Name:null }));
  mod.srBranch([{ Code:'600519' }, { Name:null }, {}], 'x', 20);
  mod.srRank([{ Name:null }, {}], 'x');
} catch(e){ threw2 = true; console.log('  THROW: ' + e.stack); }
ok(!threw2, 'A2 Name 缺失/null/数字 → 不抛异常');
ok(mod.srNameOf({ Name:12345 }) === '12345', 'A2 Name=数字 12345 → srNameOf 返回 "12345"（已 String 化）');
ok(mod.srNameOf({}) === '' && mod.srNameOf({ Name:null }) === '', 'A2 Name 缺失/null → 返回空串');

section('A3. Code 为数字类型（非字符串）');
ok(mod.srCodeOf({ Code:600519 }) === '600519', 'A3 srCodeOf(Code=number 600519) → "600519"');
ok(mod.srMarketLabel({ Code:600519 }) === '沪市', 'A3 Code=number 600519（无 Type）→ 沪市');
ok(mod.srMarketLabel({ Code:830799 }) === '北交所', 'A3 Code=number 830799 → 北交所');
var rA3 = mod.srBranch([{ Code:600519, Name:'贵州茅台', SecurityTypeName:'沪A', Classify:'AStock' }], '贵州茅台', 20);
ok(rA3.branch === 'unique' && mod.srCodeOf(rA3.aStocks[0]) === '600519', 'A3 Code 数字型 600519 → unique 且 code 字符串化');
var rA3c = mod.srBranch([{ Code:300750, Name:'宁德时代', SecurityTypeName:'深A', Classify:'AStock' }, { Code:688981, Name:'中芯国际', SecurityTypeName:'沪A', Classify:'AStock' }], '科技', 20);
ok(rA3c.aStocks.length === 2 && rA3c.aStocks.every(function(s){ return /^\d{6}$/.test(mod.srCodeOf(s)); }) && mod.srMarketLabel(rA3c.aStocks[0]) === '深市', 'A3 多条数字型 Code → aStocks 可字符串化且市场标签正确（300750→深市）');
// 附带证据：仅缺 SecurityTypeName 的条目，A4 兜底后已按 A 股收下
var rA3b = mod.srBranch([{ Code:600519, Name:'贵州茅台', Classify:'AStock' }], '贵州茅台', 20);
console.log('  · 仅带 Classify=AStock、无 SecurityTypeName 的条目 → branch=' + rA3b.branch + '，aCount=' + rA3b.aCount + '（A4 兜底后已收为 A 股）');
ok(rA3b.branch === 'unique', 'A3/A4 仅带 Classify=AStock 的条目 → 计入 A 股并命中 unique');

section('A4. 各市场代码段标签');
[['600519','沪市'],['688981','沪市'],['601318','沪市'],['300750','深市'],['002415','深市'],['000001','深市'],['920185','北交所'],['830799','北交所'],['835688','北交所']].forEach(function(c){
  ok(mod.srMarketLabel({ Code:c[0] }) === c[1], 'A4 ' + c[0] + ' → ' + c[1] + '（实测 ' + mod.srMarketLabel({ Code:c[0] }) + '）');
});
ok(mod.srMarketLabel({ Code:'920185', SecurityTypeName:'京A' }) === '北交所', 'A4 京A → 北交所');
ok(mod.srMarketLabel({ Code:'688981', SecurityTypeName:'沪A' }) === '沪市', 'A4 科创 688（沪A）→ 沪市');

section('A5. srRank 稳定性');
var stabList = [A('600519','贵州茅台'), A('000001','平安银行'), A('601318','中国平安'), A('300750','宁德时代')];
var s1 = mod.srRank(stabList,'平安').map(function(x){ return x.Code }).join(',');
var s2 = mod.srRank(stabList,'平安').map(function(x){ return x.Code }).join(',');
var s3 = mod.srRank(stabList,'平安').map(function(x){ return x.Code }).join(',');
ok(s1 === s2 && s2 === s3, 'A5 srRank 连跑 3 次结果一致（稳定）: ' + s1);
ok(s1 === '000001,601318,600519,300750', 'A5 前缀「平安银行」排在包含「中国平安」之前: ' + s1);
var sameL = [A('000003','平安银行'), A('000001','平安银行'), A('000002','平安银行')];
ok(mod.srRank(sameL,'平安银行').map(function(x){ return x.Code }).join(',') === '000003,000001,000002', 'A5 同名同级保持接口原序（不被重排）');

section('A6. srBranch 截断判断边界');
function mkN(n, aCount){
  var arr = [];
  for(var i = 0; i < n; i++){
    if(i < aCount) arr.push(A('6' + pad2(i) + '00' + pad2(i % 100), '股票' + pad2(i)));
    else arr.push({ Code:'H' + i, Name:'非A' + pad2(i), SecurityTypeName:'港股', Classify:'HK', MktNum:'116' });
  }
  return arr;
}
ok(mkN(20,5).length === 20, 'A6 样本构造 20 条');
ok(mod.srBranch(mkN(20,5),'股票',20).truncated === true, 'A6 count=20 且返回恰好 20 条（A≥2）→ truncated=true');
ok(mod.srBranch(mkN(19,5),'股票',20).truncated === false, 'A6 返回 19 条 → truncated=false');
ok(mod.srBranch(mkN(20,1),'股票',20).truncated === false, 'A6 返回 20 条但 A 股=1 → truncated=false');
var many = []; for(var mi = 0; mi < 15; mi++) many.push(A('6' + pad2(mi) + '0000', '银行' + pad2(mi)));
var rMany = mod.srBranch(many, '银行', 20);
ok(rMany.aStocks.length === 8, 'A6 候选列表上限 8 条: ' + rMany.aStocks.length);
ok(rMany.aCount === 15, 'A6 aCount 保留总数 15: ' + rMany.aCount);

section('A7. 首尾空格 trim');
ok(mod.srNormName(' 贵州茅台 ') === '贵州茅台', 'A7 srNormName 首尾空格被 trim');
var rA7 = mod.srRank([A('601318','中国平安'), A('000001','平安银行')], ' 平安 ');
ok(rA7[0].Name === '平安银行', 'A7 srRank 输入带空格仍正确排序（trim 后前缀匹配）');
var rA7b = mod.srBranch([A('000001','平安银行'), A('601318','中国平安')], ' 平安 ', 20);
ok(rA7b.aStocks[0].Name === '平安银行', 'A7 srBranch 输入带空格正常工作');

section('A8. 全角数字 / 全角字母');
console.log('  · srInputMode("６００５１９") = ' + mod.srInputMode('６００５１９'));
console.log('  · srInputMode("ｇｚｍｔ") = ' + mod.srInputMode('ｇｚｍｔ'));
ok(mod.srInputMode('600519') === 'code', 'A8 半角 6 位数字 → code');
ok(mod.srInputMode('123') === 'shortcode', 'A8 半角 3 位数字 → shortcode');
ok(mod.srInputMode('') === 'empty', 'A8 空串 → empty');
ok(mod.srInputMode('贵州茅台') === 'keyword', 'A8 中文 → keyword');
ok(mod.srNormQuery('６００５１９') === '600519', 'A8 全角数字 → 归一为半角 600519');
ok(mod.srInputMode(mod.srNormQuery('６００５１９')) === 'code', 'A8 全角 6 位数字经归一路径 → 判为 code 模式');
ok(mod.srNormQuery('ｇｚｍｔ') === 'gzmt', 'A8 全角字母 → 归一为半角 gzmt');
ok(mod.srInputMode(mod.srNormQuery('ｇｚｍｔ')) === 'keyword', 'A8 归一后仍为 keyword（不误判为代码）');
ok(mod.srNormQuery('贵州茅台') === '贵州茅台', 'A8 中文不受归一影响');

section('A9. 超长输入 / 特殊字符注入 URL');
var longQ = new Array(1001).join('x');
var t0 = Date.now();
mod.srNormName(longQ); mod.srRank([A('600519','贵州茅台')], longQ); mod.srBranch([A('600519','贵州茅台')], longQ, 20);
var dt = Date.now() - t0;
ok(true, 'A9 1000 字输入不崩，耗时 ' + dt + 'ms');
ok(dt < 200, 'A9 1000 字输入性能正常（<200ms，实测 ' + dt + 'ms）');
var urlLong = mod.srSearchUrl(longQ);
ok(urlLong.length > 1000 && urlLong.indexOf('count=20') > -1, 'A9 srSearchUrl 对长输入仍生成 URL 且含 count=20（长度 ' + urlLong.length + '）');
ok(mod.srSearchUrl('平安&x=1').indexOf('平安&x=1') === -1, 'A9 srSearchUrl 对 & 做 encodeURIComponent（防参数注入）');

/* ============================================================
 * B. 真实数据回归（依据 recon-api-facts.md）
 * ============================================================ */
section('B1. 平安银行 → 1 条深A + 4 条同名债券');
var pyBank = [
  { Code:'000001', Name:'平安银行', SecurityTypeName:'深A', Classify:'AStock', MktNum:'0' },
  { Code:'751240', Name:'平安银行', SecurityTypeName:'债券', Classify:'Bond', MktNum:'1' },
  { Code:'112812', Name:'平安银行', SecurityTypeName:'债券', Classify:'Bond', MktNum:'1' },
  { Code:'155123', Name:'平安银行', SecurityTypeName:'债券', Classify:'Bond', MktNum:'1' },
  { Code:'163287', Name:'平安银行', SecurityTypeName:'债券', Classify:'Bond', MktNum:'1' }
];
var rB1 = mod.srBranch(pyBank, '平安银行', 20);
ok(rB1.branch === 'unique', 'B1 平安银行 → unique（唯一命中）: ' + rB1.branch);
ok(rB1.aCount === 1 && rB1.aStocks.length === 1, 'B1 平安银行 → 仅 1 条 A 股');
ok(rB1.others.length === 4, 'B1 平安银行 → 4 条非 A 股进折叠: others=' + rB1.others.length);
var selB1 = mod.srSelCardHtml(rB1.aStocks[0], rB1.others);
ok(selB1.indexOf('已忽略 4 条') > -1, 'B1 已选中卡文案数字为 4：「已忽略 4 条…」');
ok(selB1.indexOf('000001') > -1 && selB1.indexOf('深市') > -1, 'B1 已选中卡含代码 000001 与「深市」');

section('B2. 平安 → 12 条混杂，只列 A 股、非 A 股折叠');
var pingan = [
  A('000001','平安银行','深A','AStock','0'),
  A('601318','中国平安','沪A','AStock','1'),
  { Code:'835688', Name:'平安环保', SecurityTypeName:'三板', Classify:'NEEQ', MktNum:'0' },
  { Code:'01833', Name:'平安好医生', SecurityTypeName:'港股', Classify:'HK', MktNum:'116' },
  { Code:'02318', Name:'中国平安', SecurityTypeName:'港股', Classify:'HK', MktNum:'116' },
  { Code:'PAA', Name:'平安', SecurityTypeName:'美股', Classify:'UsStock', MktNum:'105' },
  { Code:'2318', Name:'中国平安', SecurityTypeName:'日股', Classify:'JP', MktNum:'200' },
  { Code:'751240', Name:'平安银行', SecurityTypeName:'债券', Classify:'Bond', MktNum:'1' },
  { Code:'155123', Name:'平安银行', SecurityTypeName:'债券', Classify:'Bond', MktNum:'1' },
  { Code:'163287', Name:'平安银行', SecurityTypeName:'债券', Classify:'Bond', MktNum:'1' },
  { Code:'112812', Name:'平安银行', SecurityTypeName:'债券', Classify:'Bond', MktNum:'1' },
  { Code:'BK0475', Name:'平安板块', SecurityTypeName:'板块', Classify:'BK', MktNum:'90' }
];
ok(pingan.length === 12, 'B2 样本 12 条');
var rB2 = mod.srBranch(pingan, '平安', 20);
ok(rB2.aCount === 2 && rB2.aStocks.length === 2, 'B2 平安 → 主列表只 2 条 A 股: ' + rB2.aCount);
ok(rB2.aStocks.every(function(s){ return mod.srIsA(s); }), 'B2 平安 → 主列表每一项都是 A 股（无污染）');
ok(rB2.others.length === 10, 'B2 平安 → 10 条非 A 股进折叠: ' + rB2.others.length);
ok(rB2.branch === 'too-broad' || rB2.branch === 'same-name', 'B2 平安 → 分支 same-name/too-broad: ' + rB2.branch);

section('B3. 腾讯控股 → 10 条全非 A 股');
var tx = [];
for(var ti = 0; ti < 10; ti++) tx.push({ Code:'0070' + ti, Name:'腾讯控股' + ti, SecurityTypeName:'港股', Classify:'HK', MktNum:'116' });
var rB3 = mod.srBranch(tx, '腾讯控股', 20);
ok(rB3.branch === 'not-a-stock', 'B3 腾讯控股 → not-a-stock（品类提示，绝不等于「没搜到」）: ' + rB3.branch);
ok(rB3.aCount === 0 && rB3.others.length === 10, 'B3 腾讯控股 → 0 A 股 / 10 非 A');
ok(mod.srCategory({ SecurityTypeName:'港股', Classify:'HK' }) === '港股', 'B3 srCategory 港股 → 港股');
ok(mod.srCategory({ SecurityTypeName:'美股', Classify:'UsStock' }) === '美股', 'B3 srCategory 美股 → 美股');
ok(mod.srCategory({ SecurityTypeName:'债券', Classify:'Bond' }) === '债券', 'B3 srCategory 债券 → 债券');

section('B4. 中国 且 返回数 == count → 截断提示');
var cn = [];
var cnNames = ['中国平安','中国人寿','中国石油','中国石化','中国联通','中国建筑','中国神华','中国中免'];
for(var ci = 0; ci < 8; ci++) cn.push(A('60130' + ci, cnNames[ci]));
for(var cj = 0; cj < 12; cj++) cn.push({ Code:'H' + cj, Name:'中国港股' + cj, SecurityTypeName:'港股', Classify:'HK', MktNum:'116' });
ok(cn.length === 20, 'B4 样本 20 条（== 请求上限）');
var rB4 = mod.srBranch(cn, '中国', 20);
ok(rB4.truncated === true, 'B4 中国 返回==count → truncated=true（会显示「结果可能有遗漏」）');
ok(rB4.aCount === 8, 'B4 中国 → 8 条 A 股');
ok(rB4.suggestions.length >= 1, 'B4 中国 → 生成建议词: ' + JSON.stringify(rB4.suggestions));
console.log('  · 建议词（中国）: ' + JSON.stringify(rB4.suggestions));
var ptSugg = mod.srSuggest([A('000001','平安银行'), A('601318','中国平安')], '平安');
console.log('  · 建议词（平安）: ' + JSON.stringify(ptSugg));
ok(ptSugg.indexOf('中国平安') > -1, 'B4b 建议词返回完整候选名「中国平安」（不再是剥前缀后的后缀）');
ok(rB4.suggestions.indexOf('中国平安') > -1, 'B4c 输入「中国」→ 建议词含完整名「中国平安」');
ok(rB4.suggestions.indexOf('平安') === -1, 'B4d 建议词不含裸后缀「平安」（旧行为，会导致越搜越宽）');

/* ============================================================
 * C. 静态与结构
 * ============================================================ */
section('C1. 内联脚本语法（node --check）');
var re = /<script>([\s\S]*?)<\/script>/g, m, scripts = [];
while((m = re.exec(html))) scripts.push(m[1]);
ok(scripts.length >= 1, 'C1 内联 <script> 数量 = ' + scripts.length);
var syntaxOk = true;
for(var si = 0; si < scripts.length; si++){
  var tmp = path.join(os.tmpdir(), 'p4-script-' + si + '-' + Date.now() + '.js');
  fs.writeFileSync(tmp, scripts[si]);
  var res = cp.spawnSync(NODE, ['--check', tmp], { encoding:'utf8' });
  if(res.status !== 0){ syntaxOk = false; console.log('  node --check 失败: ' + (res.stderr || '')); }
  try { fs.unlinkSync(tmp); } catch(e){}
}
ok(syntaxOk, 'C1 node --check 全部内联脚本语法通过');

section('C2. 既有 ID 仍存在');
['fCode','fName','fCond','fTarget','condPreview','btnAddStock','btnLookup','fabAdd','list','archiveList','pgAdd','pgArchive','pgSetting','fQuery','btnSearch','btnClear','btnManual','srResult','srFallback'].forEach(function(id){
  ok(html.indexOf('id="' + id + '"') > -1, 'C2 既有/新增 ID 存在: #' + id);
});

section('C3. 既有函数仍存在且未被改写（签名 + 关键锚点）');
var protectedFns = ['renderActive','renderArchive','persist','toggleStock','delStock','restoreStock','purgeRecord','makeBackup','restoreFromPayload','checkHashForBackup','saveConfig','loadConfig','boot','demoCfg','secidOf','jsonp'];
protectedFns.forEach(function(fn){ ok(html.indexOf('function ' + fn + '(') > -1, 'C3 既有函数存在: ' + fn + '()'); });
var anchors = {
  renderActive:'bindCard(', renderArchive:'bindArchive(', persist:'saveConfig(G.cfg)', toggleStock:'st.enabled = (st.enabled === false)',
  delStock:'G.cfg.deleted.unshift', restoreStock:'G.cfg.stocks.push', purgeRecord:'G.cfg.deleted.splice',
  makeBackup:'AES-GCM', restoreFromPayload:'crypto.subtle.decrypt', checkHashForBackup:'restoreFromPayload(payload',
  saveConfig:"method:'PUT'", loadConfig:"'/config.json'", boot:'demoCfg()', demoCfg:'海康威视', secidOf:'/^6/.test', jsonp:'行情加载超时'
};
Object.keys(anchors).forEach(function(fn){
  ok(html.indexOf(anchors[fn]) > -1, 'C3 既有函数 ' + fn + ' 内部关键锚点仍在（未被清空/改写）: ' + anchors[fn]);
});

section('C4. 标签配对');
ok((html.match(/<style>/g) || []).length === (html.match(/<\/style>/g) || []).length, 'C4 <style> / </style> 配对');
ok((html.match(/<script>/g) || []).length === (html.match(/<\/script>/g) || []).length, 'C4 <script> / </script> 配对');

section('C5. 新增 .sr- 类：定义↔使用双向检查');
var cssBlock = between(html, '/* ===== 添加股票 · 搜索与候选', '</style>');
var defined = {}; var cre = /\.(sr-[a-zA-Z0-9-]+)/g, cm;
while((cm = cre.exec(cssBlock))) defined[cm[1]] = 1;
var definedList = Object.keys(defined);
ok(definedList.length >= 15, 'C5 新增 .sr- 类定义数 = ' + definedList.length);
definedList.forEach(function(cls){
  var tok = cls.replace(/-/g, '\\-');
  var total = (html.match(new RegExp(tok, 'g')) || []).length;
  var inCss = (cssBlock.match(new RegExp(tok, 'g')) || []).length;
  ok(total - inCss > 0, 'C5 新增类 .' + cls + ' 在 CSS 之外被真实使用（非死代码）');
});
var jsSrc = scripts[0] || '';
var used = {}; var ure = /\.?(sr-[a-zA-Z0-9-]+)/g, um;
while((um = ure.exec(jsSrc))) used[um[1]] = 1;
var undefinedUsed = Object.keys(used).filter(function(c){ return !defined[c]; });
var allowedHooks = ['sr-sel','sr-list','sr-cand'];
ok(undefinedUsed.every(function(c){ return allowedHooks.indexOf(c) > -1; }), 'C5 JS 引用但 CSS 未定义的 .sr- 类仅结构性 hook: [' + undefinedUsed.join(', ') + ']');
console.log('  · JS 引用但无 CSS 定义的 .sr- 类（应为 hook）: ' + (undefinedUsed.join(', ') || '（无）'));

section('C6. 微信兼容禁用项 + 输入框属性');
['?.','??','Intl',':has(','will-change','@media','var(--'].forEach(function(tok){
  var i = html.indexOf(tok);
  ok(i === -1, 'C6 禁用项未出现: ' + tok + (i > -1 ? '（偏移 ' + i + '）' : ''));
});
var fq = /<input[^>]*id="fQuery"[^>]*>/.exec(html);
ok(!!fq, 'C6 #fQuery 输入框存在');
ok(fq && fq[0].indexOf('inputmode') === -1, 'C6 中文搜索框 #fQuery 未设 inputmode（不限制中文输入法）');
ok(fq && fq[0].indexOf('type="search"') > -1, 'C6 #fQuery 使用 type="search"');
ok(fq && fq[0].indexOf('autocomplete="off"') > -1, 'C6 #fQuery autocomplete="off"');
var fc = /<input[^>]*id="fCode"[^>]*>/.exec(html);
ok(fc && fc[0].indexOf('inputmode="numeric"') > -1, 'C6 降级代码框 #fCode 保留 inputmode="numeric"（纯数字）');
/* ★ 2026-09-17 放宽：600 字重只允许出现在少数"标题/标签"处（.near-nm/.st/.bh 等），
   说明性文本一律 <=500 —— 原来的"全文禁 600"早已不成立（仪表盘标题一直用 600）。 */
ok(!/\.(hint|near-meta|sr-nm|sr-link|ev-line|add-st|cd-desc|pf-note)\{[^}]*font-weight:\s*(600|700|bold)/.test(html),
  'C6 说明性文本（hint / 说明行 / 股票名）不用 600+ 字重');

/* ============================================================
 * D. 交互路径复核（读代码）
 * ============================================================ */
section('D1. 加载态渲染时机');
var li = html.indexOf('box.innerHTML = srLoadingHtml()');
var ai = html.indexOf('await srFetchItems(q)');
ok(li > -1 && ai > -1 && li < ai, 'D1 加载态在 await 之前同步渲染（弱网有反馈）');

section('D2. 接口文本插入点 esc() 覆盖');
['esc(srNameOf(st))','esc(srCodeOf(st))','esc(srMarketLabel(st))','esc(srNameOf(others[i]))','esc(srCategory(others[i]))','esc(r.suggestions[s])','esc(srNameOf(first))','esc(srCategory(first))','esc(big)','esc(sub)'].forEach(function(s){
  ok(html.indexOf(s) > -1, 'D2 接口文本插入点已 esc: ' + s);
});
var rawIns = /\+ *(srNameOf|srCodeOf|srCategory|srMarketLabel)\s*\(/.exec(html);
warn(!rawIns, 'D2 未发现未转义的接口文本直接拼接' + (rawIns ? '（发现: ' + rawIns[0] + '）' : ''));
ok(html.indexOf('t.textContent = msg') > -1 && html.indexOf('e.textContent = m') > -1, 'D2 toast / showError 走 textContent（无 XSS 面）');

section('D3. 选中 → 回填 → 提交链路');
var ss = between(html, 'function srSelectStock(st)', 'function srChooseCandidate');
ok(ss.indexOf("$('fCode').value") > -1, 'D3 srSelectStock 回填 #fCode');
ok(ss.indexOf("$('fName').value") > -1, 'D3 srSelectStock 回填 #fName');
ok(ss.indexOf('updateCondPreview()') > -1, 'D3 srSelectStock 调用 updateCondPreview()');
ok(ss.indexOf('updateHPreview()') > -1, 'D3 ★ 统一添加页：选中时也刷「记持仓」面板的预览');
ok(ss.indexOf('addFormSync()') > -1, 'D3 ★ 选中时才把「用途 + 表单」展开出来');
ok(ss.indexOf('addStock') === -1 && ss.indexOf('persist(') === -1, 'D3 选中候选不自动提交（未调用 addStock/persist）');
var ad = between(html, 'async function addStock()', '/* ---------- 搜索流程');
ok(ad.indexOf('\\d{6}') > -1, 'D3 addStock 仍校验 6 位代码');
ok(ad.indexOf("toast(code ? ") > -1, 'D3 ★ 没选股票 / 代码不合法 → 两种文案分开提示');
ok(ad.indexOf('更新') > -1 && ad.indexOf('idx') > -1, 'D3 ★ 已在监控的走「更新」路径（统一添加页不再拦着不让改）');
ok(ad.indexOf('没有变化') > -1, 'D3 ★ 条件没变时不写盘（避免噪音提交）');
ok(ad.indexOf('addOkShow') > -1, 'D3 ★ 提交后给结果确认卡，而不是默默关页');

section('D4. 已在监控 / 已记持仓 / 已归档 的点击行为');
var sc = between(html, 'function srChooseCandidate(st)', 'function srToggleFold');
ok(sc.indexOf('srSelectStock(st)') > -1, 'D4 ★ 已在监控的候选照样能选中（要用它改条件 / 补记持仓）');
ok(sc.indexOf("dup === 'active'") === -1 || sc.indexOf("dup === 'active'") > sc.indexOf('srSelectStock(st)'),
  'D4 ★ 不再有「已在监控 → 拦住不让选」的分支');
ok(sc.indexOf("dup === 'deleted'") > -1, 'D4 已归档候选 → 轻提示（重新添加会新建一条）');
var rr = between(html, 'function srRenderResult(items, q, mode)', 'function srSelectStock');
ok(rr.indexOf("srDupState(st) === 'active'") === -1, 'D4 ★ 唯一命中且已监控 → 不再被拦（旧版的死路已拆掉）');
/* ⚠️ 只判旧 UI 的原句「已在监控列表里」。曾经用裸串 `已在监控` 判存在 ——
   srRenderResult 的注释里现在写着「旧版在这里拒绝选中 + 提示已在监控列表」，
   裸串会被注释误伤（本项目的老坑：短串判定必须精确到界面真实文案）。 */
ok(rr.indexOf('已在监控列表里') === -1, 'D4 ★ 结果区不再输出「这只股票已在监控列表里」的死路提示');

section('D5. 清除按钮 / 搜索按钮 状态');
var sf = between(html, 'function srSyncFields()', 'function srShowFallback');
ok(sf.indexOf('c.hidden = (q ===') > -1, 'D5 清除按钮在输入为空时 hidden');
ok(sf.indexOf('b.disabled = (q ===') > -1, 'D5 搜索按钮在输入为空时禁用');

section('D6. 降级通道显示条件');
var sfF = between(html, 'function srShowFallback(on)', 'function srLoadingHtml');
ok(sfF.indexOf('focus()') > -1, 'D6 降级通道展开时焦点跳到 #fCode');
ok(html.indexOf('srShowFallback(true)') > -1, 'D6 搜索失败/超时自动展开降级通道');
ok(html.indexOf("m.indexOf('超时')") > -1, 'D6 超时与失败文案分流');

section('D7. 规格 §3-A：目标价参考占位（自动带出现价）');
ok(html.indexOf('当前约 ') > -1, 'D7 选中后自动带出现价作目标价参考占位（规格 §3-A 已实现）');
ok(html.indexOf('function srFillPriceHint') > -1, 'D7 现价占位独立成函数（失败静默、不阻塞选中与提交）');
ok(html.indexOf('seq !== SR_PRICE_SEQ') > -1, 'D7 竞态保护：晚到的行情不得写回 placeholder');
ok(html.indexOf("tp.placeholder === '如 31.00'") > -1, 'D7 仅当 placeholder 仍为默认值时才覆盖');
ok(html.indexOf('catch(e){ /* 静默失败 */ }') > -1, 'D7 行情失败静默，不 toast');

section('D8. 建议词 chip 点击后的收窄效果');
var d8sugg = mod.srSuggest([A('601318','中国平安'), A('601628','中国人寿'), A('601857','中国石油')], '中国');
console.log('  · 建议词（中国）: ' + JSON.stringify(d8sugg));
ok(d8sugg.indexOf('中国平安') > -1, 'D8 建议词是完整候选名「中国平安」');
/* 真实接口返回：601318 沪A + 02318 港股 + 751264 债券（三只同名，过滤后只剩 1 只 A 股） */
var d8hit = mod.srBranch([A('601318','中国平安'), A('02318','中国平安','港股','HK','116'), A('751264','中国平安','债券','Bond','1')], '中国平安', 20);
console.log('  · 搜「中国平安」→ branch=' + d8hit.branch + '，A股 ' + d8hit.aCount + ' 只，非A ' + d8hit.others.length + ' 只');
ok(d8hit.branch === 'unique', 'D8 点建议词后单独搜索「中国平安」→ branch=unique（确实收窄，不再越搜越宽）');
var d8old = mod.srBranch([A('000001','平安银行'), A('601318','中国平安')], '平安', 20);
ok(d8old.branch === 'too-broad', 'D8 旧行为（搜裸后缀「平安」）仍是 too-broad —— 证明必须用完整名');

section('E1. Phase 4 第二批修复项');
ok(/\.sr-nm\{[^}]*text-overflow:ellipsis/.test(html), 'E1 .sr-nm 已加省略号（超长股票名不撑破窄屏）');
ok(/\.sr-chip\{[^}]*color:#5f6368/.test(html), 'E1 .sr-chip 文字色 #5f6368（对比度达 AA 4.5:1）');
ok(html.indexOf('srIsA(SR_ITEMS[i])') > -1, 'E1 srFindItem 已按 A 股过滤（同 code 并存非 A 时不再取错）');
ok(html.indexOf('function srNormQuery') > -1, 'E1 存在全角→半角归一函数');
ok(html.indexOf('srNormQuery(') > -1 && /srSearch[\s\S]{0,400}srNormQuery\(/.test(html), 'E1 搜索入口确实调用了归一');

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n================ 汇总 ================');
console.log('通过：' + PASS + '    失败：' + FAIL + '    警告：' + WARN);
if(FAIL){ console.log('\n失败项：'); failures.forEach(function(f){ console.log('  - ' + f); }); }
if(WARN){ console.log('\n警告项：'); warnings.forEach(function(f){ console.log('  - ' + f); }); }
console.log('\n结果：' + (FAIL ? 'FAILED' : 'ALL GREEN') + (WARN ? '（含 ' + WARN + ' 项警告）' : ''));
process.exit(FAIL ? 1 : 0);
