// 推猪消除 — 设置面板（v3 · Scale-based spring 弹入/回弹缩回）
// 渲染悬停面板，支持音乐/音效独立开关 + 可选底部功能按钮
// 动画系统：PopupAnimator 驱动 scale spring pop-in / pop-out

var audio = require('../audio/AudioManager.js');
var databus = require('../databus.js');
var Easing = require('../core/Easing.js');
var PopupAnimator = require('./PopupAnimator.js');

// ===== PopupAnimator 实例（替代旧动画状态机）=====
var _animator = PopupAnimator.createPopupAnimator();
var _openStartTime = 0;  // 记录打开开始时间，供 stagger 计算

// 面板布局数据（仅在面板可见时有效）
var _panel = null;           // { x, y, w, h }
var _buttons = null;

// 开关滑块动画
var _toggleMusicTarget = null;  // 目标值（true/false），动画中平滑过渡
var _toggleSfxTarget = null;
var _toggleMusicDisplay = null; // 当前渲染值（0..1），动画完成后 = target
var _toggleSfxDisplay = null;

// 按钮点击压感动画
var _btnPress = {};  // { btnKey: { startTime, phase: 'pressing'|'releasing' } }

// 热区
var _musicRect = null;
var _sfxRect = null;
var _closeRect = null;
var _btnRects = null;

// ===== 布局常量 =====
var PW = 280;
var RADIUS = 20;
var TOGGLE_H = 48;
var LABEL_X = 40;
var TOGGLE_W = 52;
var TOGGLE_H2 = 28;
var TOGGLE_R = 14;
var THUMB_R = 11;
var THUMB_SLIDE = 22;

// ===== 动画参数 =====
var TOGGLE_DURATION = 180;   // 滑块滑动时长
var STAGGER_INTERVAL = 40;   // 底部按钮错开间隔 (ms)
var BUTTON_PRESS_DURATION = 100;  // 按钮按压回弹时长
var BUTTON_RELEASE_DURATION = 140;

// ===== 公开 API =====

function open(opts) {
  opts = opts || {};
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

  // 初始化滑块显示位置（从当前实际状态开始）
  _toggleMusicTarget = audio.isMusicEnabled();
  _toggleSfxTarget = audio.isSfxEnabled();
  _toggleMusicDisplay = _toggleMusicTarget ? 1 : 0;
  _toggleSfxDisplay = _toggleSfxTarget ? 1 : 0;

  // 复位按钮压感
  _btnPress = {};

  // 记录打开时间
  _openStartTime = Date.now();

  // 触发动画
  _animator.open();
}

/**
 * 关闭面板（带弹出动画）。close 按钮/遮罩点击/底部按钮关闭都用这个。
 */
function close() {
  if (_animator.isClosed()) return;
  _btnPress = {};

  _animator.close(function() {
    // 动画结束后清理布局数据
    _panel = null;
    _buttons = null;
    _musicRect = null;
    _sfxRect = null;
    _closeRect = null;
    _btnRects = null;
  });
}

function isOpen() {
  return _animator.isOpen() || _animator.getPhase() === 'opening';
}

function toggle() {
  if (isOpen()) close(); else open();
}

// ===== 高度计算 =====

