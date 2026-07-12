// 关卡按钮 — 三种状态：locked / unlocked / cleared
// 外框 64×37, 内衬 60×33, 统一 radius 25

var Theme = require('../../define/GameDefine.js').THEME;
var AssetPreloader = require('../AssetPreloader.js');

var OUTER_W = 64, OUTER_H = 37;
var INNER_W = 60, INNER_H = 33;
var RADIUS = 25;

function LevelButton(opts) {
  this.x = opts.x || 0;
  this.y = opts.y || 0;
  this.levelId = opts.levelId || 0;
  this.label = opts.label || '';
  this.state = opts.state || 'locked';     // 'locked' | 'unlocked' | 'cleared'
  this.onClick = opts.onClick || null;
}

// 碰撞检测
LevelButton.prototype.hitTest = function (px, py) {
  return px >= this.x && px <= this.x + OUTER_W &&
         py >= this.y && py <= this.y + OUTER_H;
};

LevelButton.prototype.render = function (ctx) {
  var x = this.x, y = this.y;
  var ox = x + (OUTER_W - INNER_W) / 2;  // 内衬左偏移
  var oy = y + (OUTER_H - INNER_H) / 2;  // 内衬上偏移

  // 1. 外框白底
  ctx.fillStyle = '#FFFFFF';
  _roundRect(ctx, x, y, OUTER_W, OUTER_H, RADIUS);
  ctx.fill();

  // 外框底部阴影
  ctx.save();
  _roundRect(ctx, x, y, OUTER_W, OUTER_H, RADIUS);
  ctx.clip();
  var botGrad = ctx.createLinearGradient(0, y + OUTER_H - 2, 0, y + OUTER_H);
  botGrad.addColorStop(0, 'rgba(169, 193, 193, 0)');
  botGrad.addColorStop(1, 'rgba(169, 193, 193, 1)');
  ctx.fillStyle = botGrad;
  ctx.fillRect(x, y + OUTER_H - 2, OUTER_W, 2);
  ctx.restore();

  // 2. 内衬
  var innerColor, topShadow, botShadow;
  if (this.state === 'cleared') {
    innerColor = '#FF8989';
    topShadow = 'rgba(255, 255, 255, 0.3)';
    botShadow = 'rgba(162, 22, 22, 0.3)';
  } else {
    innerColor = '#AFC1CF';
    topShadow = 'rgba(156, 169, 179, 0.3)';
    botShadow = 'rgba(134, 156, 179, 1)';
  }

  ctx.fillStyle = innerColor;
  _roundRect(ctx, ox, oy, INNER_W, INNER_H, RADIUS);
  ctx.fill();

  // 内衬上下内阴影
  ctx.save();
  _roundRect(ctx, ox, oy, INNER_W, INNER_H, RADIUS);
  ctx.clip();
  // 上阴影
  var tg = ctx.createLinearGradient(0, oy, 0, oy + 3);
  tg.addColorStop(0, topShadow);
  tg.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = tg;
  ctx.fillRect(ox, oy, INNER_W, 3);
  // 下阴影
  var bg = ctx.createLinearGradient(0, oy + INNER_H - 3, 0, oy + INNER_H);
  bg.addColorStop(0, 'rgba(0,0,0,0)');
  bg.addColorStop(1, botShadow);
  ctx.fillStyle = bg;
  ctx.fillRect(ox, oy + INNER_H - 3, INNER_W, 3);
  ctx.restore();

  // 3. 关卡编号（已通关 #733C29，未通关 #7E8B97）
  ctx.fillStyle = this.state === 'cleared' ? '#733C29' : '#7E8B97';
  ctx.font = '20px ' + Theme.font.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (this.state === 'locked') {
    ctx.globalAlpha = 0.4;
  }
  ctx.fillText(this.label, x + OUTER_W / 2, y + OUTER_H / 2);
  ctx.globalAlpha = 1;
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

module.exports = LevelButton;
