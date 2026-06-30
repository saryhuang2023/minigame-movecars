// 推猪消除 — 装扮面板
// 2×3 网格展示皮肤卡片，16:9 比例
// 标签浮于上边框，按钮贴下边框
// 支持滚动，敬请期待卡片放在网格末尾

var SkinSystem = require('../game/SkinSystem.js');
var GoldSystem = require('../game/GoldSystem.js');
var databus = require('../databus.js');
var PopupAnimator = require('./PopupAnimator.js');
var Theme = require('./Theme.js');
var { drawComposedPig, getComposedPigSize } = require('../render/PigRenderer.js');

// ===== PopupAnimator =====
var _animator = PopupAnimator.createPopupAnimator();

// ===== 布局常量 =====
var PW = 320;
var RADIUS = 16;
var PAD_X = 10;                       // 面板内左右边距
var COLS = 3;
var COL_GAP = 8;
var CARD_W = Math.floor((PW - 2 * PAD_X - (COLS - 1) * COL_GAP) / COLS);
var CARD_H = Math.floor(CARD_W * 9 / 16);   // 16:9

var LABEL_H = 16;                     // 名称标签高度（半浮于卡片上边缘）
var BTN_H = 26;                       // 底部按钮高度
var BTN_GAP = 4;                      // 卡片底边到按钮顶部的间距
var ROW_GAP = 30;                     // 行间距（按钮底部到下一行卡片顶部）
var ROW_HEIGHT = CARD_H + BTN_GAP + BTN_H + ROW_GAP;

var DISPLAY_RATIO = 0.7;              // 展示区占面板高度比例
var HEADER_BOTTOM = 44;               // 头部最下方元素的底边（金币/关闭按钮底部）

// ===== 状态 =====
var _panel = null;
var _closeRect = null;
var _cardRects = [];                  // [{x, y, w, h, skinId, index}]
var _btnRects = [];                   // [{x, y, w, h, skinId, index, label}]
var _displayTop = 0;                  // 展示区顶部 Y
var _displayH = 0;                    // 展示区高度
var _scrollOffset = 0;
var _maxScroll = 0;
var _isDragging = false;
var _dragStartY = 0;
var _dragStartOffset = 0;

// ===== 公开 API =====

function open() {
  var skins = SkinSystem.getAllSkins();
  var totalItems = skins.length + 1;   // +1 = 敬请期待
  var totalRows = Math.ceil(totalItems / COLS);

  var contentH = totalRows * ROW_HEIGHT + 20;
  var panelH = databus.screenHeight * 0.7;

  // 展示区 = 面板高度 × 70%，垂直居中
  _displayH = Math.floor(panelH * DISPLAY_RATIO);
  _displayTop = Math.floor((databus.screenHeight - panelH) / 2 - 10) + Math.floor((panelH - _displayH) / 2);

  _maxScroll = Math.max(0, contentH - _displayH + 10);

  var cx = Math.floor(databus.screenWidth / 2);
  _panel = {
    x: cx - Math.floor(PW / 2),
    y: Math.floor((databus.screenHeight - panelH) / 2 - 10),
    w: PW,
    h: panelH
  };

  _scrollOffset = 0;
  _isDragging = false;
  _cardRects = [];
  _btnRects = [];

  _animator.open();
}

