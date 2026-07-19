// drawPigCounter.js — 可复用组件：展示「剩余未逃脱的猪」数量（或其它可变内容）
// 所有子元素坐标均以一个虚拟 frame（55×120）为基准的相对坐标，
// 调用方只需指定 frame 落点 (frameX, frameY) 即可在任何位置绘制同样的布局。
//
// 该组件整体置于 Figma 父 frame，原点 (160, -48)（375 设计画布），故关卡内调用
//   drawPigCounter(ctx, 160, -48, { iconKey: 'pig_icon', value: remaining })
// 即可还原设计稿。frame 内的相对坐标见下方 GEOM（已由用户给定的父 frame 原点换算）。

var AssetPreloader = require('./AssetPreloader.js');
var Theme = require('../define/GameDefine.js').THEME;

// 圆角矩形路径（本地实现，避免依赖外部 roundRect）
function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, Math.floor(w / 2), Math.floor(h / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 相对坐标（origin = 父 frame 左上角 (160,-48)，x→右，y→下），由 Figma 屏幕绝对坐标 - 父 frame 原点折算：
//   bar   abs(196,-48)         → rel(36,0)
//   pill  abs(169,22)          → rel(9,70)
//   panel abs(173,26)          → rel(13,74)
//   pig   abs(177,30.5,40,34)  → rel(17,78.5,40,34) — 中心 (197,47.5) 与面板中心对齐，放大补偿 PNG 透明内边距
//   count abs(200,51)          → rel(40,99)
var GEOM = {
  bar:   { x: 36, y: 0,  w: 4,  h: 72,    color: '#87725F' },                                   // 竖条 3469912
  pill:  { x: 9,  y: 70, w: 55, h: 50,    r: 14, color: '#A35A34', hi: '#FFA661' },             // 外棕药丸 3469910
  panel: { x: 13, y: 74, w: 47, h: 42,    r: 12, color: '#FAD8A0' },                             // 内米色面板 3469911
  pig:   { x: 17, y: 78.5, w: 40, h: 34 },                                                          // 猪头图标（bg-removed PNG，略放大补偿透明内边距；中心对齐面板中心，位置正确不歪）
  count: { x: 40, y: 99, w: 18, h: 13 },                                                            // 数量数字框（Figma 33 节点）
};

// ===== 吊牌单摆（剩余猪数减少时播放；参数刻意与 RightStepWidget 错开，避免「逃猪」同事件触发时两牌锁相摆动）=====
// 本组件是纯绘制函数、无实例状态，故用模块级变量保存脉冲队列与上次数字。
// 数字「变小」= 逃猪 → 触发摆动；「变大」视为换关/重玩 → 仅更新基线、不弹（避免进关误触发）。
var _pcShakes = [];
var _pcLastValue = undefined;
var _PC_SHAKE_DURATION = 850;             // 单个脉冲摆动收住时间
var _PC_SHAKE_AMP = 0.17;                 // 初始摆角(弧度) ≈ 9.7°（刻意不同于步数牌 0.15，避免两牌锁相）
var _PC_SHAKE_TAU = 420;                  // 衰减常数(ms)，越大摆得越久、收尾越飘
var _PC_SHAKE_OMEGA = 2 * Math.PI * 1.6;  // 摆动角频率(≈1.6Hz，明显慢于步数牌 2.0/2.6Hz，两牌相位立刻错开)
var _PC_SHAKE_MAX = 4;                    // 最多叠加脉冲数（防失控）

function _pcTriggerShake() {
  var now = Date.now();
  var p = {
    ts: now,
    amp: _PC_SHAKE_AMP * (0.7 + Math.random() * 0.6),      // 振幅 ±30%~40%（每次幅度不同）
    tau: _PC_SHAKE_TAU * (0.85 + Math.random() * 0.3),     // 衰减 ±15%（尾韵长短微差）
    omega: _PC_SHAKE_OMEGA * (0.85 + Math.random() * 0.3), // 频率 ±15%（与步数牌进一步拉开，不锁相）
    dir: Math.random() < 0.5 ? 1 : -1,                     // 起手方向随机（先右/先左）
  };
  _pcShakes.push(p);
  if (_pcShakes.length > _PC_SHAKE_MAX) _pcShakes.splice(0, _pcShakes.length - _PC_SHAKE_MAX);
}

function _pcGetShakeAngle() {
  if (_pcShakes.length === 0) return 0;
  var now = Date.now();
  var total = 0;
  for (var i = _pcShakes.length - 1; i >= 0; i--) {
    var p = _pcShakes[i];
    var elapsed = now - p.ts;
    if (elapsed >= _PC_SHAKE_DURATION) { _pcShakes.splice(i, 1); continue; }
    var decay = Math.exp(-elapsed / p.tau);
    total += p.amp * decay * Math.sin(p.dir * p.omega * elapsed / 1000);
  }
  return total;
}

// 检测数字变化：减少才弹（逃猪）；变大视为换关/重玩，仅更新基线不弹
function _pcDetectChange(valueStr) {
  var prev = _pcLastValue;
  if (prev === undefined) { _pcLastValue = valueStr; return; }
  var a = parseInt(valueStr, 10);
  var b = parseInt(prev, 10);
  if (!isNaN(a) && !isNaN(b)) {
    if (a < b) _pcTriggerShake();
    // a > b（换关/重玩数字变大）→ 仅更新基线，不弹，避免进关误触发
  } else if (valueStr !== prev) {
    _pcTriggerShake();
  }
  _pcLastValue = valueStr;
}

/**
 * 绘制「剩余猪数量」组件
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} frameX  frame 左上角 x（画布坐标）
 * @param {number} safeTop 顶部可用区上边界 y（safeLayout.safeLineY(SCREEN_WIDTH/2)），
 *   面板顶贴此线下方 6px 间隙；原硬编码 frameY=-48 由 safeTop 动态推算。
 * @param {object} opts
 *   - iconKey {string}  图标资源 key，默认 'pig_icon'（后续可传 'bird_icon' 等）
 *   - value   {number|string} 展示的数字/文本，默认 ''
 *   - font    {string}  字体，默认 Theme.font.family（大宝桃桃体）
 */
function drawPigCounter(ctx, frameX, safeTop, opts) {
  opts = opts || {};
  var iconKey = opts.iconKey || 'pig_icon';
  var value = (opts.value != null) ? String(opts.value) : '';
  var fontFamily = opts.font || (Theme.font && Theme.font.family) || 'sans-serif';

  // 棍子规则：只要面板不越安全线，尽量短，但可见部分 ≥ 22px。y=0 起画。
  // panelTop = max(安全线下2px, 最低20) → frameY = panelTop - 70(pill.y)
  var panelTop = Math.max(safeTop + 2, 20);
  var ox = frameX;
  var oy = panelTop - GEOM.pill.y;  // 面板(pill)顶 = panelTop

  // 剩余猪数变化检测 → 自动触发吊牌单摆（减少才弹；变大视为换关不弹）
  _pcDetectChange(value);

  // 单摆：整块计数器绕「吊绳顶端」(bar 顶部中心) 旋转摆动，与步数面板同款
  var pcAngle = _pcGetShakeAngle();
  ctx.save();
  if (pcAngle !== 0) {
    var pcPivotX = ox + GEOM.bar.x + GEOM.bar.w / 2;
    var pcPivotY = oy + GEOM.bar.y;
    ctx.translate(pcPivotX, pcPivotY);
    ctx.rotate(pcAngle);
    ctx.translate(-pcPivotX, -pcPivotY);
  }

  // 1) 竖条（最底层，无圆角，无阴影）
  ctx.fillStyle = GEOM.bar.color;
  ctx.fillRect(ox + GEOM.bar.x, oy + GEOM.bar.y, GEOM.bar.w, GEOM.bar.h);

  // 2) 外棕药丸（外投影 + 内高光）
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
  roundRectPath(ctx, ox + GEOM.pill.x, oy + GEOM.pill.y, GEOM.pill.w, GEOM.pill.h, GEOM.pill.r);
  ctx.fillStyle = GEOM.pill.color;
  ctx.fill();
  ctx.restore();
  // 内高光：inset 2px 2px 4px #FFA661（clip 到圆角矩形后画左上渐变）
  ctx.save();
  roundRectPath(ctx, ox + GEOM.pill.x, oy + GEOM.pill.y, GEOM.pill.w, GEOM.pill.h, GEOM.pill.r);
  ctx.clip();
  var pg = ctx.createLinearGradient(
    ox + GEOM.pill.x, oy + GEOM.pill.y,
    ox + GEOM.pill.x + GEOM.pill.w, oy + GEOM.pill.y + GEOM.pill.h
  );
  pg.addColorStop(0, 'rgba(255, 166, 97, 0.9)');
  pg.addColorStop(0.35, 'rgba(255, 166, 97, 0)');
  ctx.fillStyle = pg;
  ctx.fillRect(ox + GEOM.pill.x, oy + GEOM.pill.y, GEOM.pill.w, GEOM.pill.h);
  ctx.restore();

  // 3) 内米色面板（内阴影 rgba(0,0,0,0.25)）
  roundRectPath(ctx, ox + GEOM.panel.x, oy + GEOM.panel.y, GEOM.panel.w, GEOM.panel.h, GEOM.panel.r);
  ctx.fillStyle = GEOM.panel.color;
  ctx.fill();
  ctx.save();
  roundRectPath(ctx, ox + GEOM.panel.x, oy + GEOM.panel.y, GEOM.panel.w, GEOM.panel.h, GEOM.panel.r);
  ctx.clip();
  var cxp = ox + GEOM.panel.x + GEOM.panel.w / 2;
  var cyp = oy + GEOM.panel.y + GEOM.panel.h / 2;
  var ig = ctx.createRadialGradient(
    cxp, cyp, Math.min(GEOM.panel.w, GEOM.panel.h) / 3,
    cxp, cyp, Math.max(GEOM.panel.w, GEOM.panel.h) / 1.4
  );
  ig.addColorStop(0, 'rgba(0, 0, 0, 0)');
  ig.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
  ctx.fillStyle = ig;
  ctx.fillRect(ox + GEOM.panel.x, oy + GEOM.panel.y, GEOM.panel.w, GEOM.panel.h);
  ctx.restore();

  // 4) 猪头图标（iconKey 可替换为小鸟等）
  if (AssetPreloader.isReady(iconKey)) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.drawImage(
      AssetPreloader.get(iconKey),
      ox + GEOM.pig.x, oy + GEOM.pig.y, GEOM.pig.w, GEOM.pig.h
    );
    ctx.restore();
  }

  // 5) 数量数字（严格按 Figma 33 节点）
  // font 13px 大宝桃桃体、白字(#FFFFFF)、border:1px solid #733C29。
  // 说明：Figma 该 border 是文字「描边」(strokeText)，并非黑底方框——
  // 故用 strokeText 画 1px #733C29 描边，再白字填充；不画任何填充方框。
  var ccx = ox + GEOM.count.x + GEOM.count.w / 2;
  var ccy = oy + GEOM.count.y + GEOM.count.h / 2;
  ctx.font = '400 13px ' + fontFamily;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#733C29';
  ctx.strokeText(value, ccx, ccy);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText(value, ccx, ccy);

  ctx.restore();   // 单摆旋转 transform 作用域收尾（与开头 ctx.save 配对）
}

module.exports = { drawPigCounter };
