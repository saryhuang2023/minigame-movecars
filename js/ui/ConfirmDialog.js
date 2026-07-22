// 推猪消除 — 通用确认/提示窗（统一使用「设置」同款窗体与布局）
// 全屏 rgba(0,0,0,0.5) 遮罩 + settings_bg 三宫格 + 白标题 + 深色自动换行文案 + 底部双钮
// 入场动画：scale 0.6→1 + alpha 0→1（PopupAnimator，easeOutCubic，约 350ms）
//
// 用法：
//   ConfirmDialog.open({
//     title: '删除这条记录？',
//     content: '删除后将无法恢复。',   // 支持 \n 多段，自动按宽度折行
//     confirmText: '删除',
//     cancelText: '取消',
//     confirmColor: 'red',            // CommonButton 配色：gold | red | blue
//     showCancel: true,
//     maskClosable: false,            // 点遮罩是否触发取消
//     onConfirm: function () { ... },
//     onCancel: function () { ... },
//   });
// 每帧渲染前 ConfirmDialog.render(ctx)；触控时 ConfirmDialog.handleEvent(e)（e={type,x,y}）

var Easing = require('../core/Easing.js');
var AssetPreloader = require('./AssetPreloader.js');
var PopupAnimator = require('./PopupAnimator.js');
var Theme = require('../define/GameDefine.js').THEME;
var databus = require('../databus.js');

// ===== 背景图 key（与设置面板共用，需在启动时预加载）=====
var BG_KEY = 'settings_bg';
var _bgSrcTop = 405;      // 三宫格源区域（@3x）：top 135×3
var _bgSrcMid = 162;      // mid 54×3
var _bgSrcBottom = 108;   // bottom 36×3
var _bgDstTop = 135;      // 目标区域（@1x）
var _bgDstBottom = 36;

function _drawThreeSlice(ctx, img, x, y, w, h) {
  var sw = img.width;
  var sh = img.height;
  if (!sw || !sh) return;

  var midDstH = h - _bgDstTop - _bgDstBottom;
  if (midDstH < 1) midDstH = 1;

  ctx.drawImage(img, 0, 0, sw, _bgSrcTop,                       x, y, w, _bgDstTop);
  ctx.drawImage(img, 0, _bgSrcTop, sw, _bgSrcMid,               x, y + _bgDstTop, w, midDstH);
  ctx.drawImage(img, 0, sh - _bgSrcBottom, sw, _bgSrcBottom,    x, y + h - _bgDstBottom, w, _bgDstBottom);
}

function _roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, Math.floor(w / 2), Math.floor(h / 2));
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

// ===== 按钮配色（圆角渐变 + 上亮下暗内阴影 + 描边 + 居中文字）=====
var BTN_PRESETS = {
  gray: {
    gradTop: '#ECE8F2', gradBottom: '#D2CBE0', border: '#9A8FB0',
    shadowTop: '#FFFFFF', shadowBottom: '#B7AECB', textColor: '#5A4A6A',
  },
  blue: {
    gradTop: '#48EEFF', gradBottom: '#34AAD6', border: '#008590',
    shadowTop: '#76FDFF', shadowBottom: '#1A98BE', textColor: '#FFFFFF',
  },
  red: {
    gradTop: '#FE9368', gradBottom: '#FD3919', border: '#733C29',
    shadowTop: '#FFCCB6', shadowBottom: '#D90000', textColor: '#FFFFFF',
  },
  gold: {
    gradTop: '#FFD640', gradBottom: '#FF8925', border: '#733C29',
    shadowTop: '#FFFF5A', shadowBottom: '#D96E00', textColor: '#FFFFFF',
  },
};

function _drawDialogButton(ctx, rect, text, colorKey) {
  var cfg = BTN_PRESETS[colorKey] || BTN_PRESETS.gray;
  var x = rect.x, y = rect.y, w = rect.w, h = rect.h, r = 14;
  var cx = x + w / 2, cy = y + h / 2;

  // 按压缩放
  var scale = 1;
  if (_pressBtn === rect._key) {
    var t = Math.min((Date.now() - _pressStart) / 100, 1);
    scale = 1 - 0.06 * Easing.easeOutCubic(t);
  }
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-cx, -cy);

  // 1. 底色渐变
  var grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, cfg.gradTop);
  grad.addColorStop(1, cfg.gradBottom);
  ctx.fillStyle = grad;
  _roundRect(ctx, x, y, w, h, r);
  ctx.fill();

  // 2. 上内阴影（亮）
  ctx.save();
  _roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.fillStyle = cfg.shadowTop;
  ctx.fillRect(x, y, w, 4);
  ctx.restore();

  // 3. 下内阴影（暗）
  ctx.save();
  _roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  ctx.fillStyle = cfg.shadowBottom;
  ctx.fillRect(x, y + h - 4, w, 4);
  ctx.restore();

  // 4. 描边
  ctx.strokeStyle = cfg.border;
  ctx.lineWidth = 2;
  _roundRect(ctx, x, y, w, h, r);
  ctx.stroke();

  // 5. 文字
  ctx.fillStyle = cfg.textColor;
  ctx.font = '20px ' + (Theme.font && Theme.font.family ? Theme.font.family : 'sans-serif');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, cx, cy);

  ctx.restore();
}

