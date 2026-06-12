// 弹窗组件（胜利/失败）

const databus = require('../databus.js');
const { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');

const Popup = {
  render(ctx) {
    const state = databus.gameState;
    if (state !== 'victory' && state !== 'defeat') return;

    // 半透明遮罩
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    // 弹窗
    const popW = 280;
    const popH = 200;
    const popX = (SCREEN_WIDTH - popW) / 2;
    const popY = (SCREEN_HEIGHT - popH) / 2;

    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect(popX, popY, popW, popH, 12);
    ctx.fill();

    // 阴影
    ctx.shadowColor = 'rgba(0,0,0,0.2)';
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.roundRect(popX, popY, popW, popH, 12);
    ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.shadowBlur = 0;

    // 标题
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';

    if (state === 'victory') {
      ctx.fillStyle = '#4CAF50';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText('🎉 恭喜过关！', SCREEN_WIDTH / 2, popY + 30);

      ctx.fillStyle = '#666';
      ctx.font = '14px sans-serif';
      ctx.fillText(`第${databus.currentLevel + 1}关 完成`, SCREEN_WIDTH / 2, popY + 70);
    } else {
      ctx.fillStyle = '#F44336';
      ctx.font = 'bold 26px sans-serif';
      ctx.fillText('😞 卡住了', SCREEN_WIDTH / 2, popY + 30);

      ctx.fillStyle = '#666';
      ctx.font = '14px sans-serif';
      ctx.fillText('当前局面已无解，重新挑战吧', SCREEN_WIDTH / 2, popY + 70);
    }

    // 按钮提示
    ctx.fillStyle = '#999';
    ctx.font = '12px sans-serif';
    ctx.fillText('点击下方按钮继续', SCREEN_WIDTH / 2, popY + 105);

    // 布置按钮位置（覆盖 Button 管理器中的按钮坐标）
    const Button = require('./Button.js');
    const buttons = Button.getAll();
    if (buttons.length > 0) {
      buttons[0].x = popX + 40;
      buttons[0].y = popY + 130;
      buttons[0].w = popW - 80;
      buttons[0].h = 44;
    }
  },
};

module.exports = Popup;
