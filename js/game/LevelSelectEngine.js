// 关卡选择界面引擎
// 正式关卡：读取工程目录 assets/levels/index.json
// 设计中的关卡：所有云端关卡（与正式关卡去重后）

var databus = require('../databus.js');
var renderModule = require('../render.js');
var ctx = renderModule.ctx;
var SCREEN_WIDTH = renderModule.SCREEN_WIDTH;
var SCREEN_HEIGHT = renderModule.SCREEN_HEIGHT;
var cloud = require('../cloud.js');

// ========== 配色（v3 设计） ==========
var C = {
  primary: '#EC4899',        // 蜜桃粉
  primaryDark: '#DB2777',    // 深粉
  secondary: '#FFFFFF',      // 卡片白
  accent: '#F59E0B',         // 金色 — 通关/强调
  textDark: '#0F172A',       // 深色文字
  textMuted: '#94A3B8',      // 灰色文字
  textLocked: '#ADB5C4',     // 锁定数字灰
  cyan: '#0EC9C5',            // 返回按钮青
  cyanShadow: 'rgba(14, 201, 197, 0.3)',
  cardDoneShadow: 'rgba(236, 72, 153, 0.10)',   // 已完成卡片粉影
  cardCurrentShadow: 'rgba(236, 72, 153, 0.25)', // 当前关卡发光
  cardLockedBg: '#EFE8EE',   // 锁定卡片底色
  cardLockedShadow: 'rgba(0, 0, 0, 0.04)',
  innerHighlight: 'rgba(255, 255, 255, 0.35)',
  innerHighlightCurrent: 'rgba(255, 255, 255, 0.4)',
};

// ========== 布局常量（v3: 4列 80×80 卡片） ==========
var TOP_BAR_H = 52;
var CARD_W = 80;
var CARD_H = 80;
var GAP = 10;       // 列间距
var ROW_GAP = 12;   // 行间距
var COLS = 4;
var PADDING_X = 20;
var CARD_RADIUS = 16;

// 模块级缓存：云端关卡列表（null = 未拉取）
var _cloudListCache = null;

function LevelSelectEngine(input) {
  this.input = input;
  this.projectLevels = [];    // 正式关卡
  this.cloudLevels = [];      // 设计中的关卡（所有云端关卡）
  this.projectCards = [];     // 正式关卡卡片
  this.cloudCards = [];       // 设计中关卡卡片
  this.backBtn = null;
  this.titleCenterX = 0;
  this.titleCenterY = 0;
  this.cloudSectionTop = 0;
  this._scrollTop = 0;
  this._maxScrollTop = 0;

  // 滚动状态
  this._touchStartY = 0;
  this._scrollStartTop = 0;
  this._isDragging = false;
  this._dragMoved = false;

  // 云端加载状态
  this._cloudLoading = false;
  this._cloudLoadingMsg = '';
}

LevelSelectEngine.prototype.activate = function () {
  this.loadProjectLevels();
  this.buildProjectCards();
  this.buildCloudCards();
  this.input.on('levelSelect', this._handleEvent.bind(this));

  if (_cloudListCache === null) {
    // 首次：异步拉取云端关卡
    this._cloudLoading = true;
    this._cloudLoadingMsg = '同步云端关卡中...';
    this._fetchCloudLevels().finally(function () {
      this._cloudLoading = false;
    }.bind(this));
  } else {
    // 已有缓存：直接使用
    this._fetchCloudLevels();
  }
};

LevelSelectEngine.prototype.deactivate = function () {
  this.input.off('levelSelect');
  this._cloudLoading = false;
};

// ============================================================
// 正式关卡：读取 assets/levels/index.json
// ============================================================
LevelSelectEngine.prototype.loadProjectLevels = function () {
  this.projectLevels = [];
  var fs = wx.getFileSystemManager();
  try {
    var indexRaw = fs.readFileSync('assets/levels/index.json', 'utf8');
    var rawList = JSON.parse(indexRaw);
    if (!Array.isArray(rawList)) return;

    for (var i = 0; i < rawList.length; i++) {
      var entry = rawList[i];
      var f = typeof entry === 'string' ? entry : entry.file;
      if (!f || f === 'index.json' || !f.endsWith('.json')) continue;
      var name = f.replace('.json', '');
      var extra = typeof entry === 'object' ? cloneObj(entry) : {};
      delete extra.file;
      this.projectLevels.push({ name: name, file: f, type: extra.type, progress: extra.progress });
    }
  } catch (e) {
    console.warn('[LevelSelect] 读取 index.json 失败:', e);
  }
  // 同步到 databus，供 PlayingEngine "下一关" 使用
  databus.projectLevels = this.projectLevels;
};

