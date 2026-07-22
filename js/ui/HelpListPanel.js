// 场外求助：协助记录列表（双页签：我发出的 / 我协助的）
// 复用 PopupAnimator 开关场，由 GameEngine 菜单路由触控。
// 数据来自云函数 listMyHelpRequests 的 { sent, assisted } 双视图；
// 服务端已按「同一求助 = 一张聚合卡片」返回，assists 为协助者明细数组（含各自跑出猪数）。

const cloud = require('../cloud.js');
const databus = require('../databus.js');
const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const Theme = require('../define/GameDefine.js').THEME;
const Easing = require('../core/Easing.js');
const audio = require('../audio/AudioManager.js');
const PopupAnimator = require('./PopupAnimator.js').createPopupAnimator;
const ConfirmDialog = require('./ConfirmDialog.js');

var _animator = PopupAnimator();
var _tab = 'sent';              // 'sent' | 'assisted'
var _sent = [];                 // 我发出的（每张卡片 = 一个求助，assists 为协助者明细）
var _assisted = [];             // 我协助的（每张卡片 = 一个我参与过的求助）
var MAX_ASSISTS = 3;            // 单个求助允许的最大协助者数量（与 submitAssist 服务端满员标记一致）
var _avatarCache = {};          // openId -> wx.Image（头像懒加载）
var _loading = false;
var _empty = false;
var _btns = [];                 // 当前帧可点击区（卡片按钮）
var _tabRects = [];             // 页签命中区
var _closeRect = null;
var _scrollY = 0;
var _pressedVidx = -1;           // 卡片按钮按压态（仅收 touchstart，按下即触发 240ms 缩放闪光）
var _pressedAt = 0;
// 列表拖拽滚动状态（GameEngine 已转发 touchmove，此前被 handleEvent 丢弃导致无法滚动）
var _dragY = 0;                  // 本次拖拽起点 y
var _dragScroll = 0;             // 本次拖拽起点的 _scrollY
var _dragging = false;           // 是否在列表区按下（拖拽候选）
var _moved = false;              // 本次 touch 是否发生有效位移（区分点击/滚动）
var DRAG_THRESHOLD = 6;          // 超过此位移视为滚动而非点击
var _myOpenId = '';              // 本人 openid（删除协助记录时服务端按此判定权限）
var _vseq = 0;                 // 本轮渲染按钮唯一 vidx 计数器（保证 replay/delete 按压态不串号）

function _curList() { return _tab === 'sent' ? _sent : _assisted; }

function open(preserveTab) {
  _animator.open();
  _loading = true;
  _empty = false;
  // 正常打开默认落在「我发出的」；删除后重载需保留当前页签（preserveTab=true），否则会跳回默认页签
  if (!preserveTab) { _tab = 'sent'; _scrollY = 0; }
  _pressedVidx = -1;
  _dragging = false;
  _moved = false;
  _sent = []; _assisted = []; _btns = []; _tabRects = [];
  // 预取本人 openid（删除协助记录时服务端按此判定权限）
  cloud.getOpenId().then(function (oid) { _myOpenId = oid || ''; }).catch(function () { _myOpenId = ''; });
  cloud.listMyHelpRequests().then(function (res) {
    _loading = false;
    if (!res || res.code !== 0) { _empty = true; return; }
    _sent = res.sent || [];
    _assisted = res.assisted || [];
    _empty = (_sent.length === 0 && _assisted.length === 0);
  }).catch(function (e) {
    _loading = false;
    _empty = true;
    console.warn('[HelpList] 拉取失败:', e && e.message);
  });
}

// （已移除亲密度聚合：需求不再展示/计算，n/m 的 n 直接取 assists.length）

function close() { _animator.close(); }
function isOpen() { return _animator.isOpen() || _animator.getPhase() === 'opening'; }

// 卡片可变高度：头行 + 每位协助者一行（含行间分隔线间距）
function _cardH(it) {
  var headerH = 32, gap = 8, rowH = 42, padBottom = 12;
  var rows = (it && it.assists) ? it.assists.length : 0;
  if (rows === 0) rows = 1; // 无协助占位（"暂无好友协助"）也占一行
  return headerH + gap + rows * rowH + padBottom;
}
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
  return '跑出' + (e || 0) + '头';
}

