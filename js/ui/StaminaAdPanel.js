// StaminaAdPanel — 体力不足广告面板
// UI 样式和布局与"发现存档"弹窗（CheckpointDialog）完全一致
// 三宫格背景 + PopupAnimator + 手绘按钮 + 20px 说明文字

var Theme = require('../define/GameDefine.js').THEME;
var Easing = require('../core/Easing.js');
var PopupAnimator = require('./PopupAnimator.js');
var AssetPreloader = require('./AssetPreloader.js');
var audio = require('../audio/AudioManager.js');
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');

// ===== 手绘按钮（与 CheckpointDialog 完全一致） =====
function _roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

function _drawBtnBg(ctx, x, y, w, h) {
  ctx.save();
  _roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = '#1D6C72'; ctx.fill();
  var ix = x + 2, iy = y + 2, iw = w - 4, ih = h - 4;
  _roundRect(ctx, ix, iy, iw, ih, 12);
  ctx.fillStyle = '#00C3D8'; ctx.fill();
  _roundRect(ctx, ix, iy, iw, ih, 12);
  ctx.save(); ctx.clip();
  var tGrad = ctx.createLinearGradient(ix, iy, ix, iy + 4);
  tGrad.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
  tGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = tGrad; ctx.fillRect(ix, iy, iw, 5);
  ctx.fillStyle = '#0A88B6'; ctx.fillRect(ix, iy + ih - 4, iw, 4);
  ctx.restore();
  var sx = x + 2, sy = y + 2, sw = w - 4, sh = h - 7;
  _roundRect(ctx, sx, sy, sw, sh, 12);
  ctx.strokeStyle = '#33D4D7'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.restore();
}

// ===== 三宫格背景 =====
var BG_KEY = 'settings_bg';
var _bgSrcTop = 405;
var _bgSrcMid = 162;
var _bgSrcBottom = 108;
var _bgDstTop = 135;
var _bgDstBottom = 36;

function _drawThreeSlice(ctx, img, x, y, w, h) {
  var sw = img.width; var sh = img.height;
  if (!sw || !sh) return;
  var midDstH = h - _bgDstTop - _bgDstBottom;
  if (midDstH < 1) midDstH = 1;
  ctx.drawImage(img, 0, 0, sw, _bgSrcTop,              x, y, w, _bgDstTop);
  ctx.drawImage(img, 0, _bgSrcTop, sw, _bgSrcMid,      x, y + _bgDstTop, w, midDstH);
  ctx.drawImage(img, 0, sh - _bgSrcBottom, sw, _bgSrcBottom, x, y + h - _bgDstBottom, w, _bgDstBottom);
}

// ===== 状态 =====
var _animator = PopupAnimator.createPopupAnimator();
var _openStartTime = 0;
var _panel = null;
var _remaining = 0;
var _onAdClick = null;
var _adBtnRect = null;
var _btnPress = {};
var _mode = 'ad';  // 'ad' | 'noAds'

// ===== 布局常量（与 CheckpointDialog 完全一致） =====
var PANEL_WIDTH = 289;
var PANEL_HEIGHT = 350;
var BTN_W = 85;
var BTN_H = 48;
var BTN_FROM_BOTTOM = 36;
var BUTTON_PRESS_DURATION = 100;
var BUTTON_RELEASE_DURATION = 140;

// ===== 公开 API =====

function open(remaining, onAdClick) {
  _mode = 'ad';
  _remaining = remaining;
  _onAdClick = onAdClick;
  _btnPress = {};
  _adBtnRect = null;

  var cx = SCREEN_WIDTH / 2;
  _panel = {
    x: cx - PANEL_WIDTH / 2,
    y: (SCREEN_HEIGHT - PANEL_HEIGHT) / 2 - 20,
    w: PANEL_WIDTH,
    h: PANEL_HEIGHT,
  };
  _openStartTime = Date.now();
  _animator.open();
}

/** 广告次数已用完（无领取按钮，仅提示） */
function openNoAds() {
  _mode = 'noAds';
  _onAdClick = null;
  _btnPress = {};
  _adBtnRect = null;
  var cx = SCREEN_WIDTH / 2;
  _panel = {
    x: cx - PANEL_WIDTH / 2,
    y: (SCREEN_HEIGHT - PANEL_HEIGHT) / 2 - 20,
    w: PANEL_WIDTH,
    h: PANEL_HEIGHT,
  };
  _openStartTime = Date.now();
  _animator.open();
}