// ============================================================
// 云端关卡：全部归入"设计中"分类
// ============================================================
LevelSelectEngine.prototype._fetchCloudLevels = function () {
  var self = this;
  if (_cloudListCache !== null) {
    // 已有缓存：直接应用
    self._applyCloudList(_cloudListCache);
    self.buildCloudCards();
    return Promise.resolve();
  }
  // 无缓存：拉取云端
  return cloud.listLevels().then(function (list) {
    _cloudListCache = list;
    self._applyCloudList(list);
  }).catch(function (e) {
    console.warn('[LevelSelect] 拉取云端关卡失败:', e);
    self.cloudLevels = [];
  }).then(function () {
    self.buildCloudCards();
  });
};

// 将云端原始列表与正式关卡去重后写入 cloudLevels
LevelSelectEngine.prototype._applyCloudList = function (list) {
  var projectNames = {};
  for (var i = 0; i < this.projectLevels.length; i++) {
    projectNames[this.projectLevels[i].name] = true;
  }
  this.cloudLevels = [];
  for (var j = 0; j < list.length; j++) {
    var item = list[j];
    if (projectNames[item.name]) continue;
    this.cloudLevels.push({
      name: item.name,
      _id: item._id,
      _needsDownload: true,
    });
  }
};

// ============================================================
// 卡片布局
// ============================================================
LevelSelectEngine.prototype._getGridTop = function () {
  return databus.safeTop + TOP_BAR_H + 16;
};

LevelSelectEngine.prototype._buildCardsForLevels = function (levels, gridTop) {
  var contentW = CARD_W * COLS + GAP * (COLS - 1);
  var startX = (SCREEN_WIDTH - contentW) / 2;
  var cards = [];
  for (var i = 0; i < levels.length; i++) {
    var lv = levels[i];
    var col = i % COLS;
    var row = Math.floor(i / COLS);
    cards.push({
      x: startX + col * (CARD_W + GAP),
      y: gridTop + row * (CARD_H + ROW_GAP),
      w: CARD_W,
      h: CARD_H,
      level: lv,
      index: i,  // 卡片在数组中的序号
    });
  }
  return cards;
};

LevelSelectEngine.prototype.buildProjectCards = function () {
  this.cloudSectionTop = 0;
  var gridTop = this._getGridTop();
  this.projectCards = this._buildCardsForLevels(this.projectLevels, gridTop);
  this._scrollTop = 0;
};

LevelSelectEngine.prototype._updateCloudSectionTop = function () {
  var projectRows = Math.ceil(this.projectLevels.length / COLS) || 0;
  var sectionHeaderH = 28;
  this.cloudSectionTop = this._getGridTop()
    + projectRows * (CARD_H + ROW_GAP)
    + sectionHeaderH + 12;    // 正式关卡区域结束
};

LevelSelectEngine.prototype._updateScrollBounds = function () {
  var allCards = this.projectCards.concat(this.cloudCards);
  if (allCards.length === 0) {
    this._maxScrollTop = 0;
    return;
  }
  var maxBottom = 0;
  for (var i = 0; i < allCards.length; i++) {
    var b = allCards[i].y + allCards[i].h;
    if (b > maxBottom) maxBottom = b;
  }
  // 底部留 60px 余量
  var visibleBottom = SCREEN_HEIGHT - 60;
  this._maxScrollTop = Math.max(0, maxBottom - visibleBottom);
  // 如果当前滚动超出上限则修正
  if (this._scrollTop > this._maxScrollTop) this._scrollTop = this._maxScrollTop;
  if (this._scrollTop < 0) this._scrollTop = 0;
};

LevelSelectEngine.prototype.buildCloudCards = function () {
  this._updateCloudSectionTop();
  this.cloudCards = this._buildCardsForLevels(this.cloudLevels, this.cloudSectionTop);
  this._updateScrollBounds();
};

// ============================================================
// 关卡状态判断
// ============================================================

/**
 * 获取玩家的进度（已通关到的关卡索引）
 * 存入 wx storage 的 lastLevelIndex 表示"已打到第几关"
 * 返回 -1 表示没有进度（全部锁定，只有第0关可玩）
 */