// 按钮文字宽度（与 _pillBtn 同字体 14px）——用于按钮宽度 = 文字宽 + 10px
function _textW(g, str) {
  g.save();
  g.font = '14px ' + Theme.font.family;
  var w = g.measureText(str).width;
  g.restore();
  return Math.ceil(w);
}

// 玩家昵称最多显示前 4 个字符，超出补 "..."
function _clipName(str) {
  str = (str == null) ? '' : String(str);
  if (str.length > 4) return str.slice(0, 4) + '...';
  return str;
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

  // 累计高度布局（卡片高度可变）
  _vseq = 0;
  var layouts = [];
  var totalH = 0;
  var CARD_GAP = 12;
  for (var li = 0; li < list.length; li++) {
    var ch = _cardH(list[li]);
    layouts.push({ it: list[li], h: ch, y: totalH });
    totalH += ch + CARD_GAP;
  }
  var contentH = totalH;
  var viewH = listBottom - listTop;
  if (contentH <= viewH) _scrollY = 0;
  else if (_scrollY > contentH - viewH) _scrollY = contentH - viewH;
  if (_scrollY < 0) _scrollY = 0;

  c.save();
  c.beginPath();
  c.rect(p.x, listTop, p.w, viewH);
  c.clip();

  for (var i = 0; i < layouts.length; i++) {
    var L = layouts[i];
    var ry = listTop + L.y - _scrollY;
    if (ry + L.h < listTop || ry > listBottom) continue;
    _drawCard(c, L.it, p.x + 16, ry, p.w - 32, i);
  }
  c.restore();

  c.restore();

  // 确认窗（删除提示）覆盖在面板之上，独立遮罩 + 设置同款窗体
  if (ConfirmDialog.isOpen()) ConfirmDialog.render(c);
}

