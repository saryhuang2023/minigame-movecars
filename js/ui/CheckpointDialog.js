// 推猪消除 — 杀进程恢复确认弹窗（v2 · SettingsPanel 风格）
// 复用设置面板的三宫格背景图 + PopupAnimator spring 弹入/回弹缩回
// 用于启动时发现有存档时询问用户是否恢复

var databus = require('../databus.js');
var Easing = require('../core/Easing.js');
var PopupAnimator = require('./PopupAnimator.js');
var AssetPreloader = require('./AssetPreloader.js');
var Theme = require('../define/GameDefine.js').THEME;

// ===== 继续按钮手绘（3层 Figma 设计，与 SettingsPanel/VictoryPopup 完全一致）=====
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

function _drawContinueBtnBg(ctx, x, y, w, h) {
  ctx.save();

  // === 第1层：深青色外框, #1D6C72, radius 14 ===
  _roundRect(ctx, x, y, w, h, 14);
  ctx.fillStyle = '#1D6C72';
  ctx.fill();

  // === 第2层：青色渐变内框, #00C3D8, radius 12，偏移 (2, 2) ===
  var ix = x + 2;
  var iy = y + 2;
  var iw = w - 4;
  var ih = h - 4;

  _roundRect(ctx, ix, iy, iw, ih, 12);
  ctx.fillStyle = '#00C3D8';
  ctx.fill();

  // 内高光/阴影（clip 到内框）
  _roundRect(ctx, ix, iy, iw, ih, 12);
  ctx.save();
  ctx.clip();

  // inset top: 0px 3px 3px rgba(255,255,255,0.3)
  var tGrad = ctx.createLinearGradient(ix, iy, ix, iy + 4);
  tGrad.addColorStop(0, 'rgba(255, 255, 255, 0.3)');
  tGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = tGrad;
  ctx.fillRect(ix, iy, iw, 5);

  // inset bottom: 0px -4px 0px #0A88B6
  ctx.fillStyle = '#0A88B6';
  ctx.fillRect(ix, iy + ih - 4, iw, 4);

  ctx.restore();  // clip

  // === 第3层：亮青色描边, 1.5px #33D4D7, radius 12 ===
  var sx = x + 2;
  var sy = y + 2;
  var sw = w - 4;
  var sh = h - 7;

  _roundRect(ctx, sx, sy, sw, sh, 12);
  ctx.strokeStyle = '#33D4D7';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  ctx.restore();  // outer save
}

// ===== 面板背景（三宫格，与 SettingsPanel 完全一致）=====
var BG_KEY = 'settings_bg';
var _bgSrcTop = 405;
var _bgSrcMid = 162;
var _bgSrcBottom = 108;
var _bgDstTop = 135;
var _bgDstBottom = 36;

// ===== 章节计算 =====
var _chaptersCache = null;

function _loadChapters() {
  if (_chaptersCache) return _chaptersCache;
  var ch = databus.chapters;
  if (ch && ch.length > 0) {
    _chaptersCache = ch;
    return ch;
  }
  try {
    var raw = wx.getFileSystemManager().readFileSync('assets/levels/chapter.json', 'utf8');
    _chaptersCache = JSON.parse(raw);
  } catch (e) {
    console.warn('[CheckpointDialog] 读取 chapter.json 失败:', e);
    _chaptersCache = [];
  }
  return _chaptersCache;
}

/**
 * 根据全局关卡索引（0-based）反查所属章节编号（1-based）
 */
function _levelIndexToChapter(levelIndex) {
  var chapters = _loadChapters();
  if (!chapters || chapters.length === 0) return 1;
  var prevEnd = -1;
  for (var i = 0; i < chapters.length; i++) {
    var ch = chapters[i];
    var start = prevEnd + 1;
    var end = ch.endIndex;
    if (levelIndex >= start && levelIndex <= end) {
      return (ch.chapter != null ? ch.chapter : i) + 1;
    }
    prevEnd = end;
  }
  return chapters.length; // 超出范围，算最后一章
}

