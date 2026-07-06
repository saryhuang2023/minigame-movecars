// 关卡选择界面引擎 v2 — 垂直滚动 + 章节卡片
// 使用本地 chapter.json，云端背景图按需加载

var databus = require('../databus.js');
var audio = require('../audio/AudioManager.js');
var renderModule = require('../render.js');
var ctx = renderModule.ctx;
var SCREEN_WIDTH = renderModule.SCREEN_WIDTH;
var SCREEN_HEIGHT = renderModule.SCREEN_HEIGHT;
var AssetPreloader = require('../ui/AssetPreloader.js');
var Theme = require('../define/GameDefine.js').THEME;

var ChapterSection = require('../ui/widgets/ChapterSection.js');
var ShopPanel = require('../ui/ShopPanel.js');

// ========== 布局常量 ==========
var BACK_IMG_W = 32, BACK_IMG_H = 32;
var BACK_LEFT = 16, BACK_TOP = 45;
var TITLE_Y = 49;

// ========== 滚动物理 ==========
var FRICTION = 0.95;
var BOUNCE_STIFFNESS = 0.2;
var MIN_VELOCITY = 0.5;
var OVERSCROLL_MAX = 120;

function LevelSelectEngine(input) {
  this.input = input;
  this.projectLevels = [];
  this._sections = [];       // ChapterSection[]
  this._needsRebuild = false;

  // 滚动状态
  this._scrollY = 0;
  this._maxScrollY = 0;
  this._touchStartY = 0;
  this._scrollStartY = 0;
  this._isDragging = false;
  this._velocity = 0;
  this._lastTouchY = 0;
  this._lastTouchTime = 0;
  this._justActivated = false;

  // 当前章节索引
  this._currentChIdx = 0;
}

// ============================================================
// 生命周期
// ============================================================
LevelSelectEngine.prototype.activate = function () {
  try {
    this._justActivated = true;

    if (this._sections.length === 0 || this._needsRebuild) {
      this.loadProjectLevels();
      this._buildSections();
      this._needsRebuild = false;
    }

    // 滚动到当前章节
    if (this._sections.length > 0) {
      var chIdx = this._getCurrentChapterIdx();
      var sy = 0;
      for (var i = 0; i < chIdx; i++) {
        sy += this._sections[i].getHeight() + CARD_GAP;
      }
      this._scrollY = Math.max(0, sy - 40);
      if (this._scrollY > this._maxScrollY) this._scrollY = this._maxScrollY;
    }

    this.input.on('levelSelect', this._handleEvent.bind(this));
  } catch (e) {
    console.error('[LevelSelectEngine] activate() 失败:', e);
    this._sections = [];
  }
};

LevelSelectEngine.prototype.deactivate = function () {
  this.input.off('levelSelect');
};

// ============================================================
// 关卡列表加载 — 复用 GameEngine 已构建的 projectLevels
// ============================================================
LevelSelectEngine.prototype.loadProjectLevels = function () {
  // 优先使用 databus.projectLevels（GameEngine 加载阶段已完成本地+云端合并）
  if (databus.projectLevels && databus.projectLevels.length > 0) {
    this.projectLevels = databus.projectLevels;
    return;
  }

  // 兜底：自己构建
  this.projectLevels = [];
  var fs = wx.getFileSystemManager();
  var localMax = 0;
  try {
    var indexRaw = fs.readFileSync('assets/levels/index.json', 'utf8');
    var indexData = JSON.parse(indexRaw);
    if (typeof indexData.maxLevel === 'number') localMax = indexData.maxLevel;
    else if (Array.isArray(indexData)) localMax = indexData.length;
  } catch (e) {
    console.warn('[LevelSelect] 读取 index.json 失败:', e);
  }
  var cloudMax = databus._cloudMaxLevel || 0;
  var maxLevel = Math.max(localMax, cloudMax);
  if (maxLevel <= 0) return;
  for (var i = 0; i < maxLevel; i++) {
    var name = String(i + 1).padStart(4, '0');
    this.projectLevels.push({ name: name, file: name + '.json' });
  }
  databus.projectLevels = this.projectLevels;
};

