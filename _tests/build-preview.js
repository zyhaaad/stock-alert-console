/* 生成预览副本：D:\mywork\_preview\stock-picker-preview.html
 * 正式交付物 console.html 不做任何修改；预览副本仅三处追加式注入/标记：
 *   1. <title> 加「预览版（示例数据）」标识，与正式版区分
 *   2. 主脚本前注入 window.__FORCE_DEMO__ = true（沿用现有 DEMO 检测方式，不改其逻辑）
 *   3. 主脚本后注入预览专用配置（覆盖 boot() 生成的演示数据，使各结果分支都能被演示）
 * 运行： "C:\Users\29086\.workbuddy\binaries\node\versions\22.22.2-3\node.exe" D:\mywork\_tests\build-preview.js
 */
'use strict';
var fs = require('fs');
var path = require('path');
var os = require('os');
var cp = require('child_process');

var SRC = 'D:/mywork/stock-alert-console/console.html';
var OUT_DIR = 'D:/mywork/_preview';
var OUT = OUT_DIR + '/stock-picker-preview.html';

var src = fs.readFileSync(SRC, 'utf8');
if(src.indexOf('预览版注入') > -1) throw new Error('源文件疑似已含预览注入，终止');
if(src.indexOf('<title>A股监控 · 预览版') > -1) throw new Error('源文件疑似已是预览副本，终止');

var pre = '<script>window.__FORCE_DEMO__ = true;</script>';

/* 预览配置：监控清单（stocks）与持仓清单（holdings）**分开写**，
 * 好让「两批股票可以互不重叠」这件事在页面上直接看得见：
 *   · 002415 海康威视、600733 北汽蓝谷 → 既监控又持有
 *   · 600036 招商银行 → 只持有、没开提醒（持仓页会标「未监控」）
 * 注意 STOCKS 里不能出现 600519 / 600036，否则「搜茅台/招行 → 唯一命中」的演示就没了。 */
var stocksJs = [
"  var STOCKS = [",
"    { code:'002415', name:'海康威视', condition:'lte', target:31.00, enabled:true, addedAt:'2026-09-01' },",
"    { code:'600733', name:'北汽蓝谷', condition:'lte', target:3.00, enabled:false, addedAt:'2026-09-14' }",
"  ]"
].join('\n');

var holdingsJs = [
"  var HOLDINGS = [",
"    { code:'002415', name:'海康威视', cost:30.00, qty:1000, addedAt:'2026-09-01' },",
"    { code:'600733', name:'北汽蓝谷', cost:3.02, qty:5000, addedAt:'2026-09-14' },",
"    { code:'600036', name:'招商银行', cost:28.00, qty:2000, addedAt:'2026-07-15' }",
"  ]"
].join('\n');

var deletedJs = [
"  var DELETED = [",
"    { code:'000001', name:'平安银行', condition:'gte', target:12.50, addedAt:'2026-08-02', removedAt:'2026-09-03T02:24:00.000Z',",
"      fire:{ firstPrice:12.53, firstAt:'2026-09-03T02:24:00.000Z', lastPrice:12.61, lastAt:'2026-09-03T06:00:00.000Z', count:3 } },",
"    { code:'601318', name:'中国平安', condition:'lte', target:60.00, addedAt:'2026-08-11', removedAt:'2026-09-10T05:10:00.000Z', fire:null }",
"  ]"
].join('\n');

var post = [
'<script>',
'/* ===== 预览版注入（本文件为预览副本，正式交付物 console.html 未改动） =====',
'   覆盖 boot() 生成的演示配置，让各结果分支都能演示：',
'   · 监控清单（STOCKS）与持仓清单（HOLDINGS）是两份独立清单，可互不重叠',
'   · 搜「贵州茅台」「招商银行」「宁德时代」→ 唯一命中（不在监控中，可看现价占位）',
'   · 搜「海康」→ 002415 在监控中 → 「已在监控列表里」',
'   · 搜「平安」→ 两条均在删除记录 → 归档轻提示',
'   · 搜「深物业」「中国」「腾讯控股」「不存在zzz」→ 同名多码 / 太泛 / 非A股 / 空态 */',
'(function(){',
'  if(!window.__FORCE_DEMO__) return',
stocksJs + ';',
holdingsJs + ';',
deletedJs + ';',
"  G.cfg = { stocks: STOCKS, holdings: HOLDINGS, deleted: DELETED }",
"  G.sha = 'demo'; G.state = {}",
"  $('demoflag').className = 'demoflag on'",
"  G.quoteMap = DEMO_QUOTES",
"  /* ★ 演示数据：必须在第一次渲染之前就位，否则卡片上是空态。",
"     主力博弈 V3 覆盖四种判定（主信号向上 / 主信号向下 / 冲突观察 / 趋势持有）；",
"     5 日线覆盖 0/1/2/3 天四种天数（002415 为 0 天 → 按口径不显示）。 */",
"  G.chipMap = demoChipData(); G.chipLoaded = true; G.chipSig = 'preview'",
"  G.v3Map = demoV3Data(); G.v3Loaded = true; G.v3Sig = 'preview'",
"  G.ma5Cache = {",
"    '002415': { at: todayStr(), st: { days: 0, sig: null, ma5: 0 } },",
"    '600519': { at: todayStr(), st: { days: 3, sig: 'sell', ma5: 1230.40 } },",
"    '600733': { at: todayStr(), st: { days: 1, sig: 'watch', ma5: 4.42 } },",
"    '600036': { at: todayStr(), st: { days: 2, sig: 'sell', ma5: 32.55 } }",
"  }",
"  renderActive(G.quoteMap); renderArchive(null); renderHoldings(G.quoteMap)",
"  PICKS.data = picksDemoData(); PICKS.loaded = true; renderPicks()",
"  /* ★ 2026-09-19：驾驶舱演示数据也必须在首渲之前就位（theme-run 主升浪分支 + 3 只优选轮播） */",
"  STYLE.data = styleDemoData(); STYLE.loaded = true; renderStyle()",
"  renderHome(); renderDash(G.quoteMap)",
'})()',
'</script>'
].join('\n');