// 聚合卡片：头行「日期 · 第x关（n/m）」+ 每位协助者一行（22×22头像 + 昵称 + 跑出e头 + 回放/删除）
function _drawCard(g, it, x, y, w, idx) {
  var h = _cardH(it);
  // 卡片底
  g.save();
  g.fillStyle = '#F6F3FB';
  _roundRect(g, x, y, w, h, 12);
  g.fill();
  g.restore();

  // 头行：发布日期 · 第x关（n/m）  n=协助者个数（取真实总数 assistCount，我协助的视图只回传本人行但 n 仍为总数）  m=最大允许协助者数
  var n = (typeof it.assistCount === 'number') ? it.assistCount : ((it.assists) ? it.assists.length : 0);
  g.save();
  g.fillStyle = '#3A2E4D';
  g.font = 'bold 15px ' + Theme.font.family;
  g.textAlign = 'left';
  g.textBaseline = 'top';
  g.fillText(_fmtDate(it.createdAt) + ' · ' + _fmtLevel(it.levelName) + '（' + n + '/' + MAX_ASSISTS + '）', x + 14, y + 12);
  g.restore();

  // 头行右侧「重发」：仅我发出的、且仍有空余协助位时显示（满员 n==MAX_ASSISTS 不显示）
  var showResend = (_tab === 'sent') && (n < MAX_ASSISTS);
  if (showResend) {
    var rW = _textW(g, '重发') + 10;
    var rH = 28;
    var rBy = y + 12 + 10 - rH / 2;          // 与头行文字垂直居中
    var rBx = x + w - 14 - rW;
    _pillBtn(g, rBx, rBy, rW, rH, '重发', '#34AAD6', _vseq++);
    _btns.push({ x: rBx, y: rBy, w: rW, h: rH, action: 'resend', hk: it.helpKey, idx: -1, vidx: _vseq - 1 });
  }

  var rows = it.assists || [];
  var rowTop = y + 12 + 20 + 8;   // 头行 top(12) + 行高(20) + 间距(8)
  var rowH = 42;

  // 无协助者：单行占位（重发按钮已上移到头行右侧）
  if (rows.length === 0) {
    g.save();
    g.fillStyle = '#9A90AE';
    g.font = '15px ' + Theme.font.family;
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.fillText('暂无好友协助', x + 14, rowTop + rowH / 2);
    g.restore();
    return;
  }

  for (var r = 0; r < rows.length; r++) {
    var a = rows[r];
    var ryTop = rowTop + r * rowH;
    var cy = ryTop + rowH / 2;

    // 行间分隔线（首行之上不画）
    if (r > 0) {
      g.save();
      g.strokeStyle = '#E5E1EE';
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(x + 14, ryTop);
      g.lineTo(x + w - 14, ryTop);
      g.stroke();
      g.restore();
    }

    // 头像 + 昵称来源：我发出的 -> 该协助者本人；我协助的 -> 发起者（展示「谁发起的」）
    var avatarUrl, rowName, cacheKey;
    if (_tab === 'assisted') {
      avatarUrl = (it.requester && it.requester.avatarUrl) || '';
      rowName = (it.requester && it.requester.nickName) || '微信好友';
      cacheKey = (it.requester && it.requester.openId) || a.openId;
    } else {
      avatarUrl = a.avatarUrl;
      rowName = a.nickName;
      cacheKey = a.openId;
    }

    // 头像 22×22 => 半径 11
    var avR = 11;
    var avCx = x + 14 + avR;
    _avatar(g, avatarUrl, avCx, cy, avR, cacheKey);

    // 昵称 + 跑出e头（e 是该协助者本人跑出的猪数，通关显绿；我协助的视图 e 为我自己的成绩）
    var nx = x + 14 + avR * 2 + 8;
    var nameStr = _clipName(rowName) || '微信好友';
    var passed = a.result && a.result.totalPigs > 0 && a.result.escapedPigs >= a.result.totalPigs;
    g.save();
    g.textAlign = 'left';
    g.textBaseline = 'middle';
    g.font = '15px ' + Theme.font.family;
    g.fillStyle = '#3A2E4D';
    g.fillText(nameStr, nx, cy);
    var nameW = g.measureText(nameStr).width;
    g.fillStyle = passed ? '#3FA66A' : '#C0762E';
    g.fillText(' · ' + _fmtPower(a), nx + nameW, cy);
    g.restore();

    // 右侧按钮：回放（始终）+ 删除（按权限）；按钮宽度 = 文字宽 + 10px
    var bh = 28, gap = 10;
    var bh2 = bh;
    var by = cy - bh2 / 2;
    var replayW = _textW(g, '回放') + 10;
    var rbx = x + w - 14 - replayW;
    // 删除权限：我发出的可删任意协助者；我协助的仅能删自己那一行
    var canDelete = (_tab === 'sent') ? true : (a.openId === _myOpenId);

    _pillBtn(g, rbx, by, replayW, bh2, '回放', '#36B37E', _vseq++);
    _btns.push({ x: rbx, y: by, w: replayW, h: bh2, action: 'replay', hk: it.helpKey, idx: a.idx, vidx: _vseq - 1 });

    if (canDelete) {
      var delW = _textW(g, '删除') + 10;
      var dbx = rbx - gap - delW;
      _pillBtn(g, dbx, by, delW, bh2, '删除', '#E2604E', _vseq++);
      // 删除目标：我发出的删「这位协助者」(a.openId)；我协助的删「我自己」(_myOpenId)
      var targetOpenId = (_tab === 'sent') ? a.openId : _myOpenId;
      _btns.push({ x: dbx, y: by, w: delW, h: bh2, action: 'delete', hk: it.helpKey, idx: a.idx, vidx: _vseq - 1, targetOpenId: targetOpenId, nickName: a.nickName || '', lastOne: (_tab === 'sent' && rows.length === 1) });
    }
  }
}

// 统一 pill 按钮（实心圆角胶囊 + 白字 + 按压缩放），回放/重发/删除共用，仅颜色区分
function _pillBtn(g, x, y, w, h, label, bgColor, vidx) {
  var scale = _btnScale(vidx);
  g.save();
  if (scale !== 1) {
    var cx = x + w / 2, cy = y + h / 2;
    g.translate(cx, cy);
    g.scale(scale, scale);
    g.translate(-cx, -cy);
  }
  g.fillStyle = bgColor || '#36B37E';
  _roundRect(g, x, y, w, h, h / 2);
  g.fill();
  g.fillStyle = '#FFFFFF';
  g.font = '14px ' + Theme.font.family;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, x + w / 2, y + h / 2 + 1);
  g.restore();
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

