// 关卡选择 — 顶栏组件（返回按钮 + 标题）

var COLORS = {
  cyan: '#0EC9C5',
  cyanShadow: 'rgba(14, 201, 197, 0.3)',
  textDark: '#0F172A',
  white: '#FFFFFF',
};

function LevelSelectTopBar(opts) {
  this._safeTop = 0;
  this._topBarH = 52;
  this._title = '';
  this._pressScale = 1;
  this._screenW = 375;

  // 暴露给引擎命中的返回按钮区域
  this.backBtnRect = { x: 0, y: 0, w: 0, h: 0 };
}

/** 同步数据 */
LevelSelectTopBar.prototype.setData = function (data) {
  this._safeTop = data.safeTop || 0;
  this._topBarH = data.topBarH || 52;
  this._title = data.title || '';
  this._pressScale = data.pressScale || 1;
  this._screenW = data.screenW || 375;
};

/** 渲染 */
LevelSelectTopBar.prototype.render = function (ctx) {
  var barY = this._safeTop;
  var barCY = barY + this._topBarH / 2;
  var paddingX = 20;

  var btnSize = 48;
  var btnX = paddingX;
  var btnY = barY + (this._topBarH - btnSize) / 2;
  var btnCX = btnX + btnSize / 2;
  var btnCY_box = btnY + btnSize / 2;

  // 更新返回按钮区域（给引擎做命中）
  this.backBtnRect = { x: btnX, y: btnY, w: btnSize, h: btnSize };

  // 按压微交互缩放
  var backScale = this._pressScale;
  ctx.save();
  ctx.translate(btnCX, btnCY_box);
  ctx.scale(backScale, backScale);
  ctx.translate(-btnCX, -btnCY_box);

  // 阴影
  ctx.save();
  ctx.shadowColor = COLORS.cyanShadow;
  ctx.shadowBlur = 10;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.arc(btnCX, btnCY_box, btnSize / 2, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.cyan;
  ctx.fill();
  ctx.restore();

  // 主体
  ctx.beginPath();
  ctx.arc(btnCX, btnCY_box, btnSize / 2, 0, Math.PI * 2);
  ctx.fillStyle = COLORS.cyan;
  ctx.fill();

  // 白色箭头 <
  ctx.strokeStyle = COLORS.white;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(btnCX + 5, btnCY_box - 7);
  ctx.lineTo(btnCX - 4, btnCY_box);
  ctx.lineTo(btnCX + 5, btnCY_box + 7);
  ctx.stroke();
  ctx.restore(); // 按压缩放

  // 居中标题
  ctx.fillStyle = COLORS.textDark;
  ctx.font = 'bold 24px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(this._title, this._screenW / 2, barCY);
};

module.exports = LevelSelectTopBar;
