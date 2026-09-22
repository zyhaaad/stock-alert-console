# 项目长期记忆 · D:\mywork

## 一、两套 A 股系统（严格分离）
1. **stock-alert（已上线）**：云端 `stock-alert-cloud/`（GitHub zyhaaad/stock-alert）+ 控制台 `stock-alert-console/console.html`（唯一交付物，https://stock-alert-console.app.workbuddy.host/）。页 `#dash/#pgAdd/#pgFng/#pgHoldings/#pgPicks/#pgStyle`。
2. **mobile_monitor（本地 Python）**：总纲 START_HERE.md，禁重写 SignalEngine/Alerter；`datasource/` 必须留 `__init__.py`（否则被工程根旧 datasource.py 抢导入）。

## 二、硬约定（stock-alert）
1. 改 console.html 必跑 `D:\mywork\_tests\` 全量回归；**改模型 = position-core + console.html + build-preview 注入 + 测试期望，缺一不可**；DOM 测试须先 build-preview 否则假绿。
2. 算法单一真源：两端共用 UMD（`root.*Core`）经 inject-core.js 注入 X-CORE 标记，禁止两端各写一份。
3. **同一文件严禁并行多 Edit**（已丢改动两次）；bash 缺 coreutils → 用 node/内置工具 + Windows 路径；不用 git 提交本机代码。
4. 两清单：stocks=监控（条件+目标价）/ holdings=持仓（**2026-09-20 起只记代码+名称，不再录 cost/qty**）；互不串写、删监控≠删持仓；没记持仓返回 null 绝不显示 ¥0.00。
5. 渲染：重画走 `paint(el,html,key)` 保留 openSet；取价=监控∪归档∪持仓∪推荐（QUOTE_CHUNK=50）；行情回来必须重渲当前页；首屏骨架 + paintFromCache（失败保缓存不清屏）。
6. `chipEnsure`/`v3Ensure` 都要 sign+busy 幂等（renderDash 末尾调用 → 不幂等就无限重画）。
7. 云端脚本必备 `--dry`；发布三步 upload→verify-cloud→dispatch；凭据只读环境变量 GH_TOKEN/SENDKEY 不落盘；token 须 classic(repo+workflow)；`tools/` 不在上传清单。**加云端脚本要同时改 `tools/upload.js` 的 FILES 和 workflow 的 `git add`**。
8. A 股配色**红涨绿跌**；透视/行为块「该跟该躲」刻意避开红绿（跟=蓝/躲=橙/留意=琥珀/中性=灰）。
9. 验收脚本容忍网络抖动：403 / jsDelivr status=0 = 没读到≠失败，只 404 判失败。
10. **负断言一律判去注释源码**（`onNoCmt`，现同时剥 `/* */`、`//`、`<!-- -->`，已踩四次）。衍生坑：①判「已撤下」要判**调用**（`h += mlStopHtml(code)`）不能判函数名（定义本身就含）；②判渲染顺序只在目标函数段内比（首屏骨架里有同名 `dash-h">今日推荐`）；③判「渲染了什么」用 `between()` 切函数体；④**删代码时最容易翻车：一旦在注释里写下「X 已删除」，任何用 raw `on.indexOf('X')` 的负断言立刻变红** —— 新写的负断言必须直接用 `onNoCmt`；⑤代码清了，相关的 CSS/样式断言、快照脚本（`position-snapshot.js` 曾抓 `pfBox`）也要一起清。
11. 比 md5 前先确认解码：必须 `Buffer.concat` → `toString('utf8')`（逐块 `b += d` 会把跨块汉字截成 U+FFFD，伪造「线上被改坏」），必要时 `zlib.gunzipSync`。
12. **发布控制台**：`workbuddy_sites_deploy`，`directory=D:/mywork/stock-alert-console`、**必须 `entryHtml:"console.html"`**（同目录还有 design-preview.html）、`appName=A股监控控制台`、`domainPrefix=stock-alert-console`、`userAskedToPublish:true`、复更 `updateExistingApp:true`。发布后必跑 `_tests/accept-online.js`（现 197 条全绿，含 md5 比对）。⚠️ 发布同意**不跨轮**：改完内容必须由用户在本轮说「发布」才可同步（删代码也算改内容）。
13. 数据依赖：①行情 ulist 含 f21（流通市值·元）→ quoteMap.mv；②`G.dayBars[code]` = chipEnsure 抓的 500 根日K（各引擎复用零请求）；③资金取 card.flowDaily（东财 120 日）或云端 chips.flows.main20；mv 缺失 → 资金维度 NaN → 不出建仓区（诚实降级）。
14. ⚠️ 行情 map 键是东财 secid（`secidOf` → `1.600703`），不是 `sh600703`。演示数据必须自洽（`demoV3Data.dirs[i]` 须等于 `v3sign(...)`，缺值=null，少源写 err）。

