// 停车位实体

const { getColorHex } = require('../utils/colors.js');

class PickupSlot {
  constructor(config) {
    this.id = config.id;
    this.color = config.color;
    this.maxWait = config.maxWait || 2;
    this.currentWait = this.maxWait; // 当前等待乘客数
    this.occupied = false;
    this.carRef = null; // 停在此车位的汽车

    // 像素坐标（由 PickupZoneUI 设置）
    this.x = config.x || 0;
    this.y = config.y || 0;
    this.width = config.width || 70;
    this.height = config.height || 40;
  }

  /** 汽车停入（预约） */
  occupy(car) {
    this.occupied = true;
    this.carRef = car;
    // 不设置 car.status，由路径系统管理状态
  }

  /** 汽车驶离 */
  release() {
    this.occupied = false;
    this.carRef = null;
  }

  /** 乘客上车 */
  boardPassenger() {
    if (this.currentWait > 0) {
      this.currentWait--;
      if (this.carRef) {
        this.carRef.passengers++;
      }
      return true;
    }
    return false;
  }

  /** 是否可用 */
  isAvailable() {
    return !this.occupied;
  }

  /** 渲染（只画停车位本身，乘客由 Passenger 实体负责渲染） */
  render(ctx) {
    const hex = getColorHex(this.color);

    // 停车位背景
    ctx.fillStyle = this.occupied
      ? 'rgba(0,0,0,0.1)'
      : hex + '30';
    ctx.beginPath();
    ctx.roundRect(this.x, this.y, this.width, this.height, [6]);
    ctx.fill();

    // 边框
    ctx.strokeStyle = hex;
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.roundRect(this.x, this.y, this.width, this.height, [6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // 已停车：显示占位色块
    if (this.occupied && this.carRef) {
      ctx.fillStyle = hex;
      const cw = this.width - 12;
      const ch = this.height - 8;
      ctx.fillRect(this.x + 6, this.y + 4, cw, ch);

      // 乘客数
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(
        `${this.carRef.passengers}/${this.carRef.seats}`,
        this.x + this.width / 2,
        this.y + this.height / 2
      );
    }
  }
}

module.exports = PickupSlot;
