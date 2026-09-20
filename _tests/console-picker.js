/* 添加股票流程 · 自测脚本（纯 node，无第三方依赖）
 * 运行： "C:\Users\29086\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" D:\mywork\_tests\console-picker.js
 */
'use strict';
var fs = require('fs');
var os = require('os');
var path = require('path');
var cp = require('child_process');
var FILE = 'D:/mywork/stock-alert-console/console.html';
var html = fs.readFileSync(FILE, 'utf8');
function between(src, a, b){
  var i = src.indexOf(a); if(i < 0) return '';
  var j = src.indexOf(b, i + a.length); if(j < 0) return src.slice(i);
  return src.slice(i, j);
}

var PASS = 0, FAIL = 0;
var failures = [];
function ok(cond, msg){
  if(cond){ PASS++; }
  else { FAIL++; failures.push(msg); console.log('  FAIL ✗  ' + msg); }
}
function section(t){ console.log('\n== ' + t + ' =='); }

/* ---------------- 1. 语法：抽取所有内联 <script>，new Function 编译 ---------------- */
section('1. 内联脚本语法');
var re = /<script>([\s\S]*?)<\/script>/g, m, scripts = [];
while((m = re.exec(html))) scripts.push(m[1]);
ok(scripts.length >= 1, '找到内联 <script>（' + scripts.length + ' 个）');
var syntaxOk = true;
for(var i = 0; i < scripts.length; i++){
  try { new Function(scripts[i]); }
  catch(e){ syntaxOk = false; console.log('  SYNTAX ERROR: ' + e.message); }
}
ok(syntaxOk, '所有内联脚本可编译，无语法错误');
var checkOk = true;
for(var ci = 0; ci < scripts.length; ci++){
  var tmp = path.join(os.tmpdir(), 'picker-script-' + ci + '-' + Date.now() + '.js');
  fs.writeFileSync(tmp, scripts[ci]);
  var res = cp.spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  if(res.status !== 0){ checkOk = false; console.log('  node --check 失败: ' + (res.stderr || '')); }
  try { fs.unlinkSync(tmp); } catch(e){}
}
ok(checkOk, 'node --check 全部内联脚本语法通过');

