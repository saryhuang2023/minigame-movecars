// 推猪消除 — 杀进程恢复确认弹窗
// 与设置面板相同风格：白底面板 + PopupAnimator spring 弹入/回弹缩回
// 用于启动时发现有存档时询问用户是否恢复

var databus = require('../databus.js');
var Easing = require('../core/Easing.js');
var PopupAnimator = require('./PopupAnimator.js');
var Theme = require('./Theme.js');

// ===== PopupAnimator 实例 =====
var _animator = PopupAnimator.createPopupAnimator();
var _openStartTime = 0;

// 面板布局数据（仅在面板可见时有效）
var _panel = null;        // { x, y, w, h }
var _ph = 0;             // 实际高度
var _cpData = null;       // 存档数据 { steps, levelName }
var _onConfirm = null;    // 恢复回调
var _onCancel = null;     // 不恢复回调
var _confirmBtnRect = null;
var _cancelBtnRect = null;

// 按钮点击压感动画
var _btnPress = {};

// ===== 布局常量 =====
var PW = 280;
var RADIUS = 20;
var BUTTON_PRESS_DURATION = 100;
var BUTTON_RELEASE_DURATION = 140;

// ===== 公开 API =====

/**
 * 打开存档恢复确认弹窗
 * @param {Object} opts
 * @param {number} opts.steps - 存档中的步数
 * @param {string} opts.levelName - 存档中的关卡名
 * @param {Function} opts.onConfirm - 用户点击"恢复"
 * @param {Function} opts.onCancel - 用户点击"不恢复"
 */
function open(opts) {
  opts = opts || {};
  _cpData = { steps: opts.steps || 0, levelName: opts.levelName || '' };
  _onConfirm = opts.onConfirm || null;
  _onCancel = opts.onCancel || null;

  // 计算面板高度（标题 + 说明 + 按钮）
  _ph = 170;
  var cx = databus.screenWidth / 2;
  _panel = {
    x: cx - PW / 2,
    y: (databus.screenHeight - _ph) / 2 - 20,
    w: PW,
    h: _ph,
  };

  // 复位按钮压感
  _btnPress = {};

  // 记录打开时间
  _openStartTime = Date.now();

  // 触发动画
  _animator.open();
}

function close() {
  if (_animator.isClosed()) return;
  _btnPress = {};

  _animator.close(function() {
    _panel = null;
    _cpData = null;
    _onConfirm = null;
    _onCancel = null;
    _confirmBtnRect = null;
    _cancelBtnRect = null;
  });
}

function isOpen() {
  return _animator.isOpen() || _animator.getPhase() === 'opening';
}

// ===== 渲染 =====

function render(ctx) {
  if (_animator.isClosed() || !_panel) return;

  var state = _animator.update();
  if (_animator.isClosed() || !_panel) return;

  var p = _panel;
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

  // 2. 面板底色 + 阴影
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.22)';
  ctx.shadowBlur = 30;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 10;
  _roundRect(ctx, p.x, p.y, p.w, p.h, RADIUS);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.97)';
  ctx.fill();
  ctx.restore();

  // 3. 标题
  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 20px ' + Theme.font.family + '';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('发现存档', databus.screenWidth / 2, p.y + 46);

  // 5. 说明文字
  var levelNum = _cpData && _cpData.levelName ? parseInt(_cpData.levelName, 10) : '?';
  var stepsText = '您上次玩到了第 ' + levelNum + ' 关第 ' + (_cpData ? _cpData.steps : '?') + ' 步，是否继续？';
  ctx.fillStyle = '#64748B';
  ctx.font = '15px ' + Theme.font.family + '';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(stepsText, databus.screenWidth / 2, p.y + 82);

  // 6. 按钮行（stagger 入场）
  _renderButtons(ctx, p, isEntering);

  ctx.restore();
}

// ===== 按钮行 =====