function _drawThreeSlice(ctx, img, x, y, w, h) {
  var sw = img.width;
  var sh = img.height;
  if (!sw || !sh) return;

  var midDstH = h - _bgDstTop - _bgDstBottom;
  if (midDstH < 1) midDstH = 1;

  // 顶部
  ctx.drawImage(img, 0, 0, sw, _bgSrcTop,              x, y, w, _bgDstTop);
  // 中部（拉伸）
  ctx.drawImage(img, 0, _bgSrcTop, sw, _bgSrcMid,      x, y + _bgDstTop, w, midDstH);
  // 底部
  ctx.drawImage(img, 0, sh - _bgSrcBottom, sw, _bgSrcBottom, x, y + h - _bgDstBottom, w, _bgDstBottom);
}

// ===== PopupAnimator 实例 =====
var _animator = PopupAnimator.createPopupAnimator();
var _openStartTime = 0;

// 面板布局数据（仅在面板可见时有效）
var _panel = null;        // { x, y, w, h }
var _ph = 0;
var _cpData = null;       // 存档数据 { steps, levelName, levelIndex }
var _onConfirm = null;
var _onCancel = null;
var _confirmBtnRect = null;
var _cancelBtnRect = null;

// 按钮点击压感动画
var _btnPress = {};

// ===== 布局常量 =====
var PANEL_WIDTH = 289;        // 与 SettingsPanel 统一
var BUTTON_PRESS_DURATION = 100;
var BUTTON_RELEASE_DURATION = 140;

// 按钮尺寸（统一）
var BTN_W = 85;
var BTN_H = 48;
var BTN_GAP = 30;
var BTN_FROM_BOTTOM = 36;

// ===== 公开 API =====

/**
 * 打开存档恢复确认弹窗
 * @param {Object} opts
 * @param {number} opts.steps - 存档中的步数
 * @param {string} opts.levelName - 存档中的关卡名
 * @param {number} opts.levelIndex - 存档中的全局关卡索引（用于反查章节）
 * @param {Function} opts.onConfirm - 用户点击"继续"
 * @param {Function} opts.onCancel - 用户点击"不了"
 */
