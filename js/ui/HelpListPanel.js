// 场外求助：求助记录列表（主菜单「求助记录」入口）
// 展示本人发起的求助：关卡 / 状态 / 协助者回放 / 续转（≤3 人）。
// 复用 SettingsPanel 的 open / render / handleEvent 接口，由 GameEngine 路由菜单触控。

const cloud = require('../cloud.js');
const databus = require('../databus.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const Theme = require('../define/GameDefine.js').THEME;
const PopupAnimator = require('./PopupAnimator.js').createPopupAnimator;

var _animator = PopupAnimator();
var _items = [];          // 云端返回的求助列表（已剔除大字段）
var _loading = false;
var _empty = false;
var _btns = [];           // 当前帧可点击区 [{ x,y,w,h, action, hk, idx }]
var _closeRect = null;
var _scrollY = 0;         // 简易纵向滚动偏移（列表超出可视高度时）

function _statusText(it) {
  if (it.status === 'expired') return '已过期';
  if (it.status === 'full') return '已满员';
  var n = (it.assists && it.assists.length) || 0;
  return '求助中 (' + n + '/3)';
}

function open() {
  _animator.open();
  _loading = true;
  _empty = false;
  _items = [];
  _btns = [];
  cloud.listMyHelpRequests().then(function (res) {
    _loading = false;
    if (!res || res.code !== 0 || !res.list) { _empty = true; return; }
    _items = res.list || [];
    _empty = _items.length === 0;
  }).catch(function (e) {
    _loading = false;
    _empty = true;
    console.warn('[HelpList] 拉取失败:', e && e.message);
  });
}

function close() {
  _animator.close();
}

function isOpen() {
  return _animator.isOpen() || _animator.getPhase() === 'opening';
}

function _rowH() { return 104; }
function _panelRect() {
  var w = Math.min(SCREEN_WIDTH - 32, 420);
  var h = Math.min(SCREEN_HEIGHT - 120, 560);
  return { x: (SCREEN_WIDTH - w) / 2, y: (SCREEN_HEIGHT - h) / 2, w: w, h: h };
}

function render(c) {
  if (_animator.isClosed()) return;
  var state = _animator.update();
  if (_animator.isClosed()) return;

  var p = _panelRect();

  // 1. 半透明遮罩
  if (state.maskAlpha > 0.005) {
    c.fillStyle = 'rgba(0,0,0,' + state.maskAlpha.toFixed(3) + ')';
    c.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  }
  if (state.alpha < 0.01) return;

  c.save();
  c.globalAlpha = state.alpha;
  var pcx = p.x + p.w / 2, pcy = p.y + p.h / 2;
  c.translate(pcx, pcy);
  c.scale(state.scale, state.scale);
  c.translate(-pcx, -pcy);

  // 面板底
  c.save();
  c.fillStyle = '#FFFFFF';
  _roundRect(c, p.x, p.y, p.w, p.h, 18);
  c.fill();
  c.restore();

  // 标题
  c.save();
  c.fillStyle = '#5A4A6A';
  c.font = 'bold 20px ' + Theme.font.family;
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.fillText('求助记录', p.x + 20, p.y + 28);
  c.restore();

  // 关闭钮（右上角 ✕）
  _closeRect = { x: p.x + p.w - 44, y: p.y + 10, w: 34, h: 34 };
  c.save();
  c.fillStyle = '#E5E1EE';
  _roundRect(c, _closeRect.x, _closeRect.y, _closeRect.w, _closeRect.h, 17);
  c.fill();
  c.fillStyle = '#8A7FA0';
  c.font = '20px ' + Theme.font.family;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('✕', _closeRect.x + _closeRect.w / 2, _closeRect.y + _closeRect.h / 2 + 1);
  c.restore();

  // 列表区
  _btns = [];
  var listTop = p.y + 56;
  var listBottom = p.y + p.h - 16;
  var contentH = _items.length * _rowH();
  var viewH = listBottom - listTop;
  if (_scrollY > contentH - viewH) _scrollY = Math.max(0, contentH - viewH);
  if (_scrollY < 0) _scrollY = 0;

  if (_loading) {
    c.save();
    c.fillStyle = '#9A90AE';
    c.font = '16px ' + Theme.font.family;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('加载中…', p.x + p.w / 2, p.y + p.h / 2);
    c.restore();
    c.restore();
    return;
  }
  if (_empty) {
    c.save();
    c.fillStyle = '#9A90AE';
    c.font = '16px ' + Theme.font.family;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText('还没有求助记录', p.x + p.w / 2, p.y + p.h / 2);
    c.restore();
    c.restore();
    return;
  }

  c.save();
  c.beginPath();
  c.rect(p.x, listTop, p.w, viewH);
  c.clip();

  for (var i = 0; i < _items.length; i++) {
    var it = _items[i];
    var ry = listTop + i * _rowH() - _scrollY;
    if (ry + _rowH() < listTop || ry > listBottom) continue;
    _drawRow(c, it, p.x + 16, ry, p.w - 32);
  }
  c.restore();

  c.restore();
}

function _drawRow(g, it, x, y, w) {
  var h = _rowH() - 12;
  // 卡片底
  g.save();
  g.fillStyle = '#F6F3FB';
  _roundRect(g, x, y, w, h, 12);
  g.fill();
  g.restore();

  // 关卡名 + 状态
  g.save();
  g.fillStyle = '#3A2E4D';
  g.font = 'bold 16px ' + Theme.font.family;
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillText('关卡：' + (it.levelName || '?'), x + 14, y + 12);
  g.fillStyle = it.status === 'expired' ? '#C0564B' : '#7A6FA0';
  g.font = '14px ' + Theme.font.family;
  g.fillText(_statusText(it), x + 14, y + 36);
  g.restore();

  // 回放按钮（每位协助者一个）
  var assists = it.assists || [];
  var bx = x + 14;
  var by = y + h - 40;
  var bw = 76, bh = 30, gap = 8;
  for (var a = 0; a < assists.length && a < 3; a++) {
    _miniBtn(g, bx + a * (bw + gap), by, bw, bh, '回放' + (a + 1), '#FF8A3D');
    _btns.push({ x: bx + a * (bw + gap), y: by, w: bw, h: bh, action: 'replay', hk: it.helpKey, idx: a });
  }

  // 续转（再分享一次）
  var fw = 76, fh = 30;
  var fx = x + w - fw - 14;
  var fy = y + h - 40;
  _miniBtn(g, fx, fy, fw, fh, '续转', '#6C8CFF');
  _btns.push({ x: fx, y: fy, w: fw, h: fh, action: 'forward', hk: it.helpKey, idx: -1 });
}

function _miniBtn(g, x, y, w, h, label, color) {
  g.save();
  g.fillStyle = color;
  _roundRect(g, x, y, w, h, h / 2);
  g.fill();
  g.fillStyle = '#FFFFFF';
  g.font = '14px ' + Theme.font.family;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, x + w / 2, y + h / 2 + 1);
  g.restore();
}

