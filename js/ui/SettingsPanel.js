// 推猪消除 — 设置面板
// 渲染悬停面板，支持音乐/音效独立开关 + 可选底部功能按钮

var audio = require('../audio/AudioManager.js');
var databus = require('../databus.js');

// 面板状态
var _open = false;
var _panel = null;   // { x, y, w, h }

// 底部按钮配置（仅关卡内使用）
// [{ label, iconType, wide, action }] — iconType: 'house' | 'restart'; action: function()
var _buttons = null;

// 开关热区
var _musicRect = null;
var _sfxRect = null;
var _closeRect = null;

// 底部按钮热区
var _btnRects = null;

// ===== 布局常量 =====
var PW = 280;              // 面板宽度
var RADIUS = 20;           // 面板圆角
var TOGGLE_H = 48;         // 每行高度
var LABEL_X = 40;          // 标签起始 X
var TOGGLE_W = 52;         // 开关宽度
var TOGGLE_H2 = 28;        // 开关高度
var TOGGLE_R = 14;         // 开关圆角
var THUMB_R = 11;          // 滑块半径
var THUMB_SLIDE = 22;      // 滑块滑动距离

/**
 * 打开设置面板
 * @param {Object} opts
 *   opts.buttons — 可选，底部按钮数组
 *     每个按钮: { iconType?: 'house'|'restart', label?: string, wide?: boolean, action: fn }
 *     iconType 为矢量图标名；wide=true 为宽文字按钮
 */
function open(opts) {
  opts = opts || {};
  _open = true;
  _buttons = opts.buttons || null;

  // 计算面板位置
  var cx = databus.screenWidth / 2;
  var h = _calcPanelHeight();
  _panel = {
    x: cx - PW / 2,
    y: (databus.screenHeight - h) / 2 - 20,
    w: PW,
    h: h,
  };
}

function close() {
  _open = false;
  _panel = null;
  _buttons = null;
  _musicRect = null;
  _sfxRect = null;
  _closeRect = null;
  _btnRects = null;
}

function isOpen() {
  return _open;
}

function toggle() {
  if (_open) close(); else open();
}

// ===== 高度计算 =====

function _calcPanelHeight() {
  var h = 12; // top padding
  h += 30;    // close button area
  h += 12;    // gap
  h += TOGGLE_H * 2; // two toggle rows
  h += 10;    // padding after toggles

  if (_buttons && _buttons.length > 0) {
    h += 1; // divider space
    h += 12; // gap
    h += 44; // button row
    h += 14; // bottom padding
  } else {
    h += 16; // bottom padding
  }

  return h;
}

// ===== 渲染 =====

function render(ctx) {
  if (!_open || !_panel) return;

  var p = _panel;
  var cx = p.x + p.w / 2;

  // 1. 半透明遮罩
  ctx.fillStyle = 'rgba(0, 0, 0, 0.45)';
  ctx.fillRect(0, 0, databus.screenWidth, databus.screenHeight);

  // 2. 面板底色
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 10;
  _roundRect(ctx, p.x, p.y, p.w, p.h, RADIUS);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.97)';
  ctx.fill();
  ctx.restore();

  // 3. 关闭按钮（右上角：圆形底 + ×）
  var closeD = 28;
  var closeX = p.x + p.w - closeD - 14;
  var closeY = p.y + 14;
  _closeRect = { x: closeX - 4, y: closeY - 4, w: closeD + 8, h: closeD + 8 };

  // 圆形背景
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.08)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.arc(closeX + closeD / 2, closeY + closeD / 2, closeD / 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(241, 245, 249, 0.9)';
  ctx.fill();
  ctx.restore();

  // × 线
  var ccx = closeX + closeD / 2;
  var ccy = closeY + closeD / 2;
  var crossR = 5;
  ctx.strokeStyle = '#64748B';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ccx - crossR, ccy - crossR);
  ctx.lineTo(ccx + crossR, ccy + crossR);
  ctx.moveTo(ccx + crossR, ccy - crossR);
  ctx.lineTo(ccx - crossR, ccy + crossR);
  ctx.stroke();

  // 4. 开关行
  var toggleY = p.y + 56;
  _renderToggle(ctx, cx, toggleY, '🎵 音乐', audio.isMusicEnabled());
  _musicRect = {
    x: p.x, y: toggleY - TOGGLE_H / 2,
    w: p.w, h: TOGGLE_H,
  };

  toggleY += TOGGLE_H;
  _renderToggle(ctx, cx, toggleY, '🔊 音效', audio.isSfxEnabled());
  _sfxRect = {
    x: p.x, y: toggleY - TOGGLE_H / 2,
    w: p.w, h: TOGGLE_H,
  };

  // 5. 底部按钮（如有）
  if (_buttons && _buttons.length > 0) {
    var dividerY = toggleY + TOGGLE_H / 2 + 12;

    // 分割线
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + 24, dividerY);
    ctx.lineTo(p.x + p.w - 24, dividerY);
    ctx.stroke();

    // 按钮行
    var btnY = dividerY + 16;
    _renderBottomButtons(ctx, cx, btnY);

    // 更新面板底部热区
    _btnRects = [];
    var btnW = 56;
    for (var i = 0; i < _buttons.length; i++) {
      var b = _buttons[i];
      var bw = b.wide ? 108 : btnW;
      _btnRects.push({
        x: b._x,
        y: btnY,
        w: bw,
        h: 40,
        action: b.action,
      });
    }
  } else {
    _btnRects = null;
  }
}

