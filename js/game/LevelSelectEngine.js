// 关卡选择界面引擎
// 正式关卡：读取 assets/levels/index.json，按 chapter.json 分组展示

var databus = require('../databus.js');
var audio = require('../audio/AudioManager.js');
var renderModule = require('../render.js');
var ctx = renderModule.ctx;
var SCREEN_WIDTH = renderModule.SCREEN_WIDTH;
var SCREEN_HEIGHT = renderModule.SCREEN_HEIGHT;
var ButtonPress = require('../anim/ButtonPress.js');

// UI 组件
var LevelCard = require('../ui/widgets/LevelCard.js');
var ChapterHeader = require('../ui/widgets/ChapterHeader.js');
var LevelSelectTopBar = require('../ui/widgets/LevelSelectTopBar.js');

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
  this._sections = [];       // [{ chapter, headerY, cards: [{x,y,w,h,level,globalIndex}] }]
  this._btnPress = new ButtonPress();

  // UI 组件
  this._topBar = null;
  this._chapterHeaders = [];  // ChapterHeader[]
  this._levelCards = [];      // LevelCard[][] — [sectionIndex][cardIndex]

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
  try {
    this.loadProjectLevels();
    this._buildChapterSections();
    this._setupUI();
    this.input.on('levelSelect', this._handleEvent.bind(this));
  } catch (e) {
    console.error('[LevelSelectEngine] activate() 失败:', e);
    this._topBar = null;
    this._chapterHeaders = [];
    this._levelCards = [];
  }
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

  // 优先使用云端版本；未就绪则降级到本地
  var rawList;
  if (databus._cloudIndex && Array.isArray(databus._cloudIndex)) {
    rawList = databus._cloudIndex;
    console.log('[LevelSelect] 使用云端关卡列表: ' + rawList.length + ' 关');
  } else {
    try {
      var indexRaw = fs.readFileSync('assets/levels/index.json', 'utf8');
      rawList = JSON.parse(indexRaw);
    } catch (e) {
      console.warn('[LevelSelect] 读取 index.json 失败:', e);
    }
  }
  if (!rawList || !Array.isArray(rawList)) return;

    for (var i = 0; i < rawList.length; i++) {
      var entry = rawList[i];
      var f = typeof entry === 'string' ? entry : entry.file;
      if (!f || f === 'index.json' || !f.endsWith('.json')) continue;
      var name = f.replace('.json', '');
      this.projectLevels.push({ name: name, file: f });
    }
  // 同步到 databus，供 PlayingEngine "下一关" 使用
  databus.projectLevels = this.projectLevels;
};

// ============================================================
// 按章节分组构建卡片布局
// ============================================================
LevelSelectEngine.prototype._buildChapterSections = function () {
  var self = this;

  // 优先使用云端章节配置；未就绪则降级到本地
  if (databus._cloudChapters && Array.isArray(databus._cloudChapters)) {
    databus.chapters = databus._cloudChapters;
  } else if (!databus._chaptersLoaded) {
    databus._chaptersLoaded = true;
    try {
      var raw = wx.getFileSystemManager().readFileSync('assets/levels/chapter.json', 'utf8');
      databus.chapters = JSON.parse(raw);
      console.log('[LevelSelect] 章节配置加载成功: ' + databus.chapters.length + '章');
    } catch (e) {
      console.warn('[LevelSelect] 加载 chapter.json 失败:', e);
      databus.chapters = [];
    }
  }

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
    console.log('[LevelSelect] _buildChapterSections 完成: ' + this._sections.length + '章节, ' +
      this._sections.reduce(function(a,s){return a+s.cards.length},0) + '卡片, ' +
      'cards[0]=' + (this._sections[0] && this._sections[0].cards[0] ? this._sections[0].cards[0].level.name : '?') +
      ' cards[last]=' + (this._sections[this._sections.length-1] && this._sections[this._sections.length-1].cards.slice(-1)[0] ? this._sections[this._sections.length-1].cards.slice(-1)[0].level.name : '?'));
};

LevelSelectEngine.prototype._getGridTop = function () {
  return databus.safeTop + TOP_BAR_H + 16;
};

