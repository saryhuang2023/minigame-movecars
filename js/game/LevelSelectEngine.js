// 关卡选择界面引擎
// 正式关卡：读取 assets/levels/index.json，按 chapter.json 分组展示

var databus = require('../databus.js');
var renderModule = require('../render.js');
var ctx = renderModule.ctx;
var SCREEN_WIDTH = renderModule.SCREEN_WIDTH;
var drawPigIcon = require('../render/PigIconRenderer.js').drawPigIcon;
var SCREEN_HEIGHT = renderModule.SCREEN_HEIGHT;

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
  cardDoneShadow: 'rgba(236, 72, 153, 0.10)',
  cardCurrentShadow: 'rgba(236, 72, 153, 0.25)',
  cardLockedBg: '#EFE8EE',
  cardLockedShadow: 'rgba(0, 0, 0, 0.04)',
  innerHighlight: 'rgba(255, 255, 255, 0.35)',
  innerHighlightCurrent: 'rgba(255, 255, 255, 0.4)',
};

// ========== 布局常量 ==========
var TOP_BAR_H = 52;
var CARD_W = 50;
var CARD_H = 40;
var GAP = 12;
var ROW_GAP = 12;
var COLS = 5;
var PADDING_X = 20;
var CARD_RADIUS = 6;
var SECTION_HEADER_H =28;
var SECTION_GAP = 4;
var SECTION_MARGIN = 20;

function LevelSelectEngine(input) {
  this.input = input;
  this.projectLevels = [];
  this.backBtn = null;
  this.titleCenterX = 0;
  this.titleCenterY = 0;
  this._sections = [];       // [{ chapter, headerY, cards: [{x,y,w,h,level,globalIndex}] }]

  // 滚动
  this._scrollTop = 0;
  this._maxScrollTop = 0;
  this._touchStartY = 0;
  this._scrollStartTop = 0;
  this._isDragging = false;
  this._dragMoved = false;
}

// ============================================================
// 生命周期
// ============================================================
LevelSelectEngine.prototype.activate = function () {
  this.loadProjectLevels();
  this._buildChapterSections();
  this.input.on('levelSelect', this._handleEvent.bind(this));
};

LevelSelectEngine.prototype.deactivate = function () {
  this.input.off('levelSelect');
};

// ============================================================
// 加载正式关卡列表
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
// 按章节分组构建卡片布局
// ============================================================
LevelSelectEngine.prototype._buildChapterSections = function () {
  var self = this;
  var chapters = databus.chapters;
  if (!chapters || chapters.length === 0) {
    this._sections = [];
    return;
  }

  var contentW = CARD_W * COLS + GAP * (COLS - 1);
  var startX = (SCREEN_WIDTH - contentW) / 2;

  // 第一步：将关卡分配到对应章节
  var chapterBuckets = [];
  for (var c = 0; c < chapters.length; c++) {
    chapterBuckets.push([]);
  }

  var prevEnd = -1;
  for (var chIdx = 0; chIdx < chapters.length; chIdx++) {
    var ch = chapters[chIdx];
    var levelStart = prevEnd + 1;
    var levelEnd = Math.min(ch.endIndex, this.projectLevels.length - 1);
    for (var gi = levelStart; gi <= levelEnd; gi++) {
      chapterBuckets[chIdx].push(gi);
    }
    prevEnd = ch.endIndex;
    if (prevEnd >= this.projectLevels.length - 1) break;
  }

  // 第二步：计算每个章节的 Y 坐标和卡片位置
  var y = this._getGridTop();
  this._sections = [];

  for (var s = 0; s < chapters.length; s++) {
    var bucket = chapterBuckets[s];
    if (bucket.length === 0 && s < chapters.length - 1) {
      // 空章节也显示标题（让玩家看到锁住的章节区域）
      // 但至少放半行占位
    }
    if (bucket.length === 0) continue;

    var section = {
      chapter: chapters[s],
      chapterIndex: s,
      headerY: y,
      cards: []
    };

    y += SECTION_HEADER_H + SECTION_GAP;

    for (var k = 0; k < bucket.length; k++) {
      var globalIdx = bucket[k];
      var col = k % COLS;
      var row = Math.floor(k / COLS);
      section.cards.push({
        x: startX + col * (CARD_W + GAP),
        y: y + row * (CARD_H + ROW_GAP),
        w: CARD_W,
        h: CARD_H,
        level: self.projectLevels[globalIdx],
        globalIndex: globalIdx
      });
    }

    var rows = Math.ceil(bucket.length / COLS) || 0;
    y += rows * (CARD_H + ROW_GAP) + SECTION_MARGIN;

    this._sections.push(section);
  }

  // 第三步：更新滚动范围
  var visibleH = SCREEN_HEIGHT - 60;
  this._maxScrollTop = Math.max(0, y - SECTION_MARGIN - visibleH);
  if (this._maxScrollTop < 0) this._maxScrollTop = 0;
  this._scrollTop = 0;
};

LevelSelectEngine.prototype._getGridTop = function () {
  return databus.safeTop + TOP_BAR_H + 16;
};

// ============================================================
// 关卡状态判断
// ============================================================
LevelSelectEngine.prototype._getCompletedCount = function () {
  try {
    var idx = wx.getStorageSync('lastLevelIndex');
    if (typeof idx === 'number' && idx >= 0) return idx;
  } catch (e) { /* ignore */ }
  return -1;
};

/**
 * @param {number} globalIndex - 关卡在 projectLevels 中的全局索引
 * @returns {string} 'completed' | 'current' | 'locked'
 */
