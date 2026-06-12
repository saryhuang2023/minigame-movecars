// 乘客实体

const { getColorHex } = require('../utils/colors.js');

class Passenger {
  constructor(color, slotRef) {
    this.color = color;
    this.slotRef = slotRef;
    this.boarded = false;

    // 上车动画
    this.animProgress = 0;
    this.animDuration = 0.3;
    this.animating = false;
  }

  /** 开始上车动画 */
  startBoardAnim() {
    this.animating = true;
    this.animProgress = 0;
  }

  /** 更新动画 */
  update(dt) {
    if (this.animating) {
      this.animProgress += dt / this.animDuration;
      if (this.animProgress >= 1) {
        this.animProgress = 1;
        this.animating = false;
        this.boarded = true;
      }
    }
  }

  /** 渲染 */
  render(ctx, index) {
    if (this.boarded) return;

    const slot = this.slotRef;
    const pw = 16;
    // 使用当前等待人数来布局（取 maxWait 作为槽位总数）
    const totalWait = slot.maxWait;
    const totalW = totalWait * pw + (totalWait - 1) * 4;
    const startX = slot.x + (slot.width - totalW) / 2;
    const py = slot.y - pw - 4;

    // index 从 0 开始，按 slot 内乘客的排列顺序
    let x = startX + (index || 0) * (pw + 4) + pw / 2;
    let y = py + pw / 2;
    let alpha = 1;

    // 上车动画
    if (this.animating) {
      const t = this.easeInBack(this.animProgress);
      x = x + (slot.x + slot.width / 2 - x) * t;
      y = y + (slot.y + slot.height / 2 - y) * t;
      alpha = 1 - this.animProgress;
    }

    ctx.save();
    ctx.globalAlpha = alpha;
    const hex = getColorHex(this.color);

    // 身体
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.arc(x, y, pw / 2, 0, Math.PI * 2);
    ctx.fill();

    // 眼睛
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(x - 3, y - 2, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 3, y - 2, 2.5, 0, Math.PI * 2);
    ctx.fill();

    // 微笑
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y + 2, 3, 0, Math.PI);
    ctx.stroke();

    ctx.restore();
  }

  easeInBack(t) {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return c3 * t * t * t - c1 * t * t;
  }
}

module.exports = Passenger;