function _calcPanelHeight() {
  var h = 12; // top padding
  h += 30;    // close button area
  h += 12;    // gap
  h += TOGGLE_H * 2; // two toggle rows
  h += 10;    // padding after toggles

  if (_buttons && _buttons.length > 0) {
    h += 1;  // divider space
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
  if (_animator.isClosed() || !_panel) return;

  // 驱动动画状态机
  var state = _animator.update();

  // 动画结束后的二次守卫
  if (_animator.isClosed() || !_panel) return;

  var p = _panel;
  var cx = p.x + p.w / 2;
  var scale = state.scale;
  var alpha = state.alpha;
  var maskAlpha = state.maskAlpha;
  var phase = _animator.getPhase();
  var isEntering = (phase === 'opening');

  // 1. 半透明遮罩
  if (maskAlpha > 0.005) {
    ctx.fillStyle = 'rgba(0, 0, 0, ' + maskAlpha.toFixed(3) + ')';
    ctx.fillRect(0, 0, databus.screenWidth, databus.screenHeight);
  }

  if (alpha < 0.01) return;

  ctx.save();
  ctx.globalAlpha = alpha;

  // 缩放变换（围绕面板中心）
  var pCenterX = p.x + p.w / 2;
  var pCenterY = p.y + p.h / 2;
  ctx.translate(pCenterX, pCenterY);
  ctx.scale(scale, scale);
  ctx.translate(-pCenterX, -pCenterY);

  // 3. 面板底色 + 阴影
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 10;
  _roundRect(ctx, p.x, p.y, p.w, p.h, RADIUS);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.97)';
  ctx.fill();
  ctx.restore();

  // 4. 关闭按钮
  _renderCloseBtn(ctx);

  // 5. 开关行
  var toggleY = p.y + 56;
  _renderToggle(ctx, cx, toggleY, '\uD83C\uDFB5 \u97F3\u4E50', _toggleMusicDisplay);
  _musicRect = {
    x: p.x, y: toggleY - TOGGLE_H / 2,
    w: p.w, h: TOGGLE_H,
  };

  toggleY += TOGGLE_H;
  _renderToggle(ctx, cx, toggleY, '\uD83D\uDD0A \u97F3\u6548', _toggleSfxDisplay);
  _sfxRect = {
    x: p.x, y: toggleY - TOGGLE_H / 2,
    w: p.w, h: TOGGLE_H,
  };

  // 6. 底部按钮（仅在入场完成或已打开时渲染，错开淡入）
  if (_buttons && _buttons.length > 0) {
    var dividerY = toggleY + TOGGLE_H / 2 + 12;

    // 分割线
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + 24, dividerY);
    ctx.lineTo(p.x + p.w - 24, dividerY);
    ctx.stroke();

    // 按钮行（stagger 入场）
    var btnY = dividerY + 16;
    _renderBottomButtonsStagger(ctx, cx, btnY, isEntering);
  }

  ctx.restore();

  // 更新滑块显示位置（平滑 lerp 到目标值）
  _updateToggleSliders();
}

// ===== 关闭按钮 =====

function _renderCloseBtn(ctx) {
  var p = _panel;
  var closeD = 28;
  var closeX = p.x + p.w - closeD - 14;
  var closeY = p.y + 14;
  var ccx = closeX + closeD / 2;
  var ccy = closeY + closeD / 2;

  _closeRect = { x: closeX - 4, y: closeY - 4, w: closeD + 8, h: closeD + 8 };

  // 按钮压感
  var pressScale = _getBtnPressScale('close', ccx, ccy);

  ctx.save();
  ctx.translate(ccx, ccy);
  ctx.scale(pressScale, pressScale);
  ctx.translate(-ccx, -ccy);

  // 圆形背景
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.08)';
  ctx.shadowBlur = 4;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.arc(ccx, ccy, closeD / 2, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(241, 245, 249, 0.9)';
  ctx.fill();
  ctx.restore();

  // ×
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

  ctx.restore();
}

// ===== 开关渲染 =====

