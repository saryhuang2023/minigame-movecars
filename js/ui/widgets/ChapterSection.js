// 章节卡片 — 垂直滚动列表的一章
// 绘制全部使用 ctx.translate 后相对卡片外框 (0,0) 的坐标

var Theme = require('../../define/GameDefine.js').THEME;
var CommonButton = require('./CommonButton.js');
var LevelButton = require('./LevelButton.js');
var databus = require('../../databus.js');
var cloud = require('../../cloud.js');
var AssetPreloader = require('../AssetPreloader.js');

var CARD_W = 353;
var CARD_H = 599;        // 固定高度
var CARD_GAP = 40;
var BORDER_W = 12;
var CORNER_R = 30;

// 内部元素 — 全部相对卡片外框 (0,0)
var HEADER_H = 190;
var ROW_H = 67;
var COLS = 4;
var BTN_W = 64;
var BTN_Y_OFFSET = 76;
var BTN_X_OFFSET = 43;
var BTN_AREA_W = 306;

var BADGE_X = 20, BADGE_Y = -12;  // 徽章叠在边框上
var BADGE_W = 135, BADGE_H = 30;
var BADGE_BORDER = 6;
var NAME_X = 20, NAME_Y = 33;

// 内衬区域
var INNER_X = BORDER_W, INNER_Y = BORDER_W;
var INNER_W = CARD_W - BORDER_W * 2;
var INNER_H = CARD_H - BORDER_W * 2;

var NUM_CN = ['零','一','二','三','四','五','六','七','八','九','十',
              '十一','十二','十三','十四','十五','十六','十七','十八','十九','二十'];

function numToCN(n) { return n <= 20 ? (NUM_CN[n] || String(n)) : String(n); }

function ChapterSection(opts) {
  this.chapter = opts.chapter || {};
  this.levels = opts.levels || [];
  this.startIndex = opts.startIndex || 0;
  this.chIdx = opts.chIdx || 0;
  this.isCurrent = !!opts.isCurrent;
  this.isFuture = !!opts.isFuture;
  this.unlocked = !!opts.unlocked;
  this.onLevelTap = opts.onLevelTap || null;
  this.onDressUp = opts.onDressUp || null;
  this.cardW = opts.cardW || 353;
  this.x = 0; this.y = 0;
  this.height = this.isFuture ? this.cardW : CARD_H;  // 后续章正方形，当前/已过章见下

  this._rowCount = Math.ceil(this.levels.length / COLS);
  // 非后续章自适应高度：按钮网格 + 底部留白
  if (!this.isFuture) {
    this.height = BTN_Y_OFFSET + this._rowCount * ROW_H + 130;
  }

  this._btns = [];
  var gridX = 23;  // 左右各留23px
  var btnAreaW = this.cardW - 46;
  var colGap = (btnAreaW - COLS * BTN_W) / (COLS - 1);
  var lastIdx = parseInt(wx.getStorageSync('lastLevelIndex'), 10) || 0;

  for (var i = 0; i < this.levels.length; i++) {
    var bx = gridX + (i % COLS) * (BTN_W + colGap);
    var by = BTN_Y_OFFSET + Math.floor(i / COLS) * ROW_H;
    var levelId = this.startIndex + i;
    var state = 'locked';
    var hasCrown = false;

    if (!this.isFuture) {
      hasCrown = !!wx.getStorageSync('crown_' + levelId);
      if (hasCrown) { state = 'cleared'; }
      else if (levelId <= lastIdx) { state = 'cleared'; }
      else if (levelId <= lastIdx + 1) { state = 'unlocked'; }
    }

    this._btns.push(new LevelButton({
      x: bx, y: by, levelId: levelId, label: String(levelId + 1),
      state: state, hasCrown: hasCrown,
    }));
  }

  this._dressBtn = new CommonButton({ w: 171, h: 61, color: 'gold', label: '去装扮' });
  this._bgImg = null; this._bgLoaded = false;
}

