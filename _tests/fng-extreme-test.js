/* V1 情绪极值主动推送 · 专项测试
 * 覆盖：极值事件判定（边沿触发）、连续天数与周期提醒、推送文案、通道降级、
 *       以及"只在新增交易日时才推"这条防刷屏闸门。
 * 运行：node _tests/fng-extreme-test.js
 */
const CLOUD = 'D:/mywork/stock-alert-cloud/';
const core = require(CLOUD + 'fng-core.js');
const push = require(CLOUD + 'push.js');
const fng = require(CLOUD + 'fng.js');

let pass = 0, fail = 0; const fails = [];
const ok = (c, n) => { c ? pass++ : (fail++, fails.push(n)); };
const LF = '\n';

/* ---------- A. 极值事件（边沿触发） ---------- */
{
  const E = (p, c) => core.extremeEvent(p, c);

  ok(E(50, 15) && E(50, 15).kind === 'enter-low', 'A1 从常态跌入极度恐惧 → enter-low');
  ok(E(21, 20) && E(21, 20).kind === 'enter-low', 'A2 恰好触到 20 也算进入（含等号）');
  ok(E(20, 19) === null, 'A3 已在极度恐惧区继续走低 → 不重复提醒');
  ok(E(30, 40) === null, 'A4 常态区间内部波动 → 无事件');
  ok(E(50, 85) && E(50, 85).kind === 'enter-high', 'A5 从常态升入极度贪婪 → enter-high');
  ok(E(80, 90) === null, 'A6 已在极度贪婪区继续走高 → 不重复提醒');
  ok(E(15, 30) && E(15, 30).kind === 'leave-low', 'A7 从极度恐惧回到常态 → leave-low（回暖）');
  ok(E(90, 70) && E(90, 70).kind === 'leave-high', 'A8 从极度贪婪回到常态 → leave-high（降温）');
  ok(E(null, 15) === null, 'A9 无前值（首次运行）不误报');
  ok(E(50, null) === null, 'A10 当前值缺失不误报');
  ok(E(50, NaN) === null, 'A11 当前值非法不误报');

  // 自定义阈值
  const E2 = (p, c) => core.extremeEvent(p, c, { low: 10, high: 90 });
  ok(E2(50, 15) === null, 'A12 自定义阈值 low=10 时，15 不算极值');
  ok(E2(50, 5) && E2(50, 5).kind === 'enter-low', 'A13 自定义阈值 low=10 时，5 算极值');

  // 事件元信息
  const ev = core.extremeEvent(50, 12);
  ok(ev.title === '情绪冰点' && ev.dir === 'low', 'A14 事件带标题与方向');
  ok(ev.prev === 50 && ev.cur === 12, 'A15 事件保留前后值');
}

/* ---------- B. 连续天数与周期提醒 ---------- */
{
  const mk = arr => arr.map((v, i) => ({ d: '2026-09-' + String(i + 1).padStart(2, '0'), v: v }));
  ok(core.extremeStreak(mk([50, 40, 15])) === 1, 'B1 刚进入极值区 → 连续 1 天');
  ok(core.extremeStreak(mk([50, 15, 12, 18])) === 3, 'B2 连续 3 天在极值区');
  ok(core.extremeStreak(mk([50, 85, 90])) === 2, 'B3 极度贪婪侧同样计数');
  ok(core.extremeStreak(mk([50, 40])) === 0, 'B4 不在极值区 → 0');
  ok(core.extremeStreak(mk([15, null])) === 0, 'B5 末尾值缺失 → 0');

  ok(core.isReminderDay(1) === false, 'B6 进入当天不算周期提醒（避免和进入提醒重复）');
  ok(core.isReminderDay(5) === true, 'B7 第 5 天提醒');
  ok(core.isReminderDay(10) === true, 'B8 第 10 天提醒');
  ok(core.isReminderDay(7) === false, 'B9 第 7 天不提醒');
  ok(core.isReminderDay(0) === false, 'B10 第 0 天不提醒');
}