## 三、数据源
- ★ **东财 F10 股东户数（2026-09-22 实测）**：`emweb.securities.eastmoney.com/PC_HSF10/ShareholderResearch/PageAjax?code=SH600703` → `gdrs[]` **多期**（季报口径，实测 10 期）；**无 CORS、不支持 JSONP** ⇒ 浏览器拿不到，只能云端抓。`datacenter-web` 的 `RPT_HOLDERNUMLATEST` 只回最新一期（画不出趋势），别再试。控制台侧数据落 `chips-history.json` 的 `holders:[{date,num,ratio,focus}]`（`normHolders` 统一**升序**+过滤脏行+截断 12 期）。
- 腾讯 gtimg 高并发弹反爬；东财 push2his/push2 易限流（**浏览器 JSONP 走 script 标签可直连**，本机 node 沙盒反而失败）；新浪 getKLineData 宽松（不复权，volume 股÷100=手）。
- **历史回放可用性（2026-09-20 实测）**：前复权日K ✅ 腾讯 `web.ifzq.gtimg.cn/appstock/app/fqkline/get`（带日期区间可 600+ 根）；恐贪 ✅ fng-history.json（750 天）；❌ 主力资金流（东财 fflow 仅 120 天）/ ❌ 筹码（2026-09-17 才有）/ ❌ 风格七档（仅 1 天）。⇒ 回放只能走系统真实降级路径，不许用未来数据填空。

## 四、推送规则（signal-core）
- 改规则必升 `RULE_VERSION`（现 **R3**），统计必须传 `onlyVersion`。R3 = MA5_STREAK_EXIT（持仓股连续 ≥2 天**开&收**都站上 5 日线 → 卖提醒），须 `maAlign` 多头排列（MA5>MA10>MA20>MA30）；≥2 橙 / 1 灰 / 0 不渲染。过滤真源 `signalsForList`；文案拆 `buildMessage`；持续条件冷却 5 天。测试 K 线底座须 ≥30 根多头排列 + 一根回落。

## 五、主力博弈 V3
- 三源投票：①当日涨跌 ②当日主力净额（东财 fflow f52，可 null）③20 日趋势。`AGREE_RATIO=0.66 / MIN_SOURCES=2` 勿改；平票/无多数 → downgrade；趋势持有 = 连续 ≥3 天冲突且 ret20>0.15。
- 冲突天数落 `sa_v3_state_v1`（同日幂等、跨日 +1、共识归零、**源不足不动计数**）；conf：主信号 0.8 / 观察 0.2 / 趋势持有 0.7。
- 展示层（`v3SrcNote/v3Head/v3Sub/v3Advice`）与算法层（`v3Vote/v3Ensure/常量/冲突计数`）分离；`v3Advice` **不编目标价**。取收盘价用 `v3CloseAt()`（normBars 后是对象，`bars[i][2]` 恒失效）。缺源如实说，observe 不参投票。
- 旧透视代码（chipEnsure/chipBriefHtml/chipDetailHtml/demoChipData/chipLiveFrom）**保留可回退**，chipEnsure 仍必须跑（ma5Cache 依赖）。
- 散户行 `retailLineHtml(code)` 纯展示（读 chipMap[code].retail，零请求），**绝不参与投票**。`judgeRetail`：散户净额=−主力净额，**必须叠加价格方向**（跌+主力买=割肉 / 跌+主力卖=抄底 / 涨+主力买=获利了结 / 涨+主力卖=追高）。

## 六、持仓详情页 = 只留结论（2026-09-20 晚定稿上线）
- `v3DetailHtml` 只渲染各引擎**结论**：①`cd-act`「主力 → X」+ 建议 ②`retailLineHtml`（散户行为）③`cd-stat mute`「综合研判（次要参考）→ X（Y）· 以上面主力博弈为准」④`cd-act`「中长线 → X（第 N 天）」+ `ws.advice` ⑤缺源 warn ⑥一行免责。
- **已撤下**：三源明细格、共识/冲突天数/置信度、价格结构评分、S2 全部指标格、波段定性说明、阶段顶部、恐贪力度、`.cd-note` 小字；**风控（止损位）与仓位行也已撤**（无成本即无基准），但 `mlStopLoss/mlStopHtml/mlPositionHtml` 保留可回退。
- **2026-09-20 用户四连改**：①持仓去成本/股数，只留删除；添加页无需成本/股数 → **全部记账撤掉**（无浮盈/市值/成本合计，统计条只报「共 N 条持仓」；`renderPortfolio` 与 `.pf*` 样式**已整体删除**，不再留死代码 —— position-core 的 `portfolioOf/pnlClass/FEE_NOTE` 保留给云端与单测）。②综合研判 F4 **降级为中性状态条**（它常与主力博弈打架：一个说回补吸筹、一个说主力撤退）。③详情块去掉胶囊「圆弧线框」（`.chip.cd-block{border:0;background:transparent;border-radius:0}`）。④首页 renderDash 在「今日推荐」**上方**加大盘驾驶舱概览卡（`data-act="dash-style"` → `openStyle()`）。
- 详情块（`cd-act`/`cd-stat`）之外，2026-09-22 新增 **`holderLineHtml(code)`**（股东人数一行 + `holderTrendSvg` 柱状趋势图，季度口径必须标日期，降=蓝/升=琥珀/持平=灰，零额外请求读 `G.chipMap[code].holders`）。
- ⚠️ `ws.advice` 里的代价/口径数字（0.45 次、再跌 2.9%、2025 反向、躲对率 76%）用户要求说清，别顺手删；`**强调**` 必须走 `mdB(esc(...))`。算法层零改动。
- 改这块要同步改：`position-dom-test.js`、`accept-online.js`、`position-core-test.js`（必要时 `s2-snapshot.js`）。