function open(opts) {
  opts = opts || {};
  _cpData = { steps: opts.steps || 0, levelName: opts.levelName || '', levelIndex: opts.levelIndex != null ? opts.levelIndex : -1 };
  _onConfirm = opts.onConfirm || null;
  _onCancel = opts.onCancel || null;

  // 面板高度：标题区 + 描述区 + 按钮区 + 底部间距
  _ph = 350;
  var cx = databus.screenWidth / 2;
  _panel = {
    x: cx - PANEL_WIDTH / 2,
    y: (databus.screenHeight - _ph) / 2 - 20,
    w: PANEL_WIDTH,
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
  var elapsed = Date.now() - _openStartTime;

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

  // 2. 面板背景图（三宫格，与 SettingsPanel 一致）
  var bgImg = AssetPreloader.get(BG_KEY);
  if (bgImg && AssetPreloader.isReady(BG_KEY)) {
    _drawThreeSlice(ctx, bgImg, p.x, p.y, p.w, p.h);
  }

  // 3. 标题（白字，与 SettingsPanel 完全一致：p.y + 65）
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '20px ' + Theme.font.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillText('发现存档', pCenterX, p.y + 65);

  // 4. 分割线（弱化，半透白）
  var lineY = p.y + 130;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(p.x + 36, lineY);
  ctx.lineTo(p.x + p.w - 36, lineY);
  ctx.stroke();

  // 5. 说明文字（3行，橙色 #E3632D，字号20，垂直居中）
  var li = _cpData && _cpData.levelIndex != null && _cpData.levelIndex >= 0 ? _cpData.levelIndex : -1;
  var chapterNum = li >= 0 ? _levelIndexToChapter(li) : '?';
  var stepsVal = _cpData ? _cpData.steps : '?';
  ctx.fillStyle = '#E3632D';
  ctx.font = '20px ' + Theme.font.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('发现您上次玩到了', pCenterX, p.y + 158);
  ctx.fillText('第' + (li + 1) + '关  第' + stepsVal + '步', pCenterX, p.y + 186);
  ctx.fillText('是否接着玩？', pCenterX, p.y + 214);

  // 6. 按钮行（stagger 入场）
  _renderButtons(ctx, p, isEntering, elapsed);

  ctx.restore();
}

// ===== 按钮行 =====

function _renderButtons(ctx, p, isEntering, elapsed) {
  var totalW = BTN_W * 2 + BTN_GAP;
  var startX = p.x + (p.w - totalW) / 2;
  var btnY = p.y + p.h - BTN_FROM_BOTTOM - BTN_H;

  var openDur = _animator.getOpenDur();
  var staggerDelay = 50;

  // ── "继续游戏" 按钮（左，主操作）──
  var contT = 1;
  if (isEntering) {
    var contElapsed = Math.max(0, elapsed - 0);
    var contRawT = Math.min(contElapsed / Math.max(openDur, 1), 1);
    contT = Easing.spring(contRawT * 3.2, 180, 14);
  }

  if (contT > 0.005) {
    var contAlpha = contT;
    var contScale = 0.5 + 0.5 * contT;
    var cx = startX + BTN_W / 2;
    var cy = btnY + BTN_H / 2;
    var pressScale = _getBtnPressScale('btn_confirm', cx, cy);
    var finalScale = contScale * pressScale;

    ctx.save();
    ctx.globalAlpha = contAlpha;
    ctx.translate(cx, cy);
    ctx.scale(finalScale, finalScale);
    ctx.translate(-cx, -cy);

    _drawContinueBtnBg(ctx, startX, btnY, BTN_W, BTN_H);

    // 文字 "继续"
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '22px ' + Theme.font.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(3, 48, 75, 0.6)';
    ctx.shadowBlur = 2;
    ctx.fillText('继续', cx, cy);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.restore();

    _confirmBtnRect = { x: startX, y: btnY, w: BTN_W, h: BTN_H };
  }

  // ── "不了" 按钮（右，相同样式）──
  var cancelX = startX + BTN_W + BTN_GAP;
  var cancelT = 1;
  if (isEntering) {
    var cancelElapsed = Math.max(0, elapsed - staggerDelay);
    var cancelRawT = Math.min(cancelElapsed / Math.max(openDur - staggerDelay, 1), 1);
    cancelT = Easing.spring(cancelRawT * 3.2, 180, 14);
  }

  if (cancelT > 0.005) {
    var cancelAlpha = cancelT;
    var cancelScale = 0.5 + 0.5 * cancelT;
    var ccx = cancelX + BTN_W / 2;
    var ccy = btnY + BTN_H / 2;
    var cPressScale = _getBtnPressScale('btn_cancel', ccx, ccy);
    var cFinalScale = cancelScale * cPressScale;

    ctx.save();
    ctx.globalAlpha = cancelAlpha;
    ctx.translate(ccx, ccy);
    ctx.scale(cFinalScale, cFinalScale);
    ctx.translate(-ccx, -ccy);

    _drawContinueBtnBg(ctx, cancelX, btnY, BTN_W, BTN_H);

    // 文字 "不了"
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '22px ' + Theme.font.family;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.shadowColor = 'rgba(3, 48, 75, 0.6)';
    ctx.shadowBlur = 2;
    ctx.fillText('不了', ccx, ccy);
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;
    ctx.restore();

    _cancelBtnRect = { x: cancelX, y: btnY, w: BTN_W, h: BTN_H };
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
  if (_animator.getPhase() === 'opening') return true;

  if (type === 'touchstart') {
    // 点"继续"（左）
    if (_confirmBtnRect && x >= _confirmBtnRect.x && x <= _confirmBtnRect.x + _confirmBtnRect.w &&
        y >= _confirmBtnRect.y && y <= _confirmBtnRect.y + _confirmBtnRect.h) {
      _startBtnPress('btn_confirm');
      _onConfirmPressed();
      return true;
    }

    // 点"不了"（右）
    if (_cancelBtnRect && x >= _cancelBtnRect.x && x <= _cancelBtnRect.x + _cancelBtnRect.w &&
        y >= _cancelBtnRect.y && y <= _cancelBtnRect.y + _cancelBtnRect.h) {
      _startBtnPress('btn_cancel');
      _onCancelPressed();
      return true;
    }

    // 点在遮罩上 → 放弃
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
    ['btn_confirm', 'btn_cancel'].forEach(function(k) {
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

module.exports = {
  open: open,
  close: close,
  isOpen: isOpen,
  render: render,
  handleTouch: handleTouch,
};