/* ---------- C. 推送文案 ---------- */
{
  const mkSeries = arr => arr.map((v, i) => ({ d: '2026-09-' + String(i + 1).padStart(2, '0'), v: v }));
  const s = mkSeries([50, 40, 30, 18]);
  const last = s[s.length - 1];

  const m1 = fng.extremeMessage(core.extremeEvent(30, 18), 18, 1, last);
  ok(/别割在低点/.test(m1.title), 'C1 冰点提醒标题含「别割在低点」：' + m1.title);
  ok(/离回暖最近/.test(m1.body), 'C2 冰点正文点明「离回暖最近」');
  ok(/持股体验最差/.test(m1.body), 'C3 冰点正文点明「持股体验最差」');
  ok(/历史同区/.test(m1.body) && /60 个交易日/.test(m1.body), 'C4 冰点正文附历史实证');
  ok(/该做的/.test(m1.body) && /别做的/.test(m1.body), 'C5 冰点正文同时给「该做的/别做的」');
  ok(!/观望为主/.test(m1.body), 'C6 冰点正文无「观望为主」空话');

  const m2 = fng.extremeMessage(core.extremeEvent(50, 85), 85, 1, last);
  ok(/别追在高点/.test(m2.title), 'C7 过热提醒标题含「别追在高点」：' + m2.title);
  ok(/最容易套人/.test(m2.body), 'C8 过热正文点明风险');
  ok(/减仓|止盈|兑现/.test(m2.body), 'C9 过热正文给出减仓/止盈动作');

  const m3 = fng.extremeMessage(core.extremeEvent(15, 30), 30, 0, last);
  ok(/回暖/.test(m3.title), 'C10 离开冰点 → 回暖提醒：' + m3.title);
  ok(/一波三折|别.*追/.test(m3.body), 'C11 回暖正文提示别急着追');

  const m4 = fng.extremeMessage(core.extremeEvent(85, 60), 60, 0, last);
  ok(/降温/.test(m4.title), 'C12 离开过热 → 降温提醒：' + m4.title);

  const m5 = fng.extremeMessage(null, 15, 10, last);
  ok(/持续第 10 个交易日/.test(m5.title), 'C13 持续提醒标题带天数：' + m5.title);
  const m6 = fng.extremeMessage(null, 88, 5, last);
  ok(/情绪过热持续第 5/.test(m6.title), 'C14 过热侧持续提醒同样成立');
}

/* ---------- D. 通道组装与降级 ---------- */
{
  const chs = push.channelsOf({ channel: 'serverchan', sendKey: 'K1' }, {});
  ok(chs.length === 1 && chs[0].kind === 'serverchan', 'D1 只有主通道时返回 1 个');

  const chs2 = push.channelsOf({ channel: 'serverchan', sendKey: 'K1' },
    { SENDKEY: 'K1', PUSHPLUS_TOKEN: 'P1', WECOM_WEBHOOK: 'https://qyapi.weixin.qq.com/x' });
  ok(chs2.length === 3, 'D2 配置备用通道后返回 3 个（实得 ' + chs2.length + '）');
  ok(chs2[0].kind === 'serverchan' && chs2[1].kind === 'pushplus' && chs2[2].kind === 'wecombot', 'D3 顺序：主通道在最前');
  ok(new Set(chs2.map(c => c.kind + c.key + c.webhook)).size === 3, 'D4 无重复通道');

  const chs3 = push.channelsOf({ channel: 'wecombot', webhook: 'https://w' }, { WECOM_WEBHOOK: 'https://w' });
  ok(chs3.length === 1, 'D3b 同一 webhook 不重复计入');

  const chs4 = push.channelsOf({}, {});
  ok(chs4.length === 0, 'D5 什么都没配 → 0 个通道');
}