function _renderToggle(ctx, cx, cy, label, displayVal) {
  // displayVal: 0 = Off, 1 = On, 中间值为动画过渡

  // 标签
  ctx.fillStyle = '#0F172A';
  ctx.font = '17px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, cx - PW / 2 + LABEL_X, cy);

  // 开关背景（颜色混合：灰 #CBD5E1 → 粉 #EC4899）
  var swX = cx + PW / 2 - LABEL_X - TOGGLE_W;
  var swY = cy - TOGGLE_H2 / 2;

  // 颜色插值
  var r = Math.round(203 + (236 - 203) * displayVal);
  var g = Math.round(213 + (72  - 213) * displayVal);
  var b = Math.round(225 + (153 - 225) * displayVal);
  ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
  _roundRect(ctx, swX, swY, TOGGLE_W, TOGGLE_H2, TOGGLE_R);
  ctx.fill();

  // 滑块位置（平滑）
  var thumbX = swX + 3 + THUMB_SLIDE * displayVal;

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

function _updateToggleSliders() {
  // 平滑 lerp display → target
  if (_toggleMusicTarget !== null && Math.abs(_toggleMusicDisplay - (_toggleMusicTarget ? 1 : 0)) > 0.005) {
    _toggleMusicDisplay = Easing.lerp(_toggleMusicDisplay, _toggleMusicTarget ? 1 : 0, 0.2);
    if (Math.abs(_toggleMusicDisplay - (_toggleMusicTarget ? 1 : 0)) < 0.005) {
      _toggleMusicDisplay = _toggleMusicTarget ? 1 : 0;
    }
  }

  if (_toggleSfxTarget !== null && Math.abs(_toggleSfxDisplay - (_toggleSfxTarget ? 1 : 0)) > 0.005) {
    _toggleSfxDisplay = Easing.lerp(_toggleSfxDisplay, _toggleSfxTarget ? 1 : 0, 0.2);
    if (Math.abs(_toggleSfxDisplay - (_toggleSfxTarget ? 1 : 0)) < 0.005) {
      _toggleSfxDisplay = _toggleSfxTarget ? 1 : 0;
    }
  }
}

// ===== 底部按钮（stagger 动画） =====

function _renderBottomButtonsStagger(ctx, cx, btnY, isEntering) {
  var bw = 56;
  var bh = 40;
  var midW = 108;
  var gap = 8;

  var icon0X = cx - midW / 2 - gap - bw;
  var midX = cx - midW / 2;
  var icon1X = cx + midW / 2 + gap;

  _btnRects = [];

  // 从 animator 拿到已流逝时间，用于 stagger
  var elapsed = Date.now() - _openStartTime;
  var openDur = _animator.getOpenDur();

  for (var i = 0; i < _buttons.length; i++) {
    var b = _buttons[i];
    var isWide = b.wide;
    var bx = isWide ? midX : (i === 0 ? icon0X : icon1X);
    var bxw = isWide ? midW : bw;

    // Stagger 时间：每个按钮延迟 STAGGER_INTERVAL
    var staggerDelay = i * STAGGER_INTERVAL;
    var btnAnimT = 1; // 默认完全显示

    if (isEntering) {
      var btnElapsed = Math.max(0, elapsed - staggerDelay);
      var btnRawT = Math.min(btnElapsed / (openDur - staggerDelay), 1);
      // 每个按钮独立 spring（比面板略软）
      var springT = Easing.spring(btnRawT * 3.2, 180, 14);
      btnAnimT = springT;
    }

    if (btnAnimT < 0.005) continue;

    var btnAlpha = btnAnimT;
    var btnScale = 0.5 + 0.5 * btnAnimT;  // 从 0.5 缩放弹入

    // 按钮压感
    var bCenterX = bx + bxw / 2;
    var bCenterY = btnY + bh / 2;
    var pressScale = _getBtnPressScale('btn_' + i, bCenterX, bCenterY);
    var finalScale = btnScale * pressScale;

    ctx.save();
    ctx.globalAlpha = btnAlpha;
    ctx.translate(bCenterX, bCenterY);
    ctx.scale(finalScale, finalScale);
    ctx.translate(-bCenterX, -bCenterY);

    if (isWide) {
      // "继续游戏" — 粉色填充 + 微阴影
      ctx.save();
      ctx.shadowColor = 'rgba(236, 72, 153, 0.2)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      _roundRect(ctx, bx, btnY, bxw, bh, 10);
      ctx.fillStyle = '#EC4899';
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 16px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.label || '', bCenterX, bCenterY);
    } else {
      // 图标按钮 — 白底 + 细边框
      ctx.fillStyle = '#FFFFFF';
      _roundRect(ctx, bx, btnY, bxw, bh, 10);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.1)';
      ctx.lineWidth = 1;
      _roundRect(ctx, bx, btnY, bxw, bh, 10);
      ctx.stroke();

      ctx.fillStyle = '#0F172A';
      ctx.font = '20px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(b.icon || '', bCenterX, bCenterY);
    }

    ctx.restore();

    // 记录热区
    _btnRects.push({
      x: bx,
      y: btnY,
      w: bxw,
      h: bh,
      action: b.action,
    });
  }
}