## 七、综合研判 F4
- `fusionVerdict(h)` = 筹码透视（中期）+ 价格结构（短期），纯展示零请求。规则：①`force_no_trade`（诱多）硬躲；②破位+主力派发 → 躲；③破位+筹码侧为跟 → **保留跟 + `pullback` 回踩标注**（建仓 20 日 +4.76%、黄金组合 +5.50%）；④筹码缺失+破位 → 观望。
- 回测（17 只×6440 点）：跟 10 日 +1.34%、躲精准 62.5%（1.54x）、跟后大跌率 25.8% < 基准 28.1%。脚本 `_tests/rules-fusion.js`（fusion2/3/4 并存）+ `f4-selfcheck.js`。
- **教训**：①F2 回测漏调 psCalc → 硬裁决分支未回测就上线；②F3 破位门禁把回踩买点拦成观望；③09-18 并非普跌（上证 +0.94%）被我误判 —— 解释信号前先查当日涨跌。

## 八、中长线引擎 S2（线上现行）
- 定位：**中长线持股用、不是每天出信号**；区间级波段定性（底部区间约 8 日、派发约 2~4 天），显「第 N 天」；`mlChanged`（`sa_ml_state_v1`）+ `mlRunDays` 数交易日。
- `weekStage(code)`（≥250 根、周/月级、零请求）：pos250（用盘中高低价）/ premLow / supDist·resDist（近 20 周高低=同周期支撑压力）/ wma5·wma20 / volRatio（4 周÷26 周）/ mainRatio（近 20 日主力净额÷流通市值）/ maAlign·streak5·overMa5 / 筹码 mcDev（只分级不改触发）。
- **四态**（先判风险后判机会），常量 `ML_LOW_GATE=0.30 / ML_SUP_GATE=0.15 / ML_SELL_MA5=0.05 / ML_SELL_POS=0.65 / ML_SELL_STREAK=2 / ML_STOP=0.10`：
  ① `sell-overheat` 高位过热·减仓 = maAlign 且 streak5≥2 且 overMa5>5% 且 pos250>0.65 → **躲对率 76%**、躲对幅度 +17.1%（旧「派发完毕」躲对率仅 50% 已停用）。mcDev≥0.15 → thick（后 60 日 −11.3% vs thin −4.8%）。
  ② `fall-not-done` 下跌未完 = ret60<−20% 且 volRatio<0.9 且 |mainRatio|<0.004 → 后 60 日 −8.74%（n=119）。
  ③ `accumulate-zone` 主力建仓区 = mainRatio>0.004 且 pos250<0.4 且 wma5>wma20 且 premLow<0.30 且 supDist<0.15 → **0.45 段/年**、起点买入 60 日 **+24.6%**、胜率 90%、建仓期浮亏 −2.9%。
  ④ `trending` 趋势运行中 = 兜底。
- 止损 `ML_STOP=0.10`：有成本=成本×0.9；无成本=本态起始价×0.9（标「近似」）；都没有=返回 null。**仓位 = 用户自控**（五档版已砍，负断言锁死）。大盘 `mlMarketCtx()` 只标注**不参与触发**（风格七档只有 1 天历史、无法回测）。
- **已验证为错的直觉**（别捡回来）：卖出三直觉全反向（高位+资金转负 +2.96% / 高位+缩量 +5.28% / 高位+周线转空 +5.16%）；「缩量但无资金进场」是陷阱不是底；单独「多头排列+连站 MA5」无预测力（+1.75% vs 基准 +4.45%），**叠加偏离>5% 且 pos>0.65 才有**。
- **★ 未解缺口（已盘给用户、等拍板）**：①买点只覆盖 7/17 只（放宽即掉回基准，稀有=特性）；②中期见顶仍无解（只有短期过热一种卖点，2025 反向）；③无停复牌概念。⚠️ 阈值多重检验风险：30/15/5/65% 是候选里挑的，与更紧版本的差距不当真。