/* ---------- E. 推送降级行为（stub fetch） ---------- */
(async () => {
  const realFetch = global.fetch;
  const calls = [];
  const stub = (failKinds) => {
    calls.length = 0;
    global.fetch = async (url, opts) => {
      calls.push(url);
      const bad = failKinds.some(k => String(url).indexOf(k) >= 0);
      if (bad) return { ok: false, status: 500, json: async () => ({}) };
      if (String(url).indexOf('sctapi') >= 0) return { ok: true, status: 200, json: async () => ({ code: 0 }) };
      if (String(url).indexOf('pushplus') >= 0) return { ok: true, status: 200, json: async () => ({ code: 200 }) };
      if (String(url).indexOf('qyapi') >= 0) return { ok: true, status: 200, json: async () => ({ errcode: 0 }) };
      return { ok: true, status: 200, json: async () => ({}) };
    };
  };
  const cfg = { channel: 'serverchan', sendKey: 'K1' };
  const env = { SENDKEY: 'K1', PUSHPLUS_TOKEN: 'P1', WECOM_WEBHOOK: 'https://qyapi.weixin.qq.com/x' };

  stub([]);
  let r = await push.push(cfg, 'T', 'B', env);
  ok(r.ok && r.via === 'Server酱', 'E1 主通道正常时走主通道（via ' + r.via + '）');
  ok(calls.length === 1, 'E2 主通道成功就不再尝试备用通道');

  stub(['sctapi']);
  r = await push.push(cfg, 'T', 'B', env);
  ok(r.ok && r.via === 'PushPlus', 'E3 Server酱 挂了自动降级到 PushPlus（via ' + r.via + '）');
  ok(calls.length === 2, 'E4 降级顺序正确（实发 ' + calls.length + ' 次）');

  stub(['sctapi', 'pushplus']);
  r = await push.push(cfg, 'T', 'B', env);
  ok(r.ok && r.via === '企业微信机器人', 'E5 前两个都挂 → 降到企业微信机器人');

  stub(['sctapi', 'pushplus', 'qyapi']);
  r = await push.push(cfg, 'T', 'B', env);
  ok(!r.ok && r.errors.length === 3, 'E6 全挂时返回 ok:false 并带 3 条错误');

  let threw = null;
  try { await push.pushOrThrow(cfg, 'T', 'B', env) } catch (e) { threw = e }
  ok(!!threw, 'E7 pushOrThrow 在全挂时抛错（让 Actions 亮红，不静默）');

  r = await push.push({ channel: 'serverchan' }, 'T', 'B', {});
  ok(!r.ok && /没有配置任何推送通道/.test(r.errors[0]), 'E8 一个通道都没配时给出明确原因');

  /* ---------- F. 防重复打扰闸门 ---------- */
  const series = [
    { d: '2026-09-14', v: 30 }, { d: '2026-09-15', v: 22 }, { d: '2026-09-16', v: 15 }
  ];
  stub([]);
  const res = await fng.maybeAlertExtreme({ channel: 'serverchan', sendKey: 'K1' }, series);
  ok(res && res.pushed, 'F1 新增交易日跌入冰点 → 推送');
  ok(calls.length === 1, 'F2 只推了一条');

  // 没有"进入/离开"事件、也不在周期提醒日 → 不推
  stub([]);
  const flat = [{ d: '2026-09-14', v: 30 }, { d: '2026-09-15', v: 15 }, { d: '2026-09-16', v: 14 }];
  const res2 = await fng.maybeAlertExtreme({ channel: 'serverchan', sendKey: 'K1' }, flat);
  ok(res2 === null && calls.length === 0, 'F3 常态区间不推、连续待在极值区也不天天推');

  // 第 5 天 → 周期提醒
  stub([]);
  const fifth = [30, 18, 17, 16, 15, 14].map((v, i) => ({ d: '2026-09-1' + i, v: v }));
  const res3 = await fng.maybeAlertExtreme({ channel: 'serverchan', sendKey: 'K1' }, fifth);
  ok(res3 && res3.pushed && /持续第 5/.test(res3.title), 'F4 第 5 个交易日触发周期提醒：' + (res3 && res3.title));

  // 自定义阈值生效
  stub([]);
  const custom = [{ d: 'a', v: 30 }, { d: 'b', v: 18 }];
  const res4 = await fng.maybeAlertExtreme({ channel: 'serverchan', sendKey: 'K1', fngAlert: { low: 15 } }, custom);
  ok(res4 === null, 'F5 配置 low=15 后，18 不再触发冰点提醒');

  global.fetch = realFetch;

  console.log('');
  console.log('================ 汇总 ================');
  console.log('通过：' + pass + '    失败：' + fail);
  if (fail) { console.log('失败项：'); fails.forEach(f => console.log('  - ' + f)); }
  console.log(fail === 0 ? '结果：ALL GREEN' : '结果：存在失败项');
  process.exit(fail ? 1 : 0);
})();