// ===== 文字自动折行（支持 \n 多段，逐字符换行，兼容中文）=====
function _wrapText(ctx, text, maxWidth) {
  var paras = String(text == null ? '' : text).split('\n');
  var lines = [];
  for (var pi = 0; pi < paras.length; pi++) {
    var para = paras[pi];
    if (para === '') { lines.push(''); continue; }
    var cur = '';
    for (var ci = 0; ci < para.length; ci++) {
      var ch = para[ci];
      var test = cur + ch;
      if (cur !== '' && ctx.measureText(test).width > maxWidth) {
        lines.push(cur);
        cur = ch;
      } else {
        cur = test;
      }
    }
    if (cur !== '') lines.push(cur);
  }
  return lines;
}

// ===== 状态 =====
var _animator = PopupAnimator.createPopupAnimator();
var _opts = null;
var _panel = null;
var _btnCancel = null;   // { x, y, w, h, _key }
var _btnConfirm = null;
var _pressBtn = null;    // 'cancel' | 'confirm' | null
var _pressStart = 0;
var _contentLines = null;
var _contentKey = null;
var _fired = false;      // 防止重复触发回调

// ===== 布局常量 =====
var PANEL_WIDTH = 289;
var TITLE_TOP = 65;
var TITLE_H = 28;
var CONTENT_TOP = TITLE_TOP + TITLE_H + 16;   // 109
var LINE_H = 26;
var CONTENT_BOTTOM_GAP = 24;
var BTN_H = 44;
var BTN_BOTTOM = 28;

function _layout(ph) {
  var cx = databus.screenWidth / 2;
  _panel = {
    x: cx - PANEL_WIDTH / 2,
    y: (databus.screenHeight - ph) / 2 - 20,
    w: PANEL_WIDTH,
    h: ph,
  };

  var btnW = 110;
  var gap = 20;
  var totalW = btnW * 2 + gap;
  var startX = _panel.x + (_panel.w - totalW) / 2;
  var by = _panel.y + _panel.h - BTN_BOTTOM - BTN_H;

  _btnCancel = { x: startX, y: by, w: btnW, h: BTN_H, _key: 'cancel' };
  _btnConfirm = { x: startX + btnW + gap, y: by, w: btnW, h: BTN_H, _key: 'confirm' };
}

function open(opts) {
  opts = opts || {};
  _opts = {
    title: opts.title || '',
    content: opts.content || '',
    confirmText: opts.confirmText || '确定',
    cancelText: opts.cancelText || '取消',
    confirmColor: opts.confirmColor || 'blue',
    showCancel: opts.showCancel !== false,
    maskClosable: !!opts.maskClosable,
    onConfirm: opts.onConfirm || null,
    onCancel: opts.onCancel || null,
  };
  _fired = false;
  _pressBtn = null;

  // 先按默认高度布局；render 中按实际折行行数重算高度
  _contentLines = null;
  _contentKey = null;
  _layout(249);

  _animator.open();
}

function close() {
  if (_animator.isClosed()) return;
  _pressBtn = null;
  _animator.close(function () {
    _opts = null;
    _panel = null;
    _btnCancel = null;
    _btnConfirm = null;
    _contentLines = null;
    _contentKey = null;
  });
}

function isOpen() {
  return _animator.isOpen() || _animator.getPhase() === 'opening';
}