function close() {
  if (_animator.isClosed()) return;
  _animator.close(function () {
    _panel = null;
    _closeRect = null;
    _cardRects = [];
    _btnRects = [];
    _displayTop = 0;
    _displayH = 0;
    _scrollOffset = 0;
    _isDragging = false;
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

  // 3. 固定头部（不受滚动影响）
  _renderHeader(ctx, p);

  // 4. 网格区域（裁剪 + 滚动偏移）
  // 标签浮于卡片上边框上方 LABEL_H/2，裁剪区上移 LABEL_H 保证第一行标签不被裁
  var gridY = _displayTop;

  ctx.save();
  ctx.beginPath();
  ctx.rect(p.x, gridY - LABEL_H, p.w, _displayH + LABEL_H);
  ctx.clip();

  _renderGrid(ctx, p, gridY);

  ctx.restore();

  ctx.restore();
}

// ===== 固定头部渲染 =====

function _renderHeader(ctx, p) {
  // 关闭按钮
  var closeD = 28;
  var closeX = p.x + p.w - closeD - 12;
  var closeY = p.y + 14;
  var ccx = closeX + closeD / 2;
  var ccy = closeY + closeD / 2;
  _closeRect = { x: closeX - 4, y: closeY - 4, w: closeD + 8, h: closeD + 8 };

  ctx.strokeStyle = '#999';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  var pad = 7;
  ctx.beginPath();
  ctx.moveTo(closeX + pad, closeY + pad);
  ctx.lineTo(closeX + closeD - pad, closeY + closeD - pad);
  ctx.moveTo(closeX + closeD - pad, closeY + pad);
  ctx.lineTo(closeX + pad, closeY + closeD - pad);
  ctx.stroke();

  // 左上角金币徽章
  var goldAmount = GoldSystem.getGold();
  var gbX = p.x + 12;
  var gbY = p.y + 14;
  var gbH = 28;
  var gbR = 14;
  var gbW = 80;

  ctx.fillStyle = 'rgba(0,0,0,0.08)';
  ctx.beginPath();
  ctx.moveTo(gbX + gbR, gbY);
  ctx.lineTo(gbX + gbW - gbR, gbY);
  ctx.arcTo(gbX + gbW, gbY, gbX + gbW, gbY + gbR, gbR);
  ctx.lineTo(gbX + gbW, gbY + gbH - gbR);
  ctx.arcTo(gbX + gbW, gbY + gbH, gbX + gbW - gbR, gbY + gbH, gbR);
  ctx.lineTo(gbX + gbR, gbY + gbH);
  ctx.arcTo(gbX, gbY + gbH, gbX, gbY + gbH - gbR, gbR);
  ctx.lineTo(gbX, gbY + gbR);
  ctx.arcTo(gbX, gbY, gbX + gbR, gbY, gbR);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#F59E0B';
  ctx.font = 'bold 13px ' + Theme.font.family + '';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('💰 ' + goldAmount, gbX + 8, gbY + gbH / 2);

  // 标题（与金币徽章同一水平线）
  var cx = p.x + p.w / 2;
  var titleY = p.y + 14 + 14;   // 对齐金币徽章中心：p.y + 14 + gbH/2
  ctx.fillStyle = '#333';
  ctx.font = 'bold 16px ' + Theme.font.family + '';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('装扮', cx, titleY);
}

// ===== 网格渲染 =====

function _renderGrid(ctx, p, gridY) {
  var skins = SkinSystem.getAllSkins();
  if (skins.length === 0) {
    var cx = p.x + p.w / 2;
    ctx.fillStyle = '#999';
    ctx.font = '13px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('皮肤加载中...', cx, gridY + 60);
    return;
  }

  var equippedId = SkinSystem.getEquippedSkinId();

  // 清空热区
  _cardRects = [];
  _btnRects = [];

  var totalItems = skins.length + 1;  // +1 = 敬请期待

  for (var i = 0; i < totalItems; i++) {
    var col = i % COLS;
    var row = Math.floor(i / COLS);
    var cardX = p.x + PAD_X + col * (CARD_W + COL_GAP);
    var cardY = gridY + row * ROW_HEIGHT - _scrollOffset;

    if (i < skins.length) {
      // 皮肤卡片
      var skin = skins[i];
      var owned = SkinSystem.isOwned(skin.skinId);
      var isEquipped = (skin.skinId === equippedId);
      _renderOneCard(ctx, cardX, cardY, skin, owned, isEquipped, i);
    } else {
      // 敬请期待卡片
      _renderPlaceholderCard(ctx, cardX, cardY, i);
    }
  }
}

// ===== 单张皮肤卡片 =====

function _renderOneCard(ctx, x, y, skin, owned, isEquipped, index) {
  var unlocked = SkinSystem.isUnlocked(skin.skinId);

  // 卡片背景（16:9 圆角矩形）
  ctx.fillStyle = '#f5f5f5';
  _roundRect(ctx, x, y, CARD_W, CARD_H, 8);
  ctx.fill();
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 0.5;
  ctx.stroke();

  // 预览图 — 铺满卡片
  _renderCardPreview(ctx, x, y, skin.skinId, unlocked);

  // 名称标签（浮于上边框正中间）
  _renderCardLabel(ctx, x, y, skin);

  // 底部按钮
  _renderCardButton(ctx, x, y, skin, owned, isEquipped, unlocked, index);
}

function _renderCardPreview(ctx, x, y, skinId, unlocked) {
  // 未解锁皮肤给一层灰色遮罩
  if (!unlocked) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    _roundRect(ctx, x, y, CARD_W, CARD_H, 8);
    ctx.fill();
  }

  // 默认猪（skinId=0）走本地；其他皮肤走云端
  // 当前所有皮肤暂用默认猪预览
  var sizeInfo = getComposedPigSize();
  if (!sizeInfo) return;

  var pad = 4;
  var maxW = CARD_W - pad * 2;
  var maxH = CARD_H - pad * 2;
  var scale = Math.min(maxW / sizeInfo.naturalW, maxH / sizeInfo.naturalH, 0.55);

  try {
    var pigW = sizeInfo.naturalW * scale;
    var pigH = sizeInfo.naturalH * scale;
    drawComposedPig(ctx,
      x + (CARD_W - pigW) / 2,
      y + (CARD_H - pigH) / 2,
      scale);
  } catch (e) { /* 图片未加载，用灰色兜底 */ }
}

function _renderCardLabel(ctx, x, y, skin) {
  var name = skin.name || '';
  ctx.font = '10px ' + Theme.font.family + '';
  var textW = ctx.measureText(name).width;
  var labelW = Math.max(textW + 14, 36);
  var labelX = x + (CARD_W - labelW) / 2;
  var labelY = y - LABEL_H / 2;

  // 品质色填充
  ctx.fillStyle = _qualityColor(skin.quality);
  _roundRect(ctx, labelX, labelY, labelW, LABEL_H, LABEL_H / 2);
  ctx.fill();

  // 白色文字
  ctx.fillStyle = '#fff';
  ctx.font = '10px ' + Theme.font.family + '';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(name, labelX + labelW / 2, labelY + LABEL_H / 2);
}

function _renderCardButton(ctx, x, y, skin, owned, isEquipped, unlocked, index) {
  var btnW = CARD_W - 16;
  var btnX = x + (CARD_W - btnW) / 2;
  var btnY = y + CARD_H + BTN_GAP;

  var btnText;

  if (isEquipped) {
    // 已装备态
    ctx.fillStyle = '#FFB300';
    _roundRect(ctx, btnX, btnY, btnW, BTN_H, BTN_H / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    btnText = '装备中';
    ctx.fillText(btnText, btnX + btnW / 2, btnY + BTN_H / 2);
  } else if (owned) {
    // 已拥有，可装备
    ctx.fillStyle = '#FFB300';
    _roundRect(ctx, btnX, btnY, btnW, BTN_H, BTN_H / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    btnText = '装备';
    ctx.fillText(btnText, btnX + btnW / 2, btnY + BTN_H / 2);
  } else if (!unlocked) {
    // 未解锁 — 灰色 🔒 按钮
    ctx.fillStyle = '#e0e0e0';
    _roundRect(ctx, btnX, btnY, btnW, BTN_H, BTN_H / 2);
    ctx.fill();
    ctx.fillStyle = '#999';
    ctx.font = 'bold 11px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    btnText = '🔒 未解锁';
    ctx.fillText(btnText, btnX + btnW / 2, btnY + BTN_H / 2);
  } else {
    // 未拥有 — 金币按钮
    var canAfford = SkinSystem.canBuy(skin.skinId);
    var priceText = (skin.price > 0) ? ('💰 ' + skin.price) : '免费';

    if (canAfford && skin.price > 0) {
      ctx.fillStyle = '#FFB300';
    } else {
      ctx.fillStyle = '#ccc';
    }
    _roundRect(ctx, btnX, btnY, btnW, BTN_H, BTN_H / 2);
    ctx.fill();

    ctx.fillStyle = canAfford ? '#fff' : '#999';
    ctx.font = 'bold 11px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    btnText = priceText;
    ctx.fillText(priceText, btnX + btnW / 2, btnY + BTN_H / 2);
  }

  // 记录热区
  _cardRects.push({ x: x, y: y, w: CARD_W, h: CARD_H, skinId: skin.skinId, index: index });
  _btnRects.push({ x: btnX, y: btnY, w: btnW, h: BTN_H, skinId: skin.skinId, index: index, label: btnText });
}

// ===== 敬请期待卡片 =====

function _renderPlaceholderCard(ctx, x, y, index) {
  // 与皮肤卡片同尺寸
  ctx.fillStyle = '#fafafa';
  _roundRect(ctx, x, y, CARD_W, CARD_H, 8);
  ctx.fill();
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.setLineDash([]);

  // 标签
  var labelText = '敬请期待';
  ctx.font = '10px ' + Theme.font.family + '';
  var textW = ctx.measureText(labelText).width;
  var labelW = textW + 16;
  var labelX = x + (CARD_W - labelW) / 2;
  var labelY = y - LABEL_H / 2;

  ctx.fillStyle = '#888';
  _roundRect(ctx, labelX, labelY, labelW, LABEL_H, LABEL_H / 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = '10px ' + Theme.font.family + '';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, labelX + labelW / 2, labelY + LABEL_H / 2);

  // 卡片内提示图标
  ctx.fillStyle = '#ccc';
  ctx.font = '20px ' + Theme.font.family + '';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('🔒', x + CARD_W / 2, y + CARD_H / 2);

  // 无按钮热区（敬请期待不可点击）
  _cardRects.push({ x: x, y: y, w: CARD_W, h: CARD_H, skinId: -1, index: index });
}

// ===== 触摸事件 =====

function handleEvent(e) {
  if (_animator.getPhase() === 'opening') return true;

  if (!_animator.isOpen() || !_panel) return false;
  var p = _panel;

  if (e.type === 'touchstart') {
    var tx = e.x;
    var ty = e.y;

    // 面板外 → 关闭
    if (tx < p.x || tx > p.x + p.w || ty < p.y || ty > p.y + p.h) {
      close();
      return true;
    }

    // 展示区以上 → 头部区域，不处理滚动
    if (ty < _displayTop) {
      // 关闭按钮
      if (_closeRect) {
        var cr = _closeRect;
        if (tx >= cr.x && tx <= cr.x + cr.w && ty >= cr.y && ty <= cr.y + cr.h) {
          close();
          return true;
        }
      }
      return true;
    }

    // 网格区域内
    // 先检查按钮点击
    for (var i = 0; i < _btnRects.length; i++) {
      var br = _btnRects[i];
      if (tx >= br.x && tx <= br.x + br.w && ty >= br.y && ty <= br.y + br.h) {
        _handleBtnClick(br);
        return true;
      }
    }

    // 非按钮区域 → 开始拖拽滚动
    if (_maxScroll > 0) {
      _isDragging = true;
      _dragStartY = ty;
      _dragStartOffset = _scrollOffset;
    }
    return true;
  }

  if (e.type === 'touchmove' && _isDragging) {
    var dy = _dragStartY - e.y;
    _scrollOffset = _dragStartOffset + dy;
    // 弹性边界（超出时加阻尼）
    if (_scrollOffset < 0) {
      _scrollOffset = _scrollOffset * 0.3;
    } else if (_scrollOffset > _maxScroll) {
      var over = _scrollOffset - _maxScroll;
      _scrollOffset = _maxScroll + over * 0.3;
    }
    return true;
  }

  if (e.type === 'touchend' && _isDragging) {
    _isDragging = false;
    // 回弹到边界
    if (_scrollOffset < 0) {
      _scrollOffset = 0;
    } else if (_scrollOffset > _maxScroll) {
      _scrollOffset = _maxScroll;
    }
    return true;
  }

  return false;
}

function _handleBtnClick(btn) {
  if (btn.skinId < 0) return;  // 敬请期待不可点击

  var skinId = btn.skinId;
  var equippedId = SkinSystem.getEquippedSkinId();

  if (skinId === equippedId) return;

  // 未解锁不可操作
  if (!SkinSystem.isUnlocked(skinId)) return;

  if (SkinSystem.isOwned(skinId)) {
    SkinSystem.equipSkin(skinId);
    close();
  } else {
    var result = SkinSystem.buySkin(skinId);
    if (result.ok) {
      console.log('[LOG] ShopPanel 购买成功: skinId=' + skinId + ' name=' + result.skinName);
    }
  }
}

// ===== 工具函数 =====

function _qualityColor(quality) {
  switch (quality) {
    case '传说': return '#FF6D00';
    case '史诗': return '#9C27B0';
    case '稀有': return '#2196F3';
    default:    return '#757575';
  }
}

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

// ===== 刷新（云端配置到达时调用）=====

function refresh() {
  if (!_panel) return;

  var skins = SkinSystem.getAllSkins();
  var totalItems = skins.length + 1;   // +1 = 敬请期待
  var totalRows = Math.ceil(totalItems / COLS);
  var contentH = totalRows * ROW_HEIGHT + 20;

  _maxScroll = Math.max(0, contentH - _displayH + 10);
  _scrollOffset = 0;
}

module.exports = {
  open: open,
  close: close,
  isOpen: isOpen,
  refresh: refresh,
  render: render,
  handleEvent: handleEvent
};