LevelSelectEngine.prototype._getCompletedCount = function () {
  try {
    var idx = wx.getStorageSync('lastLevelIndex');
    if (typeof idx === 'number' && idx >= 0) return idx;
  } catch (e) { /* ignore */ }
  return -1;
};

/**
 * 返回卡片状态
 * @param {number} cardIndex - 卡片在 projectCards 中的索引
 * @returns {string} 'completed' | 'current' | 'locked'
 */
LevelSelectEngine.prototype._getCardStatus = function (cardIndex) {
  var completed = this._getCompletedCount();
  if (cardIndex < completed) return 'completed';   // 已通关
  if (cardIndex === completed) return 'current';   // 当前可玩
  // 第0关永远可玩
  if (cardIndex === 0 && completed < 0) return 'current';
  return 'locked';
};

// ============================================================
// 事件处理
// ============================================================
LevelSelectEngine.prototype._handleEvent = function (e) {
  // 云端加载中，屏蔽所有操作
  if (this._cloudLoading) return;

  var t = (e.touches[0] || (e.changedTouches && e.changedTouches[0]));
  if (!t) return;

  if (e.type === 'touchstart') {
    this._isDragging = true;
    this._dragMoved = false;
    this._touchStartY = t.y;
    this._scrollStartTop = this._scrollTop;
  }

  if (e.type === 'touchmove' && this._isDragging) {
    var dy = t.y - this._touchStartY;
    // 只有移动超过 6px 才算拖拽
    if (Math.abs(dy) > 6) {
      this._dragMoved = true;
    }
    if (this._dragMoved) {
      this._scrollTop = this._scrollStartTop - dy;
      if (this._scrollTop < 0) this._scrollTop = 0;
      if (this._scrollTop > this._maxScrollTop) this._scrollTop = this._maxScrollTop;
    }
  }

  if (e.type === 'touchend') {
    this._isDragging = false;
    // 如果发生了拖拽，不触发点击
    if (this._dragMoved) return;
    // 没拖拽，视为点击
    this._hitTestCards(t);
  }

  // 始终检查返回按钮（不受滚动影响）
  if (e.type === 'touchstart') {
    if (this.backBtn && t.x >= this.backBtn.x && t.x <= this.backBtn.x + this.backBtn.w &&
        t.y >= this.backBtn.y && t.y <= this.backBtn.y + this.backBtn.h) {
      databus.gameState = 'menu';
      return;
    }
  }
};

LevelSelectEngine.prototype._hitTestCards = function (t) {
  // 还原滚动偏移后的逻辑坐标
  var ly = t.y + this._scrollTop;

  // 正式关卡卡片
  for (var i = 0; i < this.projectCards.length; i++) {
    var card = this.projectCards[i];
    if (this._hitCardAt(card, t.x, ly)) {
      if (this._getCardStatus(i) === 'locked') return;
      var lv = card.level;
      try {
        var fs = wx.getFileSystemManager();
        var raw = fs.readFileSync('assets/levels/' + lv.file, 'utf8');
        databus.currentLevel = { name: lv.name, data: JSON.parse(raw) };
        databus.currentLevelIndex = i;
        databus.returnState = 'levelSelect';
        databus.gameState = 'playing';
      } catch (err) {
        console.warn('[LevelSelect] 加载关卡 ' + lv.file + ' 失败:', err);
        wx.showToast({ title: '加载关卡失败', icon: 'none', duration: 1500 });
      }
      return;
    }
  }

  // 设计中的关卡卡片
  for (var k = 0; k < this.cloudCards.length; k++) {
    var cCard = this.cloudCards[k];
    if (this._hitCardAt(cCard, t.x, ly)) {
      this._playCloudLevel(cCard.level);
      return;
    }
  }
};

LevelSelectEngine.prototype._playCloudLevel = function (lv) {
  var self = this;
  this._cloudLoading = true;
  this._cloudLoadingMsg = '加载关卡中...';
  cloud.downloadLevel(lv._id).then(function (fullDoc) {
    if (fullDoc && fullDoc.data) {
      databus.currentLevel = { name: lv.name, data: fullDoc.data };
      databus.returnState = 'levelSelect';
      databus.gameState = 'playing';
    }
  }).catch(function (err) {
    console.warn('[LevelSelect] 下载云端关卡 ' + lv.name + ' 失败:', err);
  }).then(function () {
    self._cloudLoading = false;
  });
};

LevelSelectEngine.prototype._hitCardAt = function (card, tx, ty) {
  return tx >= card.x && tx <= card.x + card.w &&
         ty >= card.y && ty <= card.y + card.h;
};

