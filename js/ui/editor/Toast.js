// Toast 通知 — 临时提示，自动消失
// EditorEngine 专用

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../../define/GameDefine.js').THEME;
var { SCREEN_WIDTH } = require('../../render.js');

/**
 * @param {Object} opts
 */
function Toast(opts) {
  UIComponent.call(this, {
    x: 0, y: 0,
    w: SCREEN_WIDTH, h: 50,
    zIndex: opts.zIndex || 4,
    visible: false,
  });

  this._text = '';
  this._alpha = 0;
  this._timer = null;
  this._startTime = 0;
  this._duration = 2000;  // ms
  this._fadeDelay = 800;   // 开始淡出前停留多久 ms
  this._fadeDuration = 600; // 淡出持续多久 ms
}

Toast.prototype = Object.create(UIComponent.prototype);
Toast.prototype.constructor = Toast;

Toast.prototype.show = function (text, duration) {
  this._text = text;
  this._duration = duration || 2000;
  this._alpha = 1;
  this._startTime = Date.now();
  this.visible = true;

  if (this._timer) {
    clearTimeout(this._timer);
  }

  var self = this;
  this._timer = setTimeout(function () {
    self._startFade();
  }, Math.max(0, this._duration - this._fadeDuration));
};

Toast.prototype._startFade = function () {
  var self = this;
  this._timer = setTimeout(function () {
    self.hide();
  }, this._fadeDelay);
};

Toast.prototype.render = function (ctx) {
  if (!this.visible) return;

  var now = Date.now();
  var totalElapsed = now - this._startTime;
  var totalDuration = this._duration + this._fadeDelay + this._fadeDuration;

  // 计算透明度
  if (totalElapsed < this._duration) {
    // 停留阶段
    this._alpha = 1;
  } else if (totalElapsed < this._duration + this._fadeDelay) {
    // 淡出阶段
    var fadeT = (totalElapsed - this._duration - this._fadeDelay) / this._fadeDuration;
    this._alpha = 1 - Math.max(0, Math.min(1, fadeT));
  } else {
    this._alpha = 0;
  }

  if (this._alpha <= 0) {
    this.visible = false;
    return;
  }

  ctx.save();
  ctx.globalAlpha = this._alpha;
  ctx.font = '13px ' + Theme.font.family;
  var textW = ctx.measureText(this._text).width || 200;
  var w = Math.min(textW + 36, SCREEN_WIDTH - 20);
  var h = 36;
  var x = (SCREEN_WIDTH - w) / 2;
  var y = 44;

  ctx.fillStyle = 'rgba(0,0,0,0.8)';
  var r = 8;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x + r, y + h, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(this._text, x + w / 2, y + h / 2);
  ctx.restore();
};

module.exports = Toast;
