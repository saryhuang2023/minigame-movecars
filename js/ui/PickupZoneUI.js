// 接待区渲染

const databus = require('../databus.js');
const { SCREEN_WIDTH } = require('../render.js');

const PickupZoneUI = {
  render(ctx) {
    const slots = databus.slots;
    if (!slots || slots.length === 0) return;

    const zoneY = 50;
    const zoneH = 90;

    // 接待区背景
    ctx.fillStyle = '#E8F5E9';
    ctx.fillRect(0, zoneY, SCREEN_WIDTH, zoneH);

    // 标题
    ctx.fillStyle = '#666';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillText('乘客接待区', SCREEN_WIDTH / 2, zoneY + 4);

    // 布局停车位
    const totalSlots = slots.length;
    const slotW = 70;
    const slotH = 36;
    const gap = 12;
    const totalW = totalSlots * slotW + (totalSlots - 1) * gap;
    const startX = (SCREEN_WIDTH - totalW) / 2;

    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      slot.x = startX + i * (slotW + gap);
      slot.y = zoneY + 24;
      slot.width = slotW;
      slot.height = slotH;
      slot.render(ctx);
    }

    // 底部分割线
    ctx.strokeStyle = '#C8E6C9';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, zoneY + zoneH);
    ctx.lineTo(SCREEN_WIDTH, zoneY + zoneH);
    ctx.stroke();
  },
};

module.exports = PickupZoneUI;