## 九、回测/回放铁律
- **必须调真代码**（`build-preview.js` → jsdom 装预览 → 喂 `G.dayBars/G.chipMap/G.quoteMap` → 调 `w.weekStage` 等），**严禁自己重写规则**（曾把「仅候选」当系统输出，结论全错）。
- **区间级而非日级**（按区间合并容差 5 日，一段算一次；单只股按事件算命中率，按天会把 n=2 虚增成 n=7）。基准 60 日 +4.4%。
- 口径：console 周聚合**含当周残周**，`s1-eval/funnel/redesign/gate/sr` 只取完整周 ⇒ 周一~周四两者分歧、周五一致（191 日中 30% 不一致）。pos250 用盘中高低价。资金窗口 = flowDaily 末 20 条（停牌 0 值会污染）。
- 统计禁区：只统计已平仓会造出假的「胜率 100%」；未平仓按最后收盘记账。
- 脚本 `s1-*.js`（zone/funnel/gate-test/sr-test/chipadd/market/eval + `s1-single.js <code>`），报告同名 `.md`；单只回放样板 `_tests/sim-603026.js`（覆写 `w.todayStr` 驱动日期、只喂 ≤D 的 bars）。
- **★ 策略级硬结论**：全进全出择时在牛市样本必输死拿（S2 +13.57%/回撤 −7.66% vs 死拿 +25.08%/−28.44%），价值在**控回撤**（风险调整 2.39 vs 0.88）；正确用法 = 底仓常持＋买点加仓＋卖点减仓＋硬止损（补 −10% 止损 → +14.32%/−7.32%，胜率 66.7%→51.4%）。
- ⚠️ 用户问「距目标还差什么」时我列的缺口 ≠ 他要的缺口 —— 涉及其决策域（仓位/资金/偏好）先问再动手。

## 十、大盘风格驾驶舱（S1）
- **2026-09-21 起独立排期**：`style.yml` 交易日 **15:05 快版**（`node style.js --wait=8`，等腾讯当日日K + 东财涨停池当日数据双双到位；每次抓取 20s 硬超时，总耗时有上界）+ **15:40 定稿**（资金流此时已结算完，按同一 `date` 覆盖）。**原挂在 signals.yml 第 4 步（16:05、且排在 screener/chips 之后，上游失败当天就不更新）— 已摘掉。**
- `style.js` 新增纯函数 `bjMinutes/isWeekend/waitReady`：周末直接跳过；等满仍未拿到当日数据 → 判定非交易日跳过（节假日不再留假快照）。15:30 前生成标 `draft:true`（快版）。
- **`fngDate` 必须落档**：`fng.js` 16:05 才写当天恐贪，驾驶舱 15:05 拿到的是**昨天**的，界面要标出日期（`58（09-18）`），不冒充今天。
- ★ **取档源顺序（踩过的坑，别再犯）**：jsDelivr 的 gh 缓存**滞后可达数天**（改造完它还端着 09-19 的旧档、真实已是 09-21），而 `raw.githubusercontent.com` 在用户网络是**黑洞** ⇒ 实际走的正是最旧那条。正确顺序：**GitHub API（带 token → 匿名均可，不进 CDN）→ raw → jsDelivr 兜底**。匿名 API 60 次/小时对个人控制台够用。
- 前端：`styleExpectDate/styleFreshHtml/styleHardRefresh` 三件套 + 「重新拉取」按钮（20s 节流）+ 回前台数据落后时静默补拉（15:13 前不打扰）。驾驶舱的新鲜度徽标是刻意加的 —— 用户抱怨的"没更新"有一半是"不知道它更没更新"。
- 云端 `style.js` 每日收盘跑：七档 defense>theme-run>short-term>rotation>crowd-large>small-cap>mixed + 操作指南 + 优选 ≤3 只（资金连续 ≥2 日 + 板块流入前 20 + psGate 顶部闸门 + 冰点退潮不出票 + 止损 −5%）→ style-history.json；控制台 #pgStyle。
- 存档 `date` 记**数据所在交易日** + `generatedAt`；控制台取 `days[days.length-1]`（结构 `{v,updated,days:[]}`）。读云端 JSON 备源 **raw.githubusercontent 先、jsdelivr 后**（CDN 缓存滞后一天）。
- emoji 一律用 `\u{1F7E2}` 码点转义正则，绝不按字符串长度切。
- F4 追踪器 `D:/mywork/fusion-tracker/run.js`。⚠️ `isFinite(null)===true` → 前瞻统计用 `fin()`。⚠️ 新浪日K备源不复权会让 ChipCore 畸变 → `ksrc!=='tx'` 跳过不入库。