ChapterSection.prototype.loadBgImage = function () {
  if (this._bgLoaded || this.isFuture) return;
  this._bgLoaded = true;
  var self = this;
  cloud.downloadCloudImage('level/' + this.chIdx + '/chapter_skin.jpg').then(function (path) {
    if (!path) return;
    var img = wx.createImage();
    img.onload = function () { self._bgImg = img; };
    img.src = path;
  }).catch(function () {});
};

ChapterSection.prototype.getHeight = function () { return this.height; };

ChapterSection.prototype.hitTest = function (px, py) {
  var rx = px - this.x, ry = py - this.y;
  for (var i = 0; i < this._btns.length; i++) {
    if (this._btns[i].hitTest(rx, ry)) return this._btns[i];
  }
  return null;
};

ChapterSection.prototype.handleTouch = function (px, py) {
  var btn = this.hitTest(px, py);
  if (btn && btn.state !== 'locked') {
    if (this.onLevelTap) this.onLevelTap(btn.levelId);
    return true;
  }
  return false;
};

ChapterSection.prototype.render = function (ctx) {
  var w = this.cardW, h = this.height;

  ctx.save();
  ctx.translate(this.x, this.y);

  // ===== 1. 棕色边框（12px full fill）=====
  ctx.fillStyle = '#733C29';
  _roundRect(ctx, 0, 0, w, h, CORNER_R);
  ctx.fill();

  // ===== 2. 黄色内衬（内缩6px，棕色露一条细边）=====
  ctx.fillStyle = '#FFF3CA';
  _roundRect(ctx, 6, 6, w - 12, h - 12, CORNER_R - 6);
  ctx.fill();

  // 双面内阴影
  ctx.save();
  _roundRect(ctx, 6, 6, w - 12, h - 12, CORNER_R - 6);
  ctx.clip();
  var tg = ctx.createLinearGradient(0, 6, 0, 10);
  tg.addColorStop(0, 'rgba(255,255,255,0.48)'); tg.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = tg; ctx.fillRect(6, 6, w - 12, 4);
  var bg = ctx.createLinearGradient(0, h - 10, 0, h - 6);
  bg.addColorStop(0, 'rgba(255,111,111,0)'); bg.addColorStop(1, 'rgba(255,111,111,0.42)');
  ctx.fillStyle = bg; ctx.fillRect(6, h - 10, w - 12, 4);
  ctx.restore();

  // ===== 3. 云端背景图 =====
  var bgX = 10, bgY = 10, bgW = w - 20, bgH = h - 20;
  ctx.save();
  _roundRect(ctx, bgX, bgY, bgW, bgH, 24);
  ctx.clip();
  if (this._bgImg) ctx.drawImage(this._bgImg, bgX, bgY, bgW, bgH);

  if (this.isFuture) {
    ctx.fillStyle = 'rgba(124,124,124,0.5)'; ctx.fillRect(bgX, bgY, bgW, bgH);
  } else if (this.isCurrent && !this.unlocked) {
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(bgX, bgY, bgW, bgH);
  }
  ctx.restore();

  // ===== 4. 后续章锁图标 =====
  if (this.isFuture) {
    var li = AssetPreloader.get('chapter_lock');
    if (li && AssetPreloader.isReady('chapter_lock')) {
      ctx.drawImage(li, (w - 107) / 2, (h - 106) / 2 - 30, 107, 106);
    }
  }

  // ===== 5. 徽章 "第X章"（相对卡片左上角叠在边框上）=====
  var bdx = 0, bdy = -12;  // 对齐卡片左边缘，上叠12px
  var bdw = 135, bdh = 30;

  // 棕色外框
  ctx.fillStyle = '#733C29';
  _roundRect(ctx, bdx, bdy, bdw, bdh, CORNER_R);
  ctx.fill();

  // 黄色内衬（内缩3px）
  var bix = bdx + 3, biy = bdy + 3, biw = bdw - 6, bih = bdh - 6;
  ctx.fillStyle = '#FFF3CA';
  _roundRect(ctx, bix, biy, biw, bih, CORNER_R - 6);
  ctx.fill();

  // 内阴影
  ctx.save();
  _roundRect(ctx, bix, biy, biw, bih, CORNER_R - 6);
  ctx.clip();
  var bt = ctx.createLinearGradient(0, biy, 0, biy + 4);
  bt.addColorStop(0, 'rgba(255,255,255,0.48)'); bt.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = bt; ctx.fillRect(bix, biy, biw, 4);
  var bb = ctx.createLinearGradient(0, biy + bih - 4, 0, biy + bih);
  bb.addColorStop(0, 'rgba(255,111,111,0)'); bb.addColorStop(1, 'rgba(255,111,111,0.42)');
  ctx.fillStyle = bb; ctx.fillRect(bix, biy + bih - 4, biw, 4);
  ctx.restore();

  // 文字（白字 + 棕描边）
  ctx.font = '20px ' + Theme.font.family;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.strokeStyle = '#733C29';
  ctx.lineWidth = 1;
  ctx.strokeText('第' + numToCN(this.chIdx + 1) + '章', bdx + bdw / 2, bdy + bdh / 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fillText('第' + numToCN(this.chIdx + 1) + '章', bdx + bdw / 2, bdy + bdh / 2);

  // ===== 6. 章节名（letter-spacing 1px）=====
  ctx.font = '20px ' + Theme.font.family;
  ctx.fillStyle = '#FFFFFF';
  ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  var name = this.chapter.name || '';
  var charX = NAME_X;
  for (var ci = 0; ci < name.length; ci++) {
    ctx.fillText(name[ci], charX, NAME_Y);
    charX += ctx.measureText(name[ci]).width + 1;
  }

  // ===== 7. 关卡按钮（后续章不画）=====
  if (!this.isFuture) {
    for (var bi = 0; bi < this._btns.length; bi++) this._btns[bi].render(ctx);

  // ===== 8. 底部（非后续章节）=====
    var gridBottom = BTN_Y_OFFSET + this._rowCount * ROW_H;
    if (this.unlocked) {
      // 去装扮按钮 + 已解锁文字
      var dressBtnY = gridBottom + 15;
      this._dressBtn.x = (w - 171) / 2;
      this._dressBtn.y = dressBtnY;
      this._dressBtn.render(ctx);

      ctx.font = '14px ' + Theme.font.family;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      ctx.strokeStyle = '#733C29'; ctx.lineWidth = 1;
      ctx.shadowColor = 'rgba(0,0,0,0.25)'; ctx.shadowBlur = 4;
      ctx.strokeText('已解锁专属背景和皮肤', w / 2, dressBtnY + 61 + 10);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText('已解锁专属背景和皮肤', w / 2, dressBtnY + 61 + 10);
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = '#FFFFFF';
      ctx.textAlign = 'left'; ctx.textBaseline = 'top';
      ctx.font = '20px ' + Theme.font.family;

      var prefix = '获得 ';
      var suffix = 'x' + (this.chapter.unlock_crown_num || 0) + ' 解锁专属背景和皮肤';
      var iconKey = 'leftStep';
      var iconW = 23, iconH = 21, gap = 4;

      var prefixW = ctx.measureText(prefix).width;
      var suffixW = ctx.measureText(suffix).width;
      var totalW = prefixW + iconW + gap + suffixW;
      var startX = (w - totalW) / 2;
      var textY = gridBottom + 25;

      // 画 "获得 "
      ctx.fillText(prefix, startX, textY);
      // 画奖杯图标
      if (AssetPreloader.isReady(iconKey)) {
        ctx.drawImage(AssetPreloader.get(iconKey), startX + prefixW, textY, iconW, iconH);
      }
      // 画 "x5 解锁..."
      ctx.fillText(suffix, startX + prefixW + iconW + gap, textY);
    }
  }

  ctx.restore();
};

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

module.exports = ChapterSection;