function close() {
  _animator.close(function () {
    _panel = null;
    _onAdClick = null;
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
  var pcx = p.x + p.w / 2;
  var scale = state.scale;
  var alpha = state.alpha;
  var maskAlpha = state.maskAlpha;
  var phase = _animator.getPhase();
  var isEntering = (phase === 'opening');
  var elapsed = Date.now() - _openStartTime;

  // 遮罩
  if (maskAlpha > 0.005) {
    ctx.fillStyle = 'rgba(0, 0, 0, ' + maskAlpha.toFixed(3) + ')';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  }
  if (alpha < 0.01) return;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(pcx, p.y + p.h / 2);
  ctx.scale(scale, scale);
  ctx.translate(-pcx, -(p.y + p.h / 2));

  // 三宫格背景
  var bgImg = AssetPreloader.get(BG_KEY);
  if (bgImg && AssetPreloader.isReady(BG_KEY)) {
    _drawThreeSlice(ctx, bgImg, p.x, p.y, p.w, p.h);
  }

  // 标题
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '20px ' + Theme.font.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('免费领体力', pcx, p.y + 65);

  // 分割线
  var lineY = p.y + 130;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x + 36, lineY);
  ctx.lineTo(p.x + p.w - 36, lineY);
  ctx.stroke();

  // 说明文字（3 行，橙色 #E3632D，20px，与 CheckpointDialog 完全一致）
  ctx.fillStyle = '#E3632D';
  ctx.font = '20px ' + Theme.font.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (_mode === 'noAds') {
    ctx.fillText('今日领取次数已用完', pcx, p.y + 158);
    ctx.fillText('明天再来吧', pcx, p.y + 186);
    ctx.fillText('', pcx, p.y + 214);
  } else {
    ctx.fillText('您可以免费领取1个体力', pcx, p.y + 158);
    ctx.fillText('今日剩余 ' + _remaining + ' 次', pcx, p.y + 186);
    ctx.fillText('是否领取？', pcx, p.y + 214);
  }

  // 按钮
  _renderBtn(ctx, p, isEntering, elapsed);

  ctx.restore();
}

function _renderBtn(ctx, p, isEntering, elapsed) {
  var btnX = p.x + (p.w - BTN_W) / 2;
  var btnY = p.y + p.h - BTN_FROM_BOTTOM - BTN_H;
  var cx = btnX + BTN_W / 2;
  var cy = btnY + BTN_H / 2;

  var openDur = _animator.getOpenDur();
  var t = 1;
  if (isEntering) {
    var rawT = Math.min(elapsed / Math.max(openDur, 1), 1);
    t = Easing.spring(rawT * 3.2, 180, 14);
  }
  if (t < 0.005) return;

  var pressScale = _getBtnPressScale('btn_ad', cx, cy);
  var finalScale = t * pressScale;

  ctx.save();
  ctx.globalAlpha = t;
  ctx.translate(cx, cy);
  ctx.scale(finalScale, finalScale);
  ctx.translate(-cx, -cy);

  _drawBtnBg(ctx, btnX, btnY, BTN_W, BTN_H);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = '22px ' + Theme.font.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(3, 48, 75, 0.6)';
  ctx.shadowBlur = 2;
  ctx.fillText(_mode === 'noAds' ? '好的' : '领取', cx, cy);
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.restore();

  _adBtnRect = { x: btnX, y: btnY, w: BTN_W, h: BTN_H };
}

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
    if (t2 >= 1) delete _btnPress[key];
    return s;
  }
}

// ===== 触碰 =====

function handleTouch(x, y, type) {
  if (_animator.isClosed()) return false;
  if (_animator.getPhase() === 'opening') return true;

  if (type === 'touchstart') {
    if (_adBtnRect && x >= _adBtnRect.x && x <= _adBtnRect.x + _adBtnRect.w &&
        y >= _adBtnRect.y && y <= _adBtnRect.y + _adBtnRect.h) {
      _btnPress.btn_ad = { startTime: Date.now(), phase: 'pressing' };
      audio.play('button_click');
      if (_mode === 'noAds') {
        close();
      } else {
        var cb = _onAdClick;
        close();
        if (cb) cb();
      }
      return true;
    }
    // 点遮罩 → 关闭
    if (_panel) {
      if (x < _panel.x || x > _panel.x + _panel.w || y < _panel.y || y > _panel.y + _panel.h) {
        close();
        return true;
      }
    }
    return true;
  }

  if (type === 'touchend') {
    _btnPress.btn_ad = { startTime: Date.now(), phase: 'releasing' };
    return true;
  }
  return true;
}

module.exports = { open: open, openNoAds: openNoAds, close: close, isOpen: isOpen, render: render, handleTouch: handleTouch };