// ============================================================
// 渲染
// ============================================================

// 背景由 GameEngine.drawBackground() 统一绘制（天空渐变）
// 这里不再画背景

LevelSelectEngine.prototype.render = function () {
  this._renderTopBar();

  // 滚动内容区域：用 canvas translate 偏移
  ctx.save();
  ctx.translate(0, -this._scrollTop);
  this._renderProjectSection();
  this._renderCloudSection();
  ctx.restore();

  if (this._cloudLoading) this._renderCloudLoading();
};

// ========== 顶栏（v3: 48px 青色圆形返回按钮 + 居中标题） ==========
LevelSelectEngine.prototype._renderTopBar = function () {
  var barY = databus.safeTop;
  var barCY = barY + TOP_BAR_H / 2;

  // 大圆形返回按钮 — 青色底
  var btnSize = 48;
  var btnX = PADDING_X;
  var btnY = barY + (TOP_BAR_H - btnSize) / 2;
  var btnCX = btnX + btnSize / 2;
  var btnCY_box = btnY + btnSize / 2;
  this.backBtn = { x: btnX, y: btnY, w: btnSize, h: btnSize };

  // 阴影
  ctx.save();
  ctx.shadowColor = C.cyanShadow;
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.arc(btnCX, btnCY_box, btnSize / 2, 0, Math.PI * 2);
  ctx.fillStyle = C.cyan;
  ctx.fill();
  ctx.restore();

  // 主体
  ctx.beginPath();
  ctx.arc(btnCX, btnCY_box, btnSize / 2, 0, Math.PI * 2);
  ctx.fillStyle = C.cyan;
  ctx.fill();

  // 白色箭头 <
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(btnCX + 5, btnCY_box - 7);
  ctx.lineTo(btnCX - 4, btnCY_box);
  ctx.lineTo(btnCX + 5, btnCY_box + 7);
  ctx.stroke();

  // 居中标题 "选择关卡"
  ctx.fillStyle = C.textDark;
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('选择关卡', SCREEN_WIDTH / 2, barCY);

  this.titleCenterX = SCREEN_WIDTH / 2;
  this.titleCenterY = barCY;
};

// ========== 区域标题 ==========
LevelSelectEngine.prototype._renderSectionLabel = function (title, countStr, topY) {
  ctx.fillStyle = C.textDark;
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(title, PADDING_X, topY);

  // 计数（金色）
  if (countStr) {
    ctx.fillStyle = C.accent;
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(countStr, SCREEN_WIDTH - PADDING_X, topY);
  }
};

LevelSelectEngine.prototype._renderProjectSection = function () {
  if (this.projectCards.length === 0) return;

  for (var i = 0; i < this.projectCards.length; i++) {
    var card = this.projectCards[i];
    var status = this._getCardStatus(i);
    this._renderCard(card, status);
  }
};

LevelSelectEngine.prototype._renderCloudSection = function () {
  if (this.cloudCards.length === 0) return;

  var labelY = this.cloudSectionTop - 16;
  this._renderSectionLabel('🔧 设计中', this.cloudCards.length + ' 关', labelY);

  for (var i = 0; i < this.cloudCards.length; i++) {
    this._renderCard(this.cloudCards[i], 'waiting');
  }
};

// ========== 单个关卡卡片（v3 设计：80×80，4列网格） ==========
/**
 * @param {object} card - { x, y, w, h, level, index }
 * @param {string} status - 'completed' | 'current' | 'locked' | 'waiting'
 */
