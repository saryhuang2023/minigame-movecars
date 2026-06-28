// 底部栏 — 提示按钮 + 条件移除按钮
// PlayingEngine 专用
// v124: 提示按钮改用背景图 hint.png + ad_icon.png，删除手绘按钮

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../Theme.js');
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');

// 不跟随场景变化
var HINT_BG = 'assets/sceen/0/hint.png';
var HINT_ERASE_BG = 'assets/sceen/0/hint_erase.png';
var AD_ICON = 'assets/sceen/0/ad_icon.png';

// 提示按钮尺寸（由背景图决定）
var HINT_W = 151;
var HINT_H = 69;
var AD_ICON_W = 35;
var AD_ICON_H = 22;

/**
 * @param {Object} opts
 * @param {number} opts.cardW - 卡片宽度（对齐用）
 * @param {Object} opts.buttonPress - ButtonPress 实例
 * @param {Function} opts.onHintClick - 提示按钮回调
 * @param {Function} opts.onRemoveClick - 移除按钮回调
 */
function BottomBar(opts) {
  UIComponent.call(this, {
    x: 0,
    y: SCREEN_HEIGHT - Theme.layout.bottomBarH,
    w: SCREEN_WIDTH,
    h: Theme.layout.bottomBarH,
    zIndex: opts.zIndex || 2,
  });

  this._cardW = opts.cardW;
  this._buttonPress = opts.buttonPress;
  this._hintActive = false;

  // 回调
  this.onHintClick = opts.onHintClick || function () {};
  this.onRemoveClick = opts.onRemoveClick || function () {};

  // 按钮点击区域（供外部 hitTest 查询）
  this.hintBtnRect = null;
  this.removeBtnRect = null;

  var self = this;

  // 提示按钮背景图
  this._hintBgImg = wx.createImage();
  this._hintBgLoaded = false;
  this._hintBgImg.onload = function () { self._hintBgLoaded = true; };
  this._hintBgImg.src = HINT_BG;

  // 移除按钮背景图
  this._hintEraseBgImg = wx.createImage();
  this._hintEraseBgLoaded = false;
  this._hintEraseBgImg.onload = function () { self._hintEraseBgLoaded = true; };
  this._hintEraseBgImg.src = HINT_ERASE_BG;

  // 广告图标
  this._adIconImg = wx.createImage();
  this._adIconLoaded = false;
  this._adIconImg.onload = function () { self._adIconLoaded = true; };
  this._adIconImg.src = AD_ICON;
}

BottomBar.prototype = Object.create(UIComponent.prototype);
BottomBar.prototype.constructor = BottomBar;

BottomBar.prototype.setHintActive = function (active) {
  this._hintActive = !!active;
};

/**
 * 覆盖 hitTest，精确检测两个按钮
 */
BottomBar.prototype.hitTest = function (px, py) {
  if (!this.visible) return false;

  // 提示按钮
  if (this.hintBtnRect) {
    var h = this.hintBtnRect;
    if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) {
      return true;
    }
  }

  // 移除按钮（仅提示激活时存在）
  if (this._hintActive && this.removeBtnRect) {
    var r = this.removeBtnRect;
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
      return true;
    }
  }

  return false;
};

/**
 * 判断具体点中了哪个按钮
 */
BottomBar.prototype.getHitType = function (px, py) {
  if (this.hintBtnRect) {
    var h = this.hintBtnRect;
    if (px >= h.x && px <= h.x + h.w && py >= h.y && py <= h.y + h.h) {
      return 'hint';
    }
  }
  if (this._hintActive && this.removeBtnRect) {
    var r = this.removeBtnRect;
    if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) {
      return 'remove';
    }
  }
  return null;
};

BottomBar.prototype.render = function (ctx) {
  // ===== 提示/移除按钮（同位置互斥）=====
  var hintX = SCREEN_WIDTH - 20 - HINT_W;
  var hintY = SCREEN_HEIGHT - 30 - HINT_H;

  var witchBtn = this._hintActive?'erase':'hint';
  var btnScale = this._buttonPress ? this._buttonPress.getScale(witchBtn) : 1;
  this.hintBtnRect = this.removeBtnRect = { x: hintX, y: hintY, w: HINT_W, h: HINT_H };

  ctx.save();
  ctx.fillStyle = Theme.colors.white;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.font = '24px ' + Theme.font.family;

  // 缩放动画（以按钮中心为锚点）
  if (btnScale !== 1) {
    var hintCX = hintX + HINT_W / 2, hintCY = hintY + HINT_H / 2;
    ctx.translate(hintCX, hintCY);
    ctx.scale(btnScale, btnScale);
    ctx.translate(-hintCX, -hintCY);
  }

  // 移除按钮
  if (this._hintActive) {
    this.hintBtnRect = null;
    if (this._hintEraseBgLoaded) ctx.drawImage(this._hintEraseBgImg, hintX, hintY, HINT_W, HINT_H);
    if (this._adIconLoaded) ctx.drawImage(this._adIconImg, hintX + 22, hintY + 20, AD_ICON_W, AD_ICON_H);
    ctx.fillText('\u79FB\u9664', hintX + 66, hintY + 15.5);
    ctx.restore();
  }else{ // 提示按钮
    this.removeBtnRect = null;
    if (this._hintBgLoaded) ctx.drawImage(this._hintBgImg, hintX, hintY, HINT_W, HINT_H);
    if (this._adIconLoaded) ctx.drawImage(this._adIconImg, hintX + 22, hintY + 20, AD_ICON_W, AD_ICON_H);
    ctx.fillText('\u63D0\u793A', hintX + 66, hintY + 15.5);
    ctx.restore();
  }
};

module.exports = BottomBar;