function _renderButtons(ctx, p, isEntering) {
  var btnW = 100;
  var btnH = 44;
  var gap = 16;
  var totalW = btnW * 2 + gap;
  var startX = p.x + (p.w - totalW) / 2;
  var btnY = p.y + 110;

  // Stagger 时间
  var elapsed = Date.now() - _openStartTime;
  var openDur = _animator.getOpenDur();
  var staggerDelay = 40;

  for (var i = 0; i < 2; i++) {
    var bx = startX + i * (btnW + gap);
    var isConfirm = (i === 0);

    // Stagger 入场
    var btnAnimT = 1;
    if (isEntering) {
      var btnElapsed = Math.max(0, elapsed - i * staggerDelay);
      var btnRawT = Math.min(btnElapsed / (openDur - i * staggerDelay), 1);
      var springT = Easing.spring(btnRawT * 3.2, 180, 14);
      btnAnimT = springT;
    }

    if (btnAnimT < 0.005) continue;

    var btnAlpha = btnAnimT;
    var btnScale = 0.5 + 0.5 * btnAnimT;
    var bCenterX = bx + btnW / 2;
    var bCenterY = btnY + btnH / 2;
    var pressScale = _getBtnPressScale('btn_' + i, bCenterX, bCenterY);
    var finalScale = btnScale * pressScale;

    ctx.save();
    ctx.globalAlpha = btnAlpha;
    ctx.translate(bCenterX, bCenterY);
    ctx.scale(finalScale, finalScale);
    ctx.translate(-bCenterX, -bCenterY);

    if (isConfirm) {
      // "恢复" — 粉色填充
      ctx.save();
      ctx.shadowColor = 'rgba(236, 72, 153, 0.2)';
      ctx.shadowBlur = 8;
      ctx.shadowOffsetY = 2;
      _roundRect(ctx, bx, btnY, btnW, btnH, 12);
      ctx.fillStyle = '#EC4899';
      ctx.fill();
      ctx.restore();

      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 16px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('继续', bCenterX, bCenterY);
      _confirmBtnRect = { x: bx, y: btnY, w: btnW, h: btnH };
    } else {
      // "不恢复" — 白底 + 细边框
      ctx.fillStyle = '#FFFFFF';
      _roundRect(ctx, bx, btnY, btnW, btnH, 12);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1.5;
      _roundRect(ctx, bx, btnY, btnW, btnH, 12);
      ctx.stroke();

      ctx.fillStyle = '#0F172A';
      ctx.font = 'bold 16px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('放弃', bCenterX, bCenterY);
      _cancelBtnRect = { x: bx, y: btnY, w: btnW, h: btnH };
    }

    ctx.restore();
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
    // 点"继续"（左边）
    if (_confirmBtnRect && x >= _confirmBtnRect.x && x <= _confirmBtnRect.x + _confirmBtnRect.w &&
        y >= _confirmBtnRect.y && y <= _confirmBtnRect.y + _confirmBtnRect.h) {
      _startBtnPress('btn_0');
      _onConfirmPressed();
      return true;
    }

    // 点"放弃"（右边）
    if (_cancelBtnRect && x >= _cancelBtnRect.x && x <= _cancelBtnRect.x + _cancelBtnRect.w &&
        y >= _cancelBtnRect.y && y <= _cancelBtnRect.y + _cancelBtnRect.h) {
      _startBtnPress('btn_1');
      _onCancelPressed();
      return true;
    }

    // 点在遮罩上 → 不恢复
    if (_panel) {
      var px = _panel.x, py = _panel.y, pw = _panel.w, ph = _panel.h;
      if (x < px || x > px + pw || y < py || y > py + ph) {
        _onCancelPressed();
        return true;
      }
    }

    return true;
  }

  if (type === 'touchend') {
    // 释放所有按钮压感
    ['btn_0', 'btn_1'].forEach(function(k) {
      _releaseBtnPress(k);
    });
    return true;
  }

  return true;
}

function _onConfirmPressed() {
  var cb = _onConfirm;
  close();
  if (cb) cb();
}

function _onCancelPressed() {
  var cb = _onCancel;
  close();
  if (cb) cb();
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

module.exports = {
  open: open,
  close: close,
  isOpen: isOpen,
  render: render,
  handleTouch: handleTouch,
};
