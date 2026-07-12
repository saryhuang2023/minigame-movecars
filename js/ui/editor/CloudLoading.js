// 云同步加载遮罩 — EditorEngine 同步时显示

var UIComponent = require('../base/UIComponent.js');
var Theme = require('../../define/GameDefine.js').THEME;
var { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../../render.js');

/**
 * @param {Object} opts
 */
class CloudLoading extends UIComponent {
  constructor(opts) {
  super({
    x: 0, y: 0,
    w: SCREEN_WIDTH, h: SCREEN_HEIGHT,
    zIndex: opts.zIndex || 4,
    visible: false,
  });

}
}


CloudLoading.prototype.render = function (ctx) {
  if (!this.visible) return;

  // 半透明白色遮罩
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

  // 白色卡片
  var cw = 220, ch = 120;
  var cx = (SCREEN_WIDTH - cw) / 2;
  var cy = (SCREEN_HEIGHT - ch) / 2;
  var r = 12;

  ctx.fillStyle = Theme.colors.white;
  ctx.beginPath();
  ctx.moveTo(cx + r, cy);
  ctx.lineTo(cx + cw - r, cy);
  ctx.arcTo(cx + cw, cy, cx + cw, cy + r, r);
  ctx.lineTo(cx + cw, cy + ch - r);
  ctx.arcTo(cx + cw, cy + ch, cx + cw - r, cy + ch, r);
  ctx.lineTo(cx + r, cy + ch);
  ctx.arcTo(cx, cy + ch, cx, cy + ch - r, r);
  ctx.lineTo(cx, cy + r);
  ctx.arcTo(cx, cy, cx + r, cy, r);
  ctx.closePath();
  ctx.fill();

  // 阴影
  ctx.shadowColor = 'rgba(0,0,0,0.1)';
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.fill();
  ctx.shadowColor = 'transparent';

  // 标题
  ctx.fillStyle = Theme.colors.dark;
  ctx.font = 'bold 16px ' + Theme.font.family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('同步云端关卡中...', cx + cw / 2, cy + 40);

  // 副标题
  ctx.fillStyle = Theme.colors.muted;
  ctx.font = '13px ' + Theme.font.family;
  ctx.fillText('请稍后', cx + cw / 2, cy + 72);
};

module.exports = CloudLoading;
