// 场外求助：协助记录列表（双页签：我发出的 / 我协助的）
// 复用 PopupAnimator 开关场，由 GameEngine 菜单路由触控。
// 数据来自云函数 listMyHelpRequests 的 { sent, assisted } 双视图；
// 亲密度（互协助总次数）由客户端按好友 openId 在两份列表中聚合统计。

const cloud = require('../cloud.js');
const databus = require('../databus.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const Theme = require('../define/GameDefine.js').THEME;
const Easing = require('../core/Easing.js');
const audio = require('../audio/AudioManager.js');
const PopupAnimator = require('./PopupAnimator.js').createPopupAnimator;

var _animator = PopupAnimator();
var _tab = 'sent';              // 'sent' | 'assisted'
var _sent = [];                 // 我发出的（每条协助者一行；无协助者则一条 noAssist 占位）
var _assisted = [];             // 我协助的（每条我参与的请求一行）
var _intimacy = {};             // openId -> 互协助总次数
var _avatarCache = {};          // openId -> wx.Image（头像懒加载）
var _loading = false;
var _empty = false;
var _btns = [];                 // 当前帧可点击区（卡片按钮）
var _tabRects = [];             // 页签命中区
var _closeRect = null;
var _scrollY = 0;
var _pressedVidx = -1;           // 卡片按钮按压态（仅收 touchstart，按下即触发 240ms 缩放闪光）
var _pressedAt = 0;

function _curList() { return _tab === 'sent' ? _sent : _assisted; }

function open() {
  _animator.open();
  _loading = true;
  _empty = false;
  _tab = 'sent';
  _scrollY = 0;
  _pressedVidx = -1;
  _sent = []; _assisted = []; _intimacy = {}; _btns = []; _tabRects = [];
  cloud.listMyHelpRequests().then(function (res) {
    _loading = false;
    if (!res || res.code !== 0) { _empty = true; return; }
    _sent = res.sent || [];
    _assisted = res.assisted || [];
    _computeIntimacy();
    _empty = (_sent.length === 0 && _assisted.length === 0);
  }).catch(function (e) {
    _loading = false;
    _empty = true;
    console.warn('[HelpList] 拉取失败:', e && e.message);
  });
}

// 亲密度 = 历史以来与某好友互相协助的总次数（双向均计入）
// 一份 sent 行 + 一份 assisted 行恰好覆盖一次「我↔好友」的互协助交互。
function _computeIntimacy() {
  var m = {};
  function bump(openId) { if (!openId) return; m[openId] = (m[openId] || 0) + 1; }
  for (var i = 0; i < _sent.length; i++) { var s = _sent[i]; if (s.friend) bump(s.friend.openId); }
  for (var j = 0; j < _assisted.length; j++) { var a = _assisted[j]; if (a.friend) bump(a.friend.openId); }
  _intimacy = m;
}

function close() { _animator.close(); }
function isOpen() { return _animator.isOpen() || _animator.getPhase() === 'opening'; }

function _cardH() { return 100; }
function _panelRect() {
  var w = Math.min(SCREEN_WIDTH - 32, 420);
  var h = Math.min(SCREEN_HEIGHT - 120, 560);
  return { x: (SCREEN_WIDTH - w) / 2, y: (SCREEN_HEIGHT - h) / 2, w: w, h: h };
}

// === 格式化 ===
function _fmtDate(ms) {
  if (!ms) return '—';
  var d = new Date(ms);
  var mm = ('0' + (d.getMonth() + 1)).slice(-2);
  var dd = ('0' + d.getDate()).slice(-2);
  return mm + '月' + dd + '日';
}
function _fmtLevel(name) {
  var n = parseInt(name || '1', 10);
  if (isNaN(n)) n = 1;
  return '第' + n + '关';
}
function _fmtPower(it) {
  if (it.noAssist) return '暂无';
  if (!it.result) return '—';
  var e = it.result.escapedPigs, t = it.result.totalPigs;
  if (typeof e === 'number' && typeof t === 'number' && t > 0 && e >= t) return '通关';
  return '跑出' + (e || 0) + '头猪';
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
  c.fillText('协助记录', p.x + 20, p.y + 22);
  c.restore();

  // 左上角保留说明（7 天留存）
  c.save();
  c.fillStyle = '#B0A6C2';
  c.font = '12px ' + Theme.font.family;
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.fillText('*仅保留7天内的协助信息', p.x + 20, p.y + 44);
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

  // 页签：我发出的 / 我协助的
  _btns = [];
  var tabTop = p.y + 60;
  var tabH = 32;
  var tabGap = 8;
  var tabW = (p.w - 32 - tabGap) / 2;
  _tabRects = [
    { x: p.x + 16, y: tabTop, w: tabW, h: tabH, tab: 'sent' },
    { x: p.x + 16 + tabW + tabGap, y: tabTop, w: tabW, h: tabH, tab: 'assisted' },
  ];
  for (var ti = 0; ti < _tabRects.length; ti++) {
    var t = _tabRects[ti];
    var sel = (_tab === t.tab);
    c.save();
    c.fillStyle = sel ? '#7A6FA0' : '#ECE7F5';
    _roundRect(c, t.x, t.y, t.w, t.h, t.h / 2);
    c.fill();
    c.fillStyle = sel ? '#FFFFFF' : '#6A5F88';
    c.font = (sel ? 'bold ' : '') + '15px ' + Theme.font.family;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(t.tab === 'sent' ? '我发出的' : '我协助的', t.x + t.w / 2, t.y + t.h / 2 + 1);
    c.restore();
  }

  // 列表区
  var listTop = tabTop + tabH + 14;
  var listBottom = p.y + p.h - 16;

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

  var list = _curList();
  if (list.length === 0) {
    c.save();
    c.fillStyle = '#9A90AE';
    c.font = '16px ' + Theme.font.family;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(_tab === 'sent' ? '还没有发出过求助' : '还没有协助过好友', p.x + p.w / 2, p.y + p.h / 2);
    c.restore();
    c.restore();
    return;
  }

  var contentH = list.length * _cardH();
  var viewH = listBottom - listTop;
  if (contentH <= viewH) _scrollY = 0;
  else if (_scrollY > contentH - viewH) _scrollY = contentH - viewH;
  if (_scrollY < 0) _scrollY = 0;

  c.save();
  c.beginPath();
  c.rect(p.x, listTop, p.w, viewH);
  c.clip();

  for (var i = 0; i < list.length; i++) {
    var it = list[i];
    var ry = listTop + i * _cardH() - _scrollY;
    if (ry + _cardH() < listTop || ry > listBottom) continue;
    _drawCard(c, it, p.x + 16, ry, p.w - 32, i);
  }
  c.restore();

  c.restore();
}

function _drawCard(g, it, x, y, w, idx) {
  var h = _cardH() - 12;
  // 卡片底
  g.save();
  g.fillStyle = '#F6F3FB';
  _roundRect(g, x, y, w, h, 12);
  g.fill();
  g.restore();

  // 头行：发布日期 · 第x关
  g.save();
  g.fillStyle = '#3A2E4D';
  g.font = 'bold 15px ' + Theme.font.family;
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillText(_fmtDate(it.createdAt) + ' · ' + _fmtLevel(it.levelName), x + 14, y + 12);
  g.restore();

  // 内容竖直中心（与右侧按钮对齐）
  var cy = y + 50;

  if (it.noAssist) {
    // 暂无好友协助：整块（头像/昵称/亲密度/力度）替换为单行文字
    g.save();
    g.fillStyle = '#9A90AE';
    g.font = '15px ' + Theme.font.family;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('暂无好友协助', x + 14, cy);
    g.restore();
  } else {
    // 好友头像
    var avR = 18;
    var avCx = x + 14 + avR;
    _avatar(g, it.friend.avatarUrl, avCx, cy, avR, it.friend.openId);

    // 昵称 · 力度（合并一行，保留通关绿/跑出橙配色）
    var nx = x + 14 + avR * 2 + 8;
    var nameStr = it.friend.nickName || '微信好友';
    var passed = it.result && it.result.totalPigs > 0 && it.result.escapedPigs >= it.result.totalPigs;
    g.save();
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = '15px ' + Theme.font.family;
    g.fillStyle = '#3A2E4D';
    g.fillText(nameStr, nx, cy);
    var nameW = g.measureText(nameStr).width;
    g.fillStyle = passed ? '#3FA66A' : '#C0762E';
    g.fillText(' · ' + _fmtPower(it), nx + nameW, cy);
    g.restore();

    // 底行：亲密度（左）
    g.save();
    g.fillStyle = '#7A6FA0';
    g.font = '13px ' + Theme.font.family;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    var inti = it.friend ? (_intimacy[it.friend.openId] || 0) : 0;
    g.fillText('亲密度 ' + inti, x + 14, y + h - 14);
    g.restore();
  }

  // 按钮（右）：回放（绿）/ 重发（蓝），与内容行垂直居中
  var bw = 84, bh = 30;
  var bx = x + w - 14 - bw;
  var by = cy - bh / 2;
  var label = it.noAssist ? '重发' : '回放';
  var btnColor = it.noAssist ? '#34AAD6' : '#36B37E'; // 重发蓝色 / 回放绿色，区分开
  _greenBtn(g, bx, by, bw, bh, label, btnColor, idx);
  _btns.push({ x: bx, y: by, w: bw, h: bh, action: it.noAssist ? 'resend' : 'replay', hk: it.helpKey, idx: it.idx, vidx: idx });
}

// 头像懒加载（小游戏无 DOM，wx.createImage 复用，圆形 clip），参考 PlayingEngine 范式
function _avatar(g, url, cx, cy, r, openId) {
  if (!url) {
    g.save();
    g.fillStyle = '#D8D2E4';
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
    g.restore();
    return;
  }
  var img = _avatarCache[openId];
  if (!img) {
    img = wx.createImage();
    img.onload = function () {};
    img.src = url;
    _avatarCache[openId] = img;
  }
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.clip();
  if (img.width && img.height) {
    g.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  } else {
    g.fillStyle = '#D8D2E4';
    g.fillRect(cx - r, cy - r, r * 2, r * 2);
  }
  g.restore();
}

// 卡片按钮按压缩放（仅收 touchstart：按下即触发 240ms 闪光 —— 缩 0.94 再弹回）
function _btnScale(vidx) {
  if (_pressedVidx < 0 || vidx !== _pressedVidx) return 1;
  var elapsed = Date.now() - _pressedAt;
  var D = 240;
  if (elapsed >= D) { _pressedVidx = -1; return 1; }
  var t = elapsed / D;
  if (t < 0.5) return 1 - 0.06 * Easing.easeOutCubic(t / 0.5);
  return 0.94 + 0.06 * Easing.easeOutBack((t - 0.5) / 0.5, 1.5);
}

function _greenBtn(g, x, y, w, h, label, color, vidx) {
  var scale = _btnScale(vidx);
  g.save();
  if (scale !== 1) {
    var cx = x + w / 2, cy = y + h / 2;
    g.translate(cx, cy);
    g.scale(scale, scale);
    g.translate(-cx, -cy);
  }
  g.fillStyle = color || '#36B37E';
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
  var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
  var x = t ? t.x : e.x;
  var y = t ? t.y : e.y;
  if (x == null || y == null) return;

  if (_closeRect && x >= _closeRect.x && x <= _closeRect.x + _closeRect.w &&
      y >= _closeRect.y && y <= _closeRect.y + _closeRect.h) {
    close();
    return;
  }
  var p = _panelRect();
  if (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h) {
    close();
    return;
  }
  for (var i = 0; i < _tabRects.length; i++) {
    var tr = _tabRects[i];
    if (x >= tr.x && x <= tr.x + tr.w && y >= tr.y && y <= tr.y + tr.h) {
      if (_tab !== tr.tab) { _tab = tr.tab; _scrollY = 0; }
      return;
    }
  }
  for (var k = 0; k < _btns.length; k++) {
    var b = _btns[k];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
      // 按压反馈（点按闪光）+ 点击音效
      _pressedVidx = (b.vidx != null ? b.vidx : -1);
      _pressedAt = Date.now();
      audio.play('button_click');
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
  } else if (b.action === 'resend') {
    try {
      wx.shareAppMessage({ title: '帮我过这关！', query: 'hk=' + b.hk });
    } catch (e) { console.warn('[HelpList] 重发分享失败', e); }
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
  // 由 GameEngine 在打开协助面板前预拉取（可选）
  refresh: open,
};
