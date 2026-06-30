// 关卡选择 — 章节标题行组件

var Theme = require('../Theme.js');

var COLORS = {
  primary: '#EC4899',
  textMuted: '#94A3B8',
};

function ChapterHeader(opts) {
  this._x = 0;
  this._y = 0;
  this._w = 0; // SCREEN_WIDTH
  this._icon = '';
  this._name = '';
  this._themeColor = COLORS.primary;
  this._cleared = 0;
  this._total = 0;
}

/** 同步数据 */
ChapterHeader.prototype.setData = function (data) {
  this._x = data.x || 0;
  this._y = data.y || 0;
  this._w = data.w || 0;
  this._icon = data.icon || '';
  this._name = data.name || '';
  this._themeColor = data.themeColor || COLORS.primary;
  this._cleared = data.cleared;
  this._total = data.total;
};

/** 渲染 */
ChapterHeader.prototype.render = function (ctx) {
  var iconCY = this._y;

  // 图标 emoji
  ctx.font = '16px ' + Theme.font.family + '';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = Theme.colors.dark;
  ctx.fillText(this._icon, this._x, iconCY);

  // 章节名（主题色）
  var nameX = this._x + 26;
  ctx.fillStyle = this._themeColor;
  ctx.font = 'bold 14px ' + Theme.font.family + '';
  ctx.fillText(this._name, nameX, iconCY);

  // 进度文字（右侧）
  ctx.fillStyle = COLORS.textMuted;
  ctx.font = '12px ' + Theme.font.family + '';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  ctx.fillText(this._cleared + '/' + this._total, this._w, iconCY);
};

module.exports = ChapterHeader;