LevelSelectEngine.prototype._getCardStatus = function (globalIndex) {
  var completed = this._getCompletedCount();
  if (globalIndex < completed) return 'completed';
  if (globalIndex === completed) return 'current';
  if (globalIndex === 0 && completed < 0) return 'current';
  return 'locked';
};

// ============================================================
// 事件处理
// ============================================================
LevelSelectEngine.prototype._handleEvent = function (e) {
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
    if (this._dragMoved) return;
    this._hitTestCards(t);
  }

  // 返回按钮（不受滚动影响）
  if (e.type === 'touchstart') {
    if (this.backBtn && t.x >= this.backBtn.x && t.x <= this.backBtn.x + this.backBtn.w &&
        t.y >= this.backBtn.y && t.y <= this.backBtn.y + this.backBtn.h) {
      databus.gameState = 'menu';
      return;
    }
  }
};

LevelSelectEngine.prototype._hitTestCards = function (t) {
  var ly = t.y + this._scrollTop;
  var fs = wx.getFileSystemManager();

  for (var s = 0; s < this._sections.length; s++) {
    var section = this._sections[s];
    for (var i = 0; i < section.cards.length; i++) {
      var card = section.cards[i];
      if (t.x >= card.x && t.x <= card.x + card.w &&
          ly >= card.y && ly <= card.y + card.h) {
        if (this._getCardStatus(card.globalIndex) === 'locked') return;
        var lv = card.level;
        try {
          var raw = fs.readFileSync('assets/levels/' + lv.file, 'utf8');
          databus.currentLevel = { name: lv.name, data: JSON.parse(raw) };
          databus.currentLevelIndex = card.globalIndex;
          databus.returnState = 'levelSelect';
          databus.gameState = 'playing';
        } catch (err) {
          console.warn('[LevelSelect] 加载关卡 ' + lv.file + ' 失败:', err);
          wx.showToast({ title: '加载关卡失败', icon: 'none', duration: 1500 });
        }
        return;
      }
    }
  }
};

// ============================================================
// 渲染
// ============================================================
LevelSelectEngine.prototype.render = function () {
  this._renderTopBar();

  ctx.save();
  ctx.translate(0, -this._scrollTop);
  for (var s = 0; s < this._sections.length; s++) {
    this._renderChapterSection(this._sections[s]);
  }
  ctx.restore();
};

// ========== 顶栏 ==========
LevelSelectEngine.prototype._renderTopBar = function () {
  var barY = databus.safeTop;
  var barCY = barY + TOP_BAR_H / 2;

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

// ========== 章节标题 ==========
LevelSelectEngine.prototype._renderChapterHeader = function (section, y) {
  var ch = section.chapter;
  var completed = this._getCompletedCount();
  var chStart = section.cards.length > 0 ? section.cards[0].globalIndex : 0;
  var chEnd = section.cards.length > 0 ? section.cards[section.cards.length - 1].globalIndex : 0;

  // 计算章节内已通关数量
  var cleared = 0;
  for (var c = 0; c < section.cards.length; c++) {
    if (section.cards[c].globalIndex < completed) cleared++;
  }

  var iconX = PADDING_X;
  var iconCY = y + SECTION_HEADER_H / 2;

  // 图标
  ctx.font = '16px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch.icon || '', iconX, iconCY);

  // 章节名
  var nameX = iconX + 26;
  ctx.fillStyle = ch.themeColor || C.primary;
  ctx.font = 'bold 14px sans-serif';
  ctx.fillText(ch.name, nameX, iconCY);

  // 进度文字（右侧）
  var total = section.cards.length;
  ctx.fillStyle = C.textMuted;
  ctx.font = '12px sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(cleared + '/' + total, SCREEN_WIDTH - PADDING_X, iconCY);
};

// ========== 单章渲染 ==========
LevelSelectEngine.prototype._renderChapterSection = function (section) {
  // 章节标题
  this._renderChapterHeader(section, section.headerY);

  // 关卡卡片
  for (var i = 0; i < section.cards.length; i++) {
    var card = section.cards[i];
    var status = this._getCardStatus(card.globalIndex);
    this._renderCard(card, status);
  }
};

// ========== 单个关卡卡片 ==========
LevelSelectEngine.prototype._renderCard = function (card, status) {
  var x = card.x;
  var y = card.y;
  var w = card.w;
  var h = card.h;
  var cx = x + w / 2;
  var cy = y + h / 2;
  var r = CARD_RADIUS;

  // 编号文字：全局索引 + 1
  var labelNumber = String(card.globalIndex + 1);

  // === locked（无锁图标，灰色即代表未解锁） ===
  if (status === 'locked') {
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

    ctx.fillStyle = C.textLocked;
    ctx.font = 'bold 20px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelNumber, cx, cy);
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

  // 内高光描边
  ctx.strokeStyle = isCurrent ? C.innerHighlightCurrent : C.innerHighlight;
  ctx.lineWidth = 1;
  this._roundRect(ctx, x + 1, y + 1, w - 2, h - 2, r - 1);
  ctx.stroke();

  // 编号文字（变大变粗，居中）
  ctx.fillStyle = isCurrent ? C.primary : C.textDark;
  ctx.font = isCurrent ? 'bold 20px sans-serif' : 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelNumber, cx, cy);

  // 右上角小金猪（金色=已获得皇冠，灰色=未获得）
  var hasCrown = false;
  if (status === 'completed') {
    var levelName = card.level ? card.level.name : null;
    if (levelName) {
      try {
        hasCrown = !!wx.getStorageSync('crown_' + levelName);
      } catch (e) {}
    }
    // 只有获得小金猪才显示（金色），未获得不显示任何猪图标
    if (hasCrown) {
      drawPigIcon(ctx, x + w - 4, y + 4, 14, true);
    }
  }

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
