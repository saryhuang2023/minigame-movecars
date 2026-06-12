// 顶部信息栏

const databus = require('../databus.js');
const { SCREEN_WIDTH } = require('../render.js');

const HUD = {
  render(ctx) {
    const y = 10;

    // 背景
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(0, 0, SCREEN_WIDTH, 40);

    // 底部分割线
    ctx.strokeStyle = '#E0E0E0';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, 40);
    ctx.lineTo(SCREEN_WIDTH, 40);
    ctx.stroke();

    // 关卡名
    ctx.fillStyle = '#333';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(`第${databus.currentLevel + 1}关`, 15, 20);

    // 剩余车辆数
    const idleCars = databus.cars.filter(c => c.status === 'idle').length;
    ctx.fillStyle = '#666';
    ctx.font = '13px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`🚗 剩余:${idleCars}`, SCREEN_WIDTH - 120, 20);

    // 剩余乘客数
    const waiting = databus.passengers.filter(p => !p.boarded).length;
    ctx.fillText(`👤 乘客:${waiting}`, SCREEN_WIDTH - 15, 20);
  },
};

module.exports = HUD;