// ===== 渲染 =====
function render(ctx) {
  if (_animator.isClosed() || !_panel || !_opts) return;

  var state = _animator.update();
  if (_animator.isClosed() || !_panel || !_opts) return;

  var p = _panel;
  var cx = p.x + p.w / 2;
  var scale = state.scale;
  var alpha = state.alpha;
  var maskAlpha = state.maskAlpha;

  // 1. 半透明遮罩
  if (maskAlpha > 0.005) {
    ctx.fillStyle = 'rgba(0, 0, 0, ' + maskAlpha.toFixed(3) + ')';
    ctx.fillRect(0, 0, databus.screenWidth, databus.screenHeight);
  }
  if (alpha < 0.01) return;

  // 计算内容折行（按当前字体测量）
  var contentKey = (_opts.content || '') + '|' + p.w;
  if (_contentKey !== contentKey || !_contentLines) {
    ctx.font = '18px ' + (Theme.font && Theme.font.family ? Theme.font.family : 'sans-serif');
    _contentLines = _wrapText(ctx, _opts.content, p.w - 56);
    _contentKey = contentKey;
    // 按行数重算面板高度并重排
    var nLines = Math.max(1, _contentLines.length);
    var ph = CONTENT_TOP + nLines * LINE_H + CONTENT_BOTTOM_GAP + BTN_H + BTN_BOTTOM;
    _layout(ph);
    p = _panel;
    cx = p.x + p.w / 2;
  }

  ctx.save();
  ctx.globalAlpha = alpha;

  // 缩放变换（围绕面板中心）
  var pCenterX = p.x + p.w / 2;
  var pCenterY = p.y + p.h / 2;
  ctx.translate(pCenterX, pCenterY);
  ctx.scale(scale, scale);
  ctx.translate(-pCenterX, -pCenterY);

  // 2. 面板背景（三宫格）
  var bgImg = AssetPreloader.get(BG_KEY);
  if (bgImg && AssetPreloader.isReady(BG_KEY)) {
    _drawThreeSlice(ctx, bgImg, p.x, p.y, p.w, p.h);
  }

  // 3. 标题（白字）
  if (_opts.title) {
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '20px ' + (Theme.font && Theme.font.family ? Theme.font.family : 'sans-serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText(_opts.title, cx, p.y + TITLE_TOP);
  }

  // 4. 内容文案（深色自动换行，居中）
  if (_contentLines && _contentLines.length) {
    ctx.fillStyle = '#5A4A6A';
    ctx.font = '18px ' + (Theme.font && Theme.font.family ? Theme.font.family : 'sans-serif');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    var cy = p.y + CONTENT_TOP;
    for (var i = 0; i < _contentLines.length; i++) {
      ctx.fillText(_contentLines[i], cx, cy);
      cy += LINE_H;
    }
  }

  // 5. 底部按钮
  if (_opts.showCancel && _btnCancel) {
    _drawDialogButton(ctx, _btnCancel, _opts.cancelText, 'gray');
  }
  if (_btnConfirm) {
    _drawDialogButton(ctx, _btnConfirm, _opts.confirmText, _opts.confirmColor);
  }

  ctx.restore();
}

// ===== 触控处理（e = { type, x, y }）=====
function handleEvent(e) {
  if (_animator.isClosed()) return false;
  // 注：入场动画纯视觉，不拦截输入；命中检测基于最终布局坐标，弹窗一出现即可点。
  if (!e || !_panel) return false;

  // 兼容不同事件形态：优先取归一化 x/y，回退到 touches/changedTouches
  var x = e.x, y = e.y;
  if (x == null || y == null) {
    var t0 = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    if (t0) { x = t0.x; y = t0.y; }
  }
  if (x == null || y == null) return false;

  var type = e.type;

  if (type === 'touchstart') {
    if (_opts.showCancel && _btnCancel &&
        x >= _btnCancel.x && x <= _btnCancel.x + _btnCancel.w &&
        y >= _btnCancel.y && y <= _btnCancel.y + _btnCancel.h) {
      _pressBtn = 'cancel';
      _pressStart = Date.now();
      return true;
    }
    if (_btnConfirm &&
        x >= _btnConfirm.x && x <= _btn_right(_btnConfirm) &&
        y >= _btnConfirm.y && y <= _btnConfirm.y + _btnConfirm.h) {
      _pressBtn = 'confirm';
      _pressStart = Date.now();
      return true;
    }
    // 点遮罩（面板外）
    if (_opts.maskClosable) {
      if (x < _panel.x || x > _panel.x + _panel.w || y < _panel.y || y > _panel.y + _panel.h) {
        var cb = _opts.onCancel;
        close();
        if (cb) cb();
        return true;
      }
    }
    return true; // 面板内不命中按钮：消费事件
  }

  if (type === 'touchend') {
    // 以 touchstart 阶段按下的按钮为准触发，不再在抬起时重新判定命中区域，
    // 避免真机手指微抖导致抬起时偏出按钮（110×44）而失效。
    var firedBtn = _pressBtn;
    _pressBtn = null;
    if (!firedBtn || _fired) return true;
    _fired = true;
    if (firedBtn === 'cancel' && _opts.showCancel) {
      var ccb = _opts.onCancel;
      close();
      if (ccb) ccb();
    } else if (firedBtn === 'confirm') {
      var cf = _opts.onConfirm;
      close();
      if (cf) cf();
    }
    return true;
  }

  // touchmove 等：面板打开时消费
  return type === 'touchstart' || type === 'touchend' || type === 'touchmove';
}

function _btn_right(b) { return b.x + b.w; }

module.exports = {
  open: open,
  close: close,
  isOpen: isOpen,
  render: render,
  handleEvent: handleEvent,
};