// ============================================================
// 构建章节卡片
// ============================================================
LevelSelectEngine.prototype._buildSections = function () {
  // 加载章节配置
  if (!databus._chaptersLoaded) {
    databus._chaptersLoaded = true;
    try {
      var raw = wx.getFileSystemManager().readFileSync('assets/levels/chapter.json', 'utf8');
      databus.chapters = JSON.parse(raw);
    } catch (e) {
      databus.chapters = [];
    }
  }

  var chapters = databus.chapters;
  if (!chapters || chapters.length === 0) {
    this._sections = [];
    return;
  }

  // 确定当前章节
  this._currentChIdx = this._getCurrentChapterIdx();

  // 分配关卡到章节
  var prevEnd = -1;
  this._sections = [];
  var cardW = SCREEN_WIDTH - 40;  // 卡片宽度 = 屏宽 - 左右各20
  var cardX = 20;

  for (var chIdx = 0; chIdx < chapters.length; chIdx++) {
    var ch = chapters[chIdx];
    var start = prevEnd + 1;
    var end = Math.min(ch.endIndex, this.projectLevels.length - 1);
    var levelList = [];
    for (var gi = start; gi <= end; gi++) {
      levelList.push(this.projectLevels[gi]);
    }
    prevEnd = ch.endIndex;

    if (levelList.length === 0) continue;

    var isCurrent = (chIdx === this._currentChIdx);
    var isFuture = (chIdx > this._currentChIdx);

    // 计算本章奖杯数（当前+之前章节都用同一规则）
    var chapterCrowns = 0;
    for (var ci = start; ci <= end; ci++) {
      if (wx.getStorageSync('crown_' + ci)) chapterCrowns++;
    }
    var unlocked = chapterCrowns >= (ch.unlock_crown_num || 0);

    var section = new ChapterSection({
      chapter: ch,
      levels: levelList,
      startIndex: start,
      chIdx: chIdx,
      isCurrent: isCurrent,
      isFuture: isFuture,
      unlocked: unlocked,
      cardW: cardW,
      onLevelTap: this._onLevelTap.bind(this),
      onDressUp: this._onDressUp.bind(this),
    });

    section.x = cardX;
    section.y = 0; // 运行时计算

    // 当前和已通过的章节：按需加载背景图
    if (!isFuture) {
      section.loadBgImage();
    }

    this._sections.push(section);
  }

  // 计算各节 Y 坐标和总滚动高度
  var totalY = 113;  // 第一张卡片起始Y
  for (var s = 0; s < this._sections.length; s++) {
    this._sections[s].y = totalY;
    totalY += this._sections[s].getHeight() + CARD_GAP;
  }
  this._maxScrollY = Math.max(0, totalY - CARD_GAP - SCREEN_HEIGHT + 100);
};

// ============================================================
// 滚动物理
// ============================================================
LevelSelectEngine.prototype._updateScroll = function () {
  if (!this._isDragging) {
    if (Math.abs(this._velocity) > MIN_VELOCITY) {
      this._scrollY += this._velocity;
      this._velocity *= FRICTION;
    } else {
      this._velocity = 0;
    }
    // 边界弹性
    if (this._scrollY < 0) {
      this._scrollY += (0 - this._scrollY) * BOUNCE_STIFFNESS;
      this._velocity *= 0.5;
    } else if (this._scrollY > this._maxScrollY) {
      this._scrollY += (this._maxScrollY - this._scrollY) * BOUNCE_STIFFNESS;
      this._velocity *= 0.5;
    }
  }
};

// ============================================================
// 当前章节索引
// ============================================================
LevelSelectEngine.prototype._getCurrentChapterIdx = function () {
  var chapters = databus.chapters;
  if (!chapters || chapters.length === 0) return 0;
  var li = parseInt(wx.getStorageSync('lastLevelIndex'), 10) || 0;
  for (var i = 0; i < chapters.length; i++) {
    if (li <= chapters[i].endIndex) return i;
  }
  return chapters.length - 1;
};