// 注：回放/重发/删除三类按钮现已统一由 _pillBtn 绘制（见上方），_greenBtn 不再使用

function handleEvent(e) {
  if (!isOpen()) return;
  // 确认窗打开时，全部触控事件交给确认窗处理，底层面板不响应
  if (ConfirmDialog.isOpen()) { ConfirmDialog.handleEvent(e); return; }
  var t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
  var x = t ? t.x : e.x;
  var y = t ? t.y : e.y;
  if (x == null || y == null) return;

  if (e.type === 'touchstart') {
    // 关闭钮
    if (_closeRect && x >= _closeRect.x && x <= _closeRect.x + _closeRect.w &&
        y >= _closeRect.y && y <= _closeRect.y + _closeRect.h) {
      close();
      return;
    }
    // 面板外 → 关闭
    var p = _panelRect();
    if (x < p.x || x > p.x + p.w || y < p.y || y > p.y + p.h) {
      close();
      return;
    }
    // 页签
    for (var i = 0; i < _tabRects.length; i++) {
      var tr = _tabRects[i];
      if (x >= tr.x && x <= tr.x + tr.w && y >= tr.y && y <= tr.y + tr.h) {
        if (_tab !== tr.tab) { _tab = tr.tab; _scrollY = 0; }
        return;
      }
    }
    // 卡片按钮（回放/重发/删除）
    for (var k = 0; k < _btns.length; k++) {
      var b = _btns[k];
      if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) {
        _pressedVidx = (b.vidx != null ? b.vidx : -1);
        _pressedAt = Date.now();
        audio.play('button_click');
        _onTap(b);
        return;
      }
    }
    // 其余区域：列表拖拽候选（按下记录起点，move 时滚动）
    _dragY = y;
    _dragScroll = _scrollY;
    _dragging = true;
    _moved = false;
    return;
  }

  if (e.type === 'touchmove') {
    if (_dragging) {
      var dy = y - _dragY;
      if (Math.abs(dy) > DRAG_THRESHOLD) _moved = true;
      _scrollY = _dragScroll - dy;
      _clampScroll();
    }
    return;
  }

  if (e.type === 'touchend') {
    // 若发生过拖拽位移，不触发任何点击（按钮已在 touchstart 处理）
    _dragging = false;
    return;
  }
}

// 与 render() 同步的滚动区间约束（viewH = 面板高 - 标题/说明/页签/留白；卡片高度可变）
function _clampScroll() {
  var list = _curList();
  var totalH = 0, CARD_GAP = 12;
  for (var i = 0; i < list.length; i++) totalH += _cardH(list[i]) + CARD_GAP;
  var p = _panelRect();
  var viewH = (p.y + p.h - 16) - (p.y + 60 + 32 + 14);
  var maxScroll = totalH > viewH ? totalH - viewH : 0;
  if (_scrollY < 0) _scrollY = 0;
  if (_scrollY > maxScroll) _scrollY = maxScroll;
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
  } else if (b.action === 'delete') {
    _confirmDelete(b);
  }
}

// 删除确认：统一使用通用确认窗（设置同款窗体 + 全屏遮罩）
// 文案统一为：标题「警告」、内容「删除的记录无法恢复，请确认」、按钮「取消 / 删除」
function _confirmDelete(b) {
  ConfirmDialog.open({
    title: '警告',
    content: '删除的记录无法恢复，请确认',
    confirmText: '删除',
    cancelText: '取消',
    confirmColor: 'red',
    maskClosable: true,
    onConfirm: function () {
      cloud.removeAssist(b.hk, b.targetOpenId).then(function () {
        // 静默重载列表（重新拉取最新状态），preserveTab=true 保留当前页签
        open(true);
      }).catch(function (err) {
        console.warn('[HelpList] 删除失败:', err && err.message);
        open(true);
      });
    },
  });
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