function handleEvent(e) {
  if (!isOpen()) return;
  if (e.type !== 'touchstart') return;
  // GameEngine 传入 { type, x, y }；兼容直接带 touches 的形态
  var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
  var x = t ? t.x : e.x;
  var y = t ? t.y : e.y;
  if (x == null || y == null) return;

  if (_closeRect && x >= _closeRect.x && x <= _closeRect.x + _closeRect.w &&
      y >= _closeRect.y && y <= _closeRect.y + _closeRect.h) {
    close();
    return;
  }
  // 点击面板外（遮罩区域）→ 关闭
  var p = _panelRect();
  if (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h) {
    close();
    return;
  }
  for (var i = 0; i < _btns.length; i++) {
    var b = _btns[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      _onTap(b);
      return;
    }
  }
}

function _onTap(b) {
  if (b.action === 'replay') {
    close();
    if (databus._gameEngine && databus._gameEngine.playing && databus._gameEngine.playing._enterReplayFromHelpKey) {
      databus._gameEngine.playing._enterReplayFromHelpKey(b.hk, b.idx);
    }
  } else if (b.action === 'forward') {
    try {
      wx.shareAppMessage({ title: '帮我过这关！', query: 'hk=' + b.hk });
    } catch (e) { console.warn('[HelpList] 续转分享失败', e); }
  }
}

// === 绘制工具 ===
function _roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

module.exports = {
  open: open,
  close: close,
  isOpen: isOpen,
  render: render,
  handleEvent: handleEvent,
};