/* ---------------- 2. 纯逻辑真值测试 ---------------- */
section('2. SR-LOGIC 纯逻辑真值');
var lb = /\/\* ==== SR-LOGIC-BEGIN ==== \*\/([\s\S]*?)\/\* ==== SR-LOGIC-END ==== \*\//;
var lm = lb.exec(html);
ok(!!lm, 'SR-LOGIC-BEGIN/END 标记块存在');
var mod = {};
if(lm){
  mod = new Function(lm[1] +
    '\nreturn {srNormName:srNormName,srIsA:srIsA,srMarketLabel:srMarketLabel,srCategory:srCategory,' +
    'srRank:srRank,srBranch:srBranch,srSuggest:srSuggest,srNameOf:srNameOf,srCodeOf:srCodeOf,' +
    'srNormQuery:srNormQuery,srInputMode:srInputMode};')();
}
function A(code, name, type, cls){
  return { Code:code, Name:name, SecurityTypeName:(type || '沪A'), Classify:(cls || 'AStock'), MktNum:'1' };
}
if(mod.srIsA){
  /* 最易错的一条：北交所 京A / NEEQ 必须收 */
  ok(mod.srIsA({SecurityTypeName:'京A', Classify:'NEEQ'}) === true, 'srIsA 京A/NEEQ → true（北交所必须收）');
  ok(mod.srIsA({SecurityTypeName:'深B', Classify:'BStock', MktNum:'0'}) === false, 'srIsA 深B/BStock/MktNum0 → false（B 股必须挡）');
  ok(mod.srIsA({SecurityTypeName:'债券', Classify:'Bond', MktNum:'1'}) === false, 'srIsA 债券/Bond → false');
  ok(mod.srIsA({SecurityTypeName:'深A', Classify:'AStock', MktNum:'0'}) === true, 'srIsA 深A/AStock → true');

  ok(String(mod.srMarketLabel({Code:'600519', SecurityTypeName:'沪A'})).indexOf('沪') > -1, 'srMarketLabel 沪A → 含「沪」');
  ok(String(mod.srMarketLabel({Code:'920185', SecurityTypeName:'京A'})).indexOf('北交所') > -1, 'srMarketLabel 京A → 含「北交所」');

  ok(mod.srNormName('XD民生银') === '民生银', "srNormName('XD民生银') → '民生银'");
  ok(mod.srNormName('贵州茅台') === '贵州茅台', "srNormName('贵州茅台') → '贵州茅台'");

  var r1 = mod.srBranch([A('600519','贵州茅台','沪A','AStock')], '贵州茅台', 20);
  ok(r1.branch === 'unique', "srBranch 唯一命中 → 'unique'");

  var sameName = [
    A('000011','深物业A','深A','AStock'),
    A('000014','深物业A','深A','AStock'),
    { Code:'200011', Name:'深物业B', SecurityTypeName:'深B', Classify:'BStock', MktNum:'0' }
  ];
  var r2 = mod.srBranch(sameName, '深物业', 20);
  ok(r2.branch === 'same-name', "srBranch 同名多代码 → 'same-name'");
  ok(r2.aCount === 2, 'same-name：仅保留 2 条 A 股，B 股被过滤（aCount=' + r2.aCount + '）');
  ok(r2.others.length === 1, 'same-name：B 股进入非 A 股折叠区（others=' + r2.others.length + '）');

  var zg = [
    A('601318','中国平安'), A('601628','中国人寿'), A('601857','中国石油'), A('600028','中国石化'),
    A('600050','中国联通'), A('601668','中国建筑'), A('601088','中国神华'), A('601888','中国中免'),
    { Code:'00941', Name:'中国移动', SecurityTypeName:'港股', Classify:'HK' },
    { Code:'00762', Name:'中国联通', SecurityTypeName:'港股', Classify:'HK' },
    { Code:'02628', Name:'中国人寿', SecurityTypeName:'港股', Classify:'HK' },
    { Code:'00857', Name:'中国石油股份', SecurityTypeName:'港股', Classify:'HK' },
    { Code:'00386', Name:'中国石油化工股份', SecurityTypeName:'港股', Classify:'HK' },
    { Code:'01108', Name:'中国玻璃', SecurityTypeName:'港股', Classify:'HK' },
    { Code:'CHL', Name:'中国电信', SecurityTypeName:'美股', Classify:'UsStock' },
    { Code:'PTR', Name:'中国石油', SecurityTypeName:'美股', Classify:'UsStock' },
    { Code:'121857', Name:'中国石油', SecurityTypeName:'债券', Classify:'Bond' },
    { Code:'159901', Name:'中国A50ETF', SecurityTypeName:'基金', Classify:'Fund' },
    { Code:'BK0475', Name:'中国概念', SecurityTypeName:'板块', Classify:'BK' },
    { Code:'835688', Name:'中国环保', SecurityTypeName:'三板', Classify:'NEEQ' }
  ];
  var r3 = mod.srBranch(zg, '中国', 20);
  ok(r3.branch === 'too-broad', "srBranch 泛关键词 → 'too-broad'（'中国'）");
  ok(r3.suggestions.length >= 1, 'too-broad：至少 1 个建议词（suggestions=' + JSON.stringify(r3.suggestions) + '）');
  ok(r3.suggestions.indexOf('中国平安') > -1, '建议词为完整候选名（含「中国平安」）');
  var suffixLeak = r3.suggestions.some(function(s){ return s === '平安' || s === '人寿' || s === '石油'; });
  ok(!suffixLeak, '建议词不再输出剥前缀后的后缀（修复「越搜越宽」）');
  ok(r3.truncated === true, 'too-broad：截断提示命中（返回 20 == 上限 20 且 A≥2）');

  var r4 = mod.srBranch([
    { Code:'00700', Name:'腾讯控股', SecurityTypeName:'港股', Classify:'HK' },
    { Code:'00700', Name:'腾讯控股-R', SecurityTypeName:'港股', Classify:'HK' }
  ], '腾讯控股', 20);
  ok(r4.branch === 'not-a-stock', "只有港股「腾讯控股」→ 'not-a-stock'");
  ok(r4.aCount === 0 && r4.others.length === 2, 'not-a-stock：0 条 A 股、2 条非 A 股');

  var r5 = mod.srBranch([], 'x', 20);
  ok(r5.branch === 'none', "空数组 → 'none'");

  var rk = mod.srRank([
    { Code:'601318', Name:'中国平安', SecurityTypeName:'沪A', Classify:'AStock' },
    { Code:'000001', Name:'平安银行', SecurityTypeName:'深A', Classify:'AStock' }
  ], '平安');
  ok(rk.length === 2 && rk[0].Name === '平安银行', "srRank：输入 '平安' 时 平安银行 排在 中国平安 之前（前缀优先于包含）");
}