function _renderToggle(ctx, cx, cy, label, isOn) {
  // 标签
  ctx.fillStyle = '#0F172A';
  ctx.font = '17px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx - PW / 2 + LABEL_X, cy);

  // 开关背景
  var swX = cx + PW / 2 - LABEL_X - TOGGLE_W;
  var swY = cy - TOGGLE_H2 / 2;

  ctx.fillStyle = isOn ? '#EC4899' : '#CBD5E1';
  _roundRect(ctx, swX, swY, TOGGLE_W, TOGGLE_H2, TOGGLE_R);
  ctx.fill();

  // 滑块（带阴影）
  var thumbX = swX + (isOn ? THUMB_SLIDE : 3);

  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.15)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  ctx.fillStyle = '#FFFFFF';
  ctx.beginPath();
  ctx.arc(thumbX + THUMB_R, swY + TOGGLE_H2 / 2, THUMB_R, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function _renderBottomButtons(ctx, cx, btnY) {
  var bw = 56;  // icon button width
  var bh = 40;
  var midW = 108; // middle "继续游戏" button width
  var gap = 8;

  // Layout: [icon left] [mid text] [icon right]
  var icon0X = cx - midW / 2 - gap - bw;
  var midX = cx - midW / 2;
  var icon1X = cx + midW / 2 + gap;

  for (var i = 0; i < _buttons.length; i++) {
    var b = _buttons[i];
    var isWide = b.wide;
    var bx = isWide ? midX : (i === 0 ? icon0X : icon1X);
    var bxw = isWide ? midW : bw;

    if (isWide) {
      // "继续游戏" — 粉色渐变填充 + 微阴影
      ctx.save();
      ctx.shadowColor = 'rgba(236, 72, 153, 0.25)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      _roundRect(ctx, bx, btnY, bxw, bh, 10);
      var grad = ctx.createLinearGradient(bx, btnY, bx, btnY + bh);
      grad.addColorStop(0, '#F472B6');
      grad.addColorStop(1, '#EC4899');
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();

      // 文字
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label || '', bx + bxw / 2, btnY + bh / 2);
    } else {
      // 图标按钮 — 白底 + 微阴影 + 细边框
      ctx.save();
      ctx.shadowColor = 'rgba(0, 0, 0, 0.06)';
      ctx.shadowBlur = 4;
      ctx.shadowOffsetY = 1;
      _roundRect(ctx, bx, btnY, bxw, bh, 10);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
      ctx.restore();

      ctx.strokeStyle = 'rgba(0,0,0,0.08)';
      ctx.lineWidth = 1;
      _roundRect(ctx, bx, btnY, bxw, bh, 10);
      ctx.stroke();

      // 矢量图标
      var iconCX = bx + bxw / 2;
      var iconCY = btnY + bh / 2;
      var iconColor = '#0F172A';

      if (b.iconType === 'house') {
        drawHouseIcon(ctx, iconCX, iconCY, 20, iconColor);
      } else if (b.iconType === 'restart') {
        drawRestartIcon(ctx, iconCX, iconCY, 18, iconColor);
      }
    }

    // 存位置给点击检测
    b._x = bx;
  }
}

// ===== 触控处理 =====

/**
 * 处理触控，返回 true 表示事件被面板消费（不透传到下层）
 * @returns {boolean}
 */