var first = src.indexOf('<script>');
if(first < 0) throw new Error('未找到主 <script>');
var lastClose = src.lastIndexOf('</script>');
if(lastClose < 0) throw new Error('未找到主 </script>');
var last = lastClose + '</script>'.length;

var out = src.slice(0, first) + pre + src.slice(first, last) + '\n' + post + src.slice(last);
out = out.replace('<title>A股监控</title>', '<title>A股监控 · 预览版（示例数据）</title>');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(OUT, out);

/* ---- 自检 ---- */
var PASS = 0, FAIL = 0;
function ok(c, m){ if(c){ PASS++; } else { FAIL++; console.log('  FAIL ' + m); } }
var res = fs.readFileSync(OUT, 'utf8');
ok((res.match(/<script>/g) || []).length === 3 && (res.match(/<\/script>/g) || []).length === 3, '3 对 script 配对');
ok(res.indexOf('window.__FORCE_DEMO__ = true') > -1, '注入① 演示开关');
ok(res.indexOf('预览版注入') > -1, '注入② 预览配置');
ok(res.indexOf('<title>A股监控 · 预览版（示例数据）</title>') > -1, '注入③ 标题标识');
ok(stocksJs.indexOf("code:'600519'") === -1 && stocksJs.indexOf("code:'600036'") === -1, '监控清单不含 600519/600036（茅台、招行走唯一命中）');
ok(stocksJs.indexOf("code:'600036'") === -1 && holdingsJs.indexOf("code:'600036'") > -1, '600036 只出现在持仓清单、不在监控清单（演示两批股票可不同）');
ok(post.indexOf('renderHoldings(null)') > -1 || post.indexOf('renderHoldings(G.quoteMap)') > -1, '预览注入后重渲染持仓清单');
ok(post.indexOf('renderPicks()') > -1, '预览注入后渲染 AI 备选推荐页');
ok(post.indexOf('renderDash(G.quoteMap)') > -1, '预览注入后渲染首页仪表盘');
ok(src.indexOf('id="dash"') > -1 && src.indexOf('function renderDash') > -1, '源文件含仪表盘容器与渲染函数');
ok(src.indexOf('function nearestStock') > -1 && src.indexOf('function ma5Of') > -1, '源文件含最近触发/5 日线引擎');
ok(src.indexOf('function chipEnsure') > -1 && src.indexOf('function chipDetailHtml') > -1, '源文件含旧透视入口与渲染（保留可回退）');
ok(post.indexOf('G.chipMap = demoChipData()') > -1, '预览注入旧透视演示数据（在首次渲染之前）');
ok(src.indexOf('async function v3Ensure') > -1 && src.indexOf('function v3DetailHtml') > -1 &&
  src.indexOf('function demoV3Data') > -1, '源文件含主力博弈 V3 入口与渲染（v3Ensure/v3DetailHtml/demoV3Data）');
ok(post.indexOf('G.v3Map = demoV3Data()') > -1, '预览注入 V3 演示数据（在首次渲染之前）');
ok(src.indexOf('evalFromBars') < 0 && src.indexOf('demoEvalData') < 0, '★ 旧的「走势/机会/风险」评测已整体移除');
ok(src.indexOf('data-act="hgMonitor"') < 0 && src.indexOf('function addMonitoredFromHolding') < 0, '★ 持仓卡「开价格提醒」操作已整体移除');
var re = /<script>([\s\S]*?)<\/script>/g, m, scripts = [], syn = true;
while((m = re.exec(res))) scripts.push(m[1]);
for(var i = 0; i < scripts.length; i++){
  var tmp = path.join(os.tmpdir(), 'prev-' + i + '-' + Date.now() + '.js');
  fs.writeFileSync(tmp, scripts[i]);
  var r = cp.spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  if(r.status !== 0){ syn = false; console.log('  node --check 失败(脚本' + i + '): ' + (r.stderr || '')); }
  try { fs.unlinkSync(tmp); } catch(e){}
}
ok(syn, '全部脚本 node --check 通过');
ok(fs.readFileSync(SRC, 'utf8') === src, '正式交付物 console.html 未被改动');

console.log((FAIL ? 'FAILED' : 'ALL GREEN') + '（自检 ' + PASS + ' 通过 / ' + FAIL + ' 失败）');
console.log('预览副本：' + OUT);
process.exit(FAIL ? 1 : 0);