// ============================================================
// 事件处理
// ============================================================
LevelSelectEngine.prototype._handleEvent = function (e) {
  // 商城面板打开时，所有触控事件由面板处理
  if (ShopPanel.isOpen()) {
    var t0 = e.touches && e.touches[0];
    ShopPanel.handleEvent({ type: e.type, x: t0 ? t0.x : 0, y: t0 ? t0.y : 0 });
    return;
  }

  if (e.type === 'touchstart') {
    var t = e.touches && e.touches[0];
    if (!t) return;
    this._isDragging = true;
    this._touchStartY = t.y;
    this._scrollStartY = this._scrollY;
    this._lastTouchY = t.y;
    this._lastTouchTime = Date.now();
    this._velocity = 0;
  }

  if (e.type === 'touchmove' && this._isDragging) {
    var tm = e.touches && e.touches[0];
    if (!tm) return;
    var now = Date.now();
    var dy = tm.y - this._lastTouchY;
    var dt = now - this._lastTouchTime;
    this._scrollY -= dy;
    this._lastTouchY = tm.y;
    this._lastTouchTime = now;
    if (dt > 0) this._velocity = -dy / dt * 16;
  }

  if (e.type === 'touchend' && this._isDragging) {
    this._isDragging = false;
    var te = e.changedTouches && e.changedTouches[0];
    if (!te) return;

    // 判断是否为点击（移动距离小）
    var dist = Math.abs(te.y - this._touchStartY);
    if (dist < 8 && this._scrollY > -10 && this._scrollY < this._maxScrollY + 10) {
      // 点击事件：路由到章节按钮
      this._routeClick(te.x, te.y);
    }
  }
};

/** 路由点击到关卡按钮或顶部按钮 */
LevelSelectEngine.prototype._routeClick = function (px, py) {
  // 固顶层：返回按钮（屏幕坐标，不转换）
  if (px >= BACK_LEFT && px <= BACK_LEFT + BACK_IMG_W &&
      py >= BACK_TOP && py <= BACK_TOP + BACK_IMG_H) {
    audio.play('button_click');
    databus.gameState = 'menu';
    return;
  }

  // 章节卡片内的关卡按钮（转滚动坐标）
  var sy = py + this._scrollY;
  for (var i = 0; i < this._sections.length; i++) {
    if (this._sections[i].handleTouch(px, sy)) {
      return;
    }
  }
};

/** 关卡按钮点击 */
LevelSelectEngine.prototype._onLevelTap = function (levelId) {
  audio.play('button_click');
  var lv = this.projectLevels[levelId];
  databus.currentLevel = { name: lv.name, data: null };
  databus.currentLevelIndex = levelId;
  databus.returnState = 'levelSelect';
  databus.gameState = 'playing';
};

/** "去装扮" 按钮 */
LevelSelectEngine.prototype._onDressUp = function () {
  audio.play('button_click');
  ShopPanel.open();
};

// ============================================================
// 渲染
// ============================================================
LevelSelectEngine.prototype.render = function () {
  this._updateScroll();

  ctx.save();

  // ===== 全局背景 =====
  var bgImg = AssetPreloader.get('chapter_bg');
  if (bgImg && AssetPreloader.isReady('chapter_bg')) {
    ctx.drawImage(bgImg, 0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);
  }

  // ===== 滚动区域 =====
  ctx.save();
  ctx.translate(0, -this._scrollY);

  for (var i = 0; i < this._sections.length; i++) {
    this._sections[i].render(ctx);
  }

  ctx.restore();

  // ===== 固顶层 =====
  // 返回按钮
  var backImg = AssetPreloader.get('chapter_back');
  if (backImg && AssetPreloader.isReady('chapter_back')) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.25)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
    ctx.drawImage(backImg, BACK_LEFT, BACK_TOP, BACK_IMG_W, BACK_IMG_H);
    ctx.restore();
  }

  // 标题 "关卡"
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '24px ' + Theme.font.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 1;
  ctx.strokeText('关卡', SCREEN_WIDTH / 2, TITLE_Y);
  ctx.fillText('关卡', SCREEN_WIDTH / 2, TITLE_Y);

  // ===== 商城面板（顶层）=====
  ShopPanel.render(ctx);

  ctx.restore();
};

// ============================================================
// 兼容旧 API：标记重建
// ============================================================
LevelSelectEngine.prototype.markNeedsRebuild = function () {
  this._needsRebuild = true;
};

var CARD_GAP = 40; // 章节间距常量（供外部参考）

module.exports = LevelSelectEngine;