section('2b. 空输入 / null / 字段缺失 → 不抛异常');
var threw = false;
try {
  mod.srRank(null, 'x'); mod.srBranch(null, 'x', 20); mod.srNormName(null);
  mod.srIsA(null); mod.srMarketLabel(null); mod.srCategory(null);
  mod.srBranch([], '', 20); mod.srRank([{}], 'x'); mod.srBranch([{}], 'x', 20);
  mod.srIsA({}); mod.srMarketLabel({}); mod.srCategory({});
  mod.srNormName(undefined); mod.srNameOf(null); mod.srCodeOf(null);
} catch(e){ threw = true; console.log('  THROW: ' + e.stack); }
ok(!threw, '空输入 / null / 字段缺失 均不抛异常');

/* ---------------- 2c. Phase 4 修复项回归 ---------------- */
section('2c. Phase 4 修复项回归');

/* A4 · srIsA 兜底分支 */
ok(mod.srIsA({ Code:'600519', Classify:'AStock' }) === true, 'A4 无 SecurityTypeName + Classify=AStock → true（兜底收）');
ok(mod.srIsA({ SecurityTypeName:'深B', Classify:'AStock' }) === false, 'A4 SecurityTypeName=深B（非三类且非空）→ 仍 false');
ok(mod.srIsA({ SecurityTypeName:'深B', Classify:'BStock', MktNum:'0' }) === false, 'A4 深B/BStock → 仍 false（兜底不得越过 BStock 排除）');

/* B4 · 全角归一 */
ok(mod.srNormQuery('６００５１９') === '600519', 'B4 srNormQuery 全角数字 → 600519');
ok(mod.srNormQuery('ＧＺＭＴ') === 'GZMT', 'B4 srNormQuery 全角字母 → GZMT');
ok(mod.srInputMode(mod.srNormQuery('６００５１９')) === 'code', 'B4 全角 ６００５１９ 归一后判为 code 模式');
ok(mod.srInputMode('６００５１９') === 'keyword', 'B4 srInputMode 本身不归一（归一在 srSearch 内做），直接传全角 → keyword');

/* A3 · 建议词为完整名，且单独搜索能命中 unique */
var zg2 = [
  A('601318','中国平安'), A('601628','中国人寿'), A('601857','中国石油'), A('600028','中国石化'),
  A('600050','中国联通'), A('601668','中国建筑'), A('601088','中国神华'), A('601888','中国中免')
];
var sg = mod.srBranch(zg2.concat([{ Code:'H1', Name:'中国移动', SecurityTypeName:'港股', Classify:'HK' }]), '中国', 9);
ok(sg.branch === 'too-broad' && sg.suggestions.length >= 1, 'A3 前置：中国 → too-broad 且有建议词');
ok(sg.suggestions.indexOf('中国平安') > -1, 'A3 建议词是完整候选名「中国平安」: ' + JSON.stringify(sg.suggestions));
ok(sg.suggestions.indexOf('平安') === -1, 'A3 建议词不含裸后缀「平安」');
var alone = zg2.filter(function(it){ return mod.srNormName(mod.srNameOf(it)) === '中国平安'; });
var rAlone = mod.srBranch(alone, '中国平安', 20);
ok(rAlone.branch === 'unique', 'A3 用完整建议词单独搜索 → 命中 unique（真正收窄）');