// ============================================================
// UI 组件初始化 & 数据同步
// ============================================================
LevelSelectEngine.prototype._setupUI = function () {
  // 顶栏
  this._topBar = new LevelSelectTopBar();

  // 按 sections 结构创建组件
  this._chapterHeaders = [];
  this._levelCards = [];

  for (var s = 0; s < this._sections.length; s++) {
    var section = this._sections[s];
    var chHeader = new ChapterHeader();
    this._chapterHeaders.push(chHeader);

    var cardRow = [];
    for (var i = 0; i < section.cards.length; i++) {
      var lc = new LevelCard();
      cardRow.push(lc);
    }
    this._levelCards.push(cardRow);
  }
};

/** 每帧同步引擎状态 → UI 组件（在 render 之前调用） */
LevelSelectEngine.prototype._syncUIData = function () {
  if (!this._topBar) return;
  // 顶栏
  this._topBar.setData({
    safeTop: databus.safeTop,
    topBarH: TOP_BAR_H,
    title: '选择关卡',
    pressScale: this._btnPress.getScale('back'),
    screenW: SCREEN_WIDTH,
  });

  var completed = this._getCompletedCount();
  var PADDING_X = 20;
  var SECTION_HEADER_H = 28;

  for (var s = 0; s < this._sections.length; s++) {
    var section = this._sections[s];
    var ch = section.chapter;

    // 计算章节内已通关数
    var cleared = 0;
    for (var c = 0; c < section.cards.length; c++) {
      if (section.cards[c].globalIndex < completed) cleared++;
    }

    // 章节标题
    this._chapterHeaders[s].setData({
      x: PADDING_X,
      y: section.headerY + SECTION_HEADER_H / 2,
      w: SCREEN_WIDTH - PADDING_X,
      icon: ch.icon || '',
      name: ch.name,
      themeColor: ch.themeColor || '#EC4899',
      cleared: cleared,
      total: section.cards.length,
    });

    // 卡片
    for (var i = 0; i < section.cards.length; i++) {
      var card = section.cards[i];
      var status = this._getCardStatus(card.globalIndex);

      // 皇冠状态
      var hasCrown = false;
      var levelName = card.level ? card.level.name : null;
      if (levelName) {
        try { hasCrown = !!wx.getStorageSync('crown_' + levelName); } catch (e) {}
      }

      this._levelCards[s][i].setCardData({
        x: card.x,
        y: card.y,
        w: card.w,
        h: card.h,
        radius: CARD_RADIUS,
        globalIndex: card.globalIndex,
        status: status,
        hasCrown: hasCrown,
        pressScale: this._btnPress.getScale('card_' + card.globalIndex),
      });
    }
  }
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
    var bb = this._topBar ? this._topBar.backBtnRect : null;
    if (bb && t.x >= bb.x && t.x <= bb.x + bb.w &&
        t.y >= bb.y && t.y <= bb.y + bb.h) {
      audio.play('button_click');
      this._btnPress.press('back');
      databus.gameState = 'menu';
      return;
    }
  }
};

LevelSelectEngine.prototype._hitTestCards = function (t) {
  var ly = t.y + this._scrollTop;

  for (var s = 0; s < this._sections.length; s++) {
    var section = this._sections[s];
    for (var i = 0; i < section.cards.length; i++) {
      var card = section.cards[i];
      if (t.x >= card.x && t.x <= card.x + card.w &&
          ly >= card.y && ly <= card.y + card.h) {
        if (this._getCardStatus(card.globalIndex) === 'locked') return;
        audio.play('button_click');
        this._btnPress.press('card_' + card.globalIndex);
        var lv = card.level;
        console.log('[LevelSelect] 点击卡片 globalIdx=' + card.globalIndex + ' name=' + lv.name);
        databus.currentLevel = { name: lv.name, data: null };
        databus.currentLevelIndex = card.globalIndex;
        databus.returnState = 'levelSelect';
        databus.gameState = 'playing';
        return;
      }
    }
  }
};

// ============================================================
// 渲染
// ============================================================
LevelSelectEngine.prototype.render = function () {
  if (!this._topBar) return;
  this._syncUIData();

  // 顶栏（固定，不随滚动）
  this._topBar.render(ctx);

  // 章节内容（随滚动偏移）
  ctx.save();
  ctx.translate(0, -this._scrollTop);
  for (var s = 0; s < this._sections.length; s++) {
    var section = this._sections[s];
    this._chapterHeaders[s].render(ctx);
    for (var i = 0; i < section.cards.length; i++) {
      this._levelCards[s][i].render(ctx);
    }
  }
  ctx.restore();
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