// ===== 按钮压感 =====

function _getBtnPressScale(key, cx, cy) {
  var press = _btnPress[key];
  if (!press) return 1;

  var elapsed = Date.now() - press.startTime;
  if (press.phase === 'pressing') {
    var t = Math.min(elapsed / BUTTON_PRESS_DURATION, 1);
    return 1 - 0.05 * Easing.easeOutCubic(t);
  } else {
    var t2 = Math.min(elapsed / BUTTON_RELEASE_DURATION, 1);
    var s = 0.95 + 0.05 * Easing.easeOutBack(t2, 1.5);
    if (t2 >= 1) {
      delete _btnPress[key];
    }
    return s;
  }
}

function _startBtnPress(key) {
  _btnPress[key] = { startTime: Date.now(), phase: 'pressing' };
}

function _releaseBtnPress(key) {
  if (_btnPress[key]) {
    _btnPress[key] = { startTime: Date.now(), phase: 'releasing' };
  }
}

// ===== 触控处理 =====

function handleTouch(x, y, type) {
  if (_animator.isClosed()) return false;
  if (_animator.getPhase() === 'opening') return true; // 动画中消费事件但不响应

  if (type === 'touchstart') {
    // 点关闭按钮
    if (_closeRect && x >= _closeRect.x && x <= _closeRect.x + _closeRect.w &&
        y >= _closeRect.y && y <= _closeRect.y + _closeRect.h) {
      _startBtnPress('close');
      close();
      return true;
    }

    // 点音乐开关
    if (_musicRect && x >= _musicRect.x && x <= _musicRect.x + _musicRect.w &&
        y >= _musicRect.y && y <= _musicRect.y + _musicRect.h) {
      var newVal = !audio.isMusicEnabled();
      audio.setMusicEnabled(newVal);
      _toggleMusicTarget = newVal;
      return true;
    }

    // 点音效开关
    if (_sfxRect && x >= _sfxRect.x && x <= _sfxRect.x + _sfxRect.w &&
        y >= _sfxRect.y && y <= _sfxRect.y + _sfxRect.h) {
      var newSfx = !audio.isSfxEnabled();
      audio.setSfxEnabled(newSfx);
      _toggleSfxTarget = newSfx;
      return true;
    }

    // 点底部按钮
    if (_btnRects) {
      for (var i = 0; i < _btnRects.length; i++) {
        var r = _btnRects[i];
        if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
          _startBtnPress('btn_' + i);
          if (r.action) r.action();
          return true;
        }
      }
    }

    // 点在遮罩上 → 关闭
    if (_panel) {
      var px = _panel.x, py = _panel.y, pw = _panel.w, ph = _panel.h;
      if (x < px || x > px + pw || y < py || y > py + ph) {
        close();
        return true;
      }
    }

    return true; // 面板内但不命中按钮：消费但不做任何操作
  }

  return type === 'touchstart' || type === 'touchend' || type === 'touchmove';
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

function drawGearIcon(ctx, cx, cy, r, color) {
  var teethR = r * 0.15;
  var bodyR = r * 0.78;
  var innerR = r * 0.28;
  var teethCount = 8;

  for (var i = 0; i < teethCount; i++) {
    var angle = Math.PI * 2 * i / teethCount - Math.PI / 2;
    var tx = cx + Math.cos(angle) * bodyR;
    var ty = cy + Math.sin(angle) * bodyR;
    ctx.beginPath();
    ctx.arc(tx, ty, teethR, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }

  ctx.beginPath();
  ctx.arc(cx, cy, bodyR, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();

  ctx.beginPath();
  ctx.arc(cx, cy, innerR, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fill();
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