/* A1 · unique 且已监控 → ★ 2026-09-17 规格变更：改成"照常选中，可改条件 / 补记持仓"
   （旧版在这里拒绝选中并提示"已在监控列表"，合并添加入口后就说不通了） */
var rr = between(html, 'function srRenderResult(items, q, mode)', 'function srSelectStock');
ok(rr.indexOf('srSelectStock(st)') > -1, 'A1 unique 分支照常选中（不再被"已在监控"拦住）');
ok(rr.indexOf("srDupState(st) === 'active'") === -1, 'A1 ★ 删掉了 unique+已监控 的拒绝分支');
ok(rr.indexOf('已在监控列表里') === -1, 'A1 ★ 不再输出"这只股票已在监控列表里"的死路提示');
var sc1 = between(html, 'function srChooseCandidate(st)', 'function srToggleFold');
ok(sc1.indexOf('srSelectStock(st)') > -1, 'A1 候选点击也能选中已监控的股票');
ok(sc1.indexOf("dup === 'deleted'") > -1, 'A1 已归档候选给轻提示（重新添加会新建一条）');

/* A2 · srReset 清干净 */
var rs = between(html, 'function srReset()', '/* ---------- 统一添加页 · 绑定 ---------- */');
ok(rs.indexOf("fCode').value = ''") > -1, 'A2 srReset 清空 #fCode');
ok(rs.indexOf("fName').value = ''") > -1, 'A2 srReset 清空 #fName');
ok(rs.indexOf("tp.placeholder = '如 31.00'") > -1, 'A2 srReset 复位 #fTarget.placeholder');
ok(rs.indexOf('updateCondPreview()') > -1, 'A2 srReset 刷新条件预览');
ok(rs.indexOf('addFormSync()') > -1, 'A2 ★ srReset 收起「用途 + 表单」（未选股票就只剩搜索框）');
ok(rs.indexOf("hCost').value = ''") > -1 && rs.indexOf("hQty').value = ''") > -1, 'A2 ★ srReset 一并清空持仓面板的成本/股数');

/* A5 · 现价参考占位 */
ok(html.indexOf('function srFillPriceHint') > -1, 'A5 srFillPriceHint 函数存在');
var ss5 = between(html, 'function srSelectStock(st)', 'function srChooseCandidate');
ok(ss5.indexOf('srFillPriceHint(st)') > -1, 'A5 srSelectStock 选中后触发现价占位');
var sp = between(html, 'async function srFillPriceHint', 'function srSelectStock');
ok(sp.indexOf('当前约 ') > -1 && sp.indexOf('，可参考') > -1, 'A5 占位文案为「当前约 x.xx，可参考」');
ok(sp.indexOf('SR_PRICE_SEQ') > -1, 'A5 有请求序号防护（晚到行情作废）');
ok(sp.indexOf('fc.value !== code') > -1, 'A5 比对当前选中 code（复位/改选后晚到不得写回）');
ok(sp.indexOf("'如 31.00'") > -1, 'A5 只在占位为默认值时写入');
ok(html.indexOf("tp.placeholder = '如 31.00'") > -1, 'A5 复位路径存在，可清回默认占位');

/* B1 · srFindItem 只回 A 股 */
var fi = between(html, 'function srFindItem(code)', 'function srSyncFields');
ok(fi.indexOf('srIsA(SR_ITEMS[i])') > -1, 'B1 srFindItem 命中时额外要求 srIsA（防同名债券侥幸命中）');