LevelSelectEngine.prototype._renderCard = function (card, status) {
  var x = card.x;
  var y = card.y;
  var w = card.w;
  var h = card.h;
  var cx = x + w / 2;
  var cy = y + h / 2;
  var r = CARD_RADIUS;

  // 编号文字：正式关卡用 index+1，云端关卡用 level.name
  var labelNumber = (status !== 'waiting' && card.index !== undefined)
    ? String(card.index + 1)
    : (card.level && card.level.name ? card.level.name : '');

  // === waiting（设计中）：虚线边框 ===
  if (status === 'waiting') {
    // 柔投影
    ctx.save();
    ctx.shadowColor = C.cardLockedShadow;
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    this._roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = C.cardLockedBg;
    ctx.fill();
    ctx.restore();

    this._roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = C.cardLockedBg;
    ctx.fill();

    // 虚线边框
    ctx.save();
    if (ctx.setLineDash) ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(236, 72, 153, 0.15)';
    ctx.lineWidth = 1.5;
    this._roundRect(ctx, x, y, w, h, r);
    ctx.stroke();
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.restore();

    // 编号
    ctx.fillStyle = C.textLocked;
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelNumber, cx, cy - 8);

    // ⏳ 图标
    ctx.font = '13px sans-serif';
    ctx.fillText('⏳', cx, cy + 18);
    return;
  }

  // === locked（锁定关卡） ===
  if (status === 'locked') {
    // 轻阴影
    ctx.save();
    ctx.shadowColor = C.cardLockedShadow;
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 2;
    this._roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = C.cardLockedBg;
    ctx.fill();
    ctx.restore();

    // 主体：浅灰底色
    this._roundRect(ctx, x, y, w, h, r);
    ctx.fillStyle = C.cardLockedBg;
    ctx.fill();

    // 编号（灰色）
    ctx.fillStyle = C.textLocked;
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelNumber, cx, cy - 8);

    // 🔒 锁图标
    ctx.font = '12px sans-serif';
    ctx.fillText('🔒', cx, cy + 16);
    return;
  }

  // === completed / current ===
  var isCurrent = (status === 'current');

  // 外阴影
  ctx.save();
  ctx.shadowColor = isCurrent ? C.cardCurrentShadow : C.cardDoneShadow;
  ctx.shadowBlur = isCurrent ? 14 : 8;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = isCurrent ? 4 : 3;
  this._roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = C.secondary;
  ctx.fill();
  ctx.restore();

  // 主体白色卡片
  this._roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = C.secondary;
  ctx.fill();

  // 当前关卡：粉色描边
  if (isCurrent) {
    ctx.strokeStyle = C.primary;
    ctx.lineWidth = 2.5;
    ctx.globalAlpha = 0.85;
    this._roundRect(ctx, x, y, w, h, r);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // 内高光描边（模拟 Claymorphism inner shadow）
  ctx.strokeStyle = isCurrent ? C.innerHighlightCurrent : C.innerHighlight;
  ctx.lineWidth = 1;
  this._roundRect(ctx, x + 1, y + 1, w - 2, h - 2, r - 1);
  ctx.stroke();

  // 当前关卡：🚩 旗帜图标（放在上面）
  if (isCurrent) {
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🚩', cx, cy - 18);
  }

  // 编号文字
  ctx.fillStyle = isCurrent ? C.primary : C.textDark;
  ctx.font = isCurrent ? 'bold 24px sans-serif' : 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelNumber, cx, cy - (isCurrent ? 2 : 6));

  // 已完成：⭐ 星星
  if (!isCurrent) {
    ctx.font = '12px sans-serif';
    ctx.fillText('⭐', cx, cy + 20);
  }
};

// ========== 云端加载遮罩 ==========
LevelSelectEngine.prototype._renderCloudLoading = function () {
  // 半透明遮罩
  ctx.fillStyle = 'rgba(15, 23, 42, 0.4)';
  ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

  var bw = 220;
  var bh = 80;
  var bx = (SCREEN_WIDTH - bw) / 2;
  var by = (SCREEN_HEIGHT - bh) / 2;

  // 白色卡片
  ctx.save();
  ctx.shadowColor = C.cardDoneShadow;
  ctx.shadowBlur = 16;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4;
  this._roundRect(ctx, bx, by, bw, bh, 16);
  ctx.fillStyle = C.secondary;
  ctx.fill();
  ctx.restore();

  this._roundRect(ctx, bx, by, bw, bh, 16);
  ctx.fillStyle = C.secondary;
  ctx.fill();

  this._roundRect(ctx, bx, by, bw, bh, 16);
  ctx.strokeStyle = 'rgba(236, 72, 153, 0.2)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 提示文字
  ctx.fillStyle = C.textDark;
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(this._cloudLoadingMsg, bx + bw / 2, by + 33);

  ctx.fillStyle = C.textMuted;
  ctx.font = '12px sans-serif';
  ctx.fillText('请稍后', bx + bw / 2, by + 54);
};

// ========== Canvas 工具 ==========
LevelSelectEngine.prototype._roundRect = function (ctx, x, y, w, h, r) {
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
};

// ========== 辅助函数 ==========
function cloneObj(obj) {
  var result = {};
  for (var key in obj) {
    if (obj.hasOwnProperty(key)) result[key] = obj[key];
  }
  return result;
}

module.exports = LevelSelectEngine;