function handleTouch(x, y) {
  if (!_open) return false;

  // 点关闭按钮
  if (_closeRect && x >= _closeRect.x && x <= _closeRect.x + _closeRect.w &&
      y >= _closeRect.y && y <= _closeRect.y + _closeRect.h) {
    close();
    return true;
  }

  // 点音乐开关
  if (_musicRect && x >= _musicRect.x && x <= _musicRect.x + _musicRect.w &&
      y >= _musicRect.y && y <= _musicRect.y + _musicRect.h) {
    audio.setMusicEnabled(!audio.isMusicEnabled());
    return true;
  }

  // 点音效开关
  if (_sfxRect && x >= _sfxRect.x && x <= _sfxRect.x + _sfxRect.w &&
      y >= _sfxRect.y && y <= _sfxRect.y + _sfxRect.h) {
    audio.setSfxEnabled(!audio.isSfxEnabled());
    return true;
  }

  // 点底部按钮
  if (_btnRects) {
    for (var i = 0; i < _btnRects.length; i++) {
      var r = _btnRects[i];
      if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
        if (r.action) r.action();
        return true;
      }
    }
  }

  // 点在遮罩上（面板外）→ 关闭面板
  if (_panel) {
    var px = _panel.x, py = _panel.y, pw = _panel.w, ph = _panel.h;
    if (x < px || x > px + pw || y < py || y > py + ph) {
      close();
      return true;
    }
  }

  // 点在面板内但不在任何按钮上 → 消费掉，不透传
  return true;
}

// ===== 工具 =====

function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

// ===== 矢量图标 =====

/**
 * 齿轮图标 — 中央圆盘 + 8 个齿
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} cx, cy — 中心坐标
 * @param {number} r — 外径（不含齿尖）
 * @param {string} color — 填充色
 */
function drawGearIcon(ctx, cx, cy, r, color) {
  // 中央圆盘
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  // 8 个齿（小圆）
  var teethCount = 8;
  for (var i = 0; i < teethCount; i++) {
    var angle = Math.PI * 2 * i / teethCount - Math.PI / 2;
    var tx = cx + Math.cos(angle) * r * 0.74;
    var ty = cy + Math.sin(angle) * r * 0.74;
    ctx.beginPath();
    ctx.arc(tx, ty, r * 0.24, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  // 中心镂空（destination-out 掏洞，透出背景）
  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';
}

/**
 * 房子图标 — 尖顶 + 屋身 + 门
 */
function drawHouseIcon(ctx, cx, cy, size, color) {
  var hs = size / 2;

  // 屋身
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeRect(cx - hs * 0.6, cy + hs * 0.05, hs * 1.2, hs * 0.65);

  // 尖顶
  ctx.beginPath();
  ctx.moveTo(cx - hs * 0.7, cy + hs * 0.08);
  ctx.lineTo(cx, cy - hs * 0.85);
  ctx.lineTo(cx + hs * 0.7, cy + hs * 0.08);
  ctx.closePath();
  ctx.stroke();

  // 门
  ctx.fillStyle = color;
  ctx.fillRect(cx - hs * 0.18, cy + hs * 0.28, hs * 0.36, hs * 0.42);
}

/**
 * 重开图标 — 圆弧箭头
 */
function drawRestartIcon(ctx, cx, cy, size, color) {
  var r = size * 0.5;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';

  // 圆弧（约 300°）
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI * 0.72, Math.PI * 0.72);
  ctx.stroke();

  // 箭头（右端）
  var endAngle = Math.PI * 0.72;
  var ex = cx + r * Math.cos(endAngle);
  var ey = cy + r * Math.sin(endAngle);
  var dirAngle = endAngle + Math.PI / 2; // 切线方向

  ctx.beginPath();
  var aLen = 6;
  ctx.moveTo(
    ex + Math.cos(dirAngle) * aLen,
    ey + Math.sin(dirAngle) * aLen
  );
  ctx.lineTo(ex, ey);
  ctx.lineTo(
    ex + Math.cos(dirAngle + Math.PI * 0.55) * aLen,
    ey + Math.sin(dirAngle + Math.PI * 0.55) * aLen
  );
  ctx.stroke();
}

module.exports = {
  open: open,
  close: close,
  toggle: toggle,
  isOpen: isOpen,
  render: render,
  handleTouch: handleTouch,
  drawGearIcon: drawGearIcon,
};