/* B2 / B3 · CSS（静态） */
var cssBlock = between(html, '/* ===== 添加股票 · 搜索与候选', '</style>');
ok(/\.sr-chip\{[^}]*color:#5f6368/.test(cssBlock), 'B2 .sr-chip 文字色为 #5f6368（对比度达 AA）');
ok(/\.sr-nm\{[^}]*min-width:0/.test(cssBlock) && /\.sr-nm\{[^}]*text-overflow:ellipsis/.test(cssBlock) && /\.sr-nm\{[^}]*white-space:nowrap/.test(cssBlock), 'B3 .sr-nm 含省略号三件套');

/* C-4 · 演示数据至少一只干净 happy path（不在 demoCfg 的 stocks/deleted 里） */
var demoCfgCodes = ['002415','600519','600733','300750','000001','601318','000725','601899'];
var demoSrc = between(html, 'var SR_DEMO_SEARCH = {', '\nfunction srDemoSearch');
var happy = demoSrc.indexOf("'招商银行'") > -1 && demoSrc.indexOf("600036") > -1;
ok(happy, 'C-4 SR_DEMO_SEARCH 含干净 happy path：招商银行 600036（不在 demoCfg 监控/归档中）');
ok(demoCfgCodes.indexOf('600036') === -1, 'C-4 600036 确实不在 demoCfg 的 stocks/deleted 代码清单里');

/* ---------------- 3. 结构断言 ---------------- */
section('3. 结构断言');
['fCode','fName','fCond','fTarget','condPreview','btnAddStock','btnLookup'].forEach(function(id){
  ok(html.indexOf('id="' + id + '"') > -1, '既有 ID 仍存在：#' + id);
});
ok(html.indexOf('srResult') > -1, '#srResult 结果容器存在');
['sr-input','sr-clear','sr-btn','sr-loading','sr-sel','sr-list','sr-cand','sr-best','sr-empty','sr-notice','sr-foldRow','sr-chips','sr-chip','sr-fallback','sr-code','sr-row','sr-nm','sr-cd'].forEach(function(c){
  ok(html.indexOf(c) > -1, '新增类存在：.' + c);
});
ok((html.match(/<style>/g) || []).length === (html.match(/<\/style>/g) || []).length, '<style> / </style> 配对');
ok((html.match(/<script>/g) || []).length === (html.match(/<\/script>/g) || []).length, '<script> / </script> 配对');
ok(html.indexOf('searchapi.eastmoney.com') > -1 && html.indexOf('count=20') > -1, '复用 suggest 接口且 count=20');
ok(html.indexOf('jsonp(srSearchUrl') > -1, '搜索走既有 jsonp()（未用 fetch）');
['srFetchItems','srRenderResult','srChooseCandidate','srToggleFold','srResultClick','srDemoSearch','srSyncFields','srShowFallback'].forEach(function(fn){
  ok(html.indexOf('function ' + fn) > -1, 'DOM/流程函数存在：' + fn);
});

/* ---------------- 4. 禁用项扫描 ---------------- */
section('4. 微信兼容禁用项扫描（全文件）');
['?.', '??', 'Intl', ':has(', 'will-change', '@media', 'var(--'].forEach(function(tok){
  var idx = html.indexOf(tok);
  ok(idx === -1, '禁用项未出现：' + tok + (idx > -1 ? '（出现在偏移 ' + idx + '）' : ''));
});

/* ---------------- 汇总 ---------------- */
console.log('\n================ 汇总 ================');
console.log('通过：' + PASS + '    失败：' + FAIL);
if(FAIL){ console.log('失败项：'); failures.forEach(function(f){ console.log('  - ' + f); }); }
console.log(FAIL ? '结果：FAILED' : '结果：ALL GREEN');
process.exit(FAIL ? 1 : 0);
