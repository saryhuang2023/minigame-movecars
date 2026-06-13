// 汽车实体：位置、颜色、方向、移动状态机

const { getColorHex } = require('../utils/colors.js');
const { GRID_CELL_SIZE } = require('./Grid.js');

const DIRECTIONS = [
  { angle: 0,   name: '上' },
  { angle: 22.5, name: '上偏右' },
  { angle: 45,  name: '右上' },
  { angle: 67.5, name: '右偏上' },
  { angle: 90,  name: '右' },
  { angle: 112.5, name: '右偏下' },
  { angle: 135, name: '右下' },
  { angle: 157.5, name: '下偏右' },
  { angle: 180, name: '下' },
  { angle: 202.5, name: '下偏左' },
  { angle: 225, name: '左下' },
  { angle: 247.5, name: '左偏下' },
  { angle: 270, name: '左' },
  { angle: 292.5, name: '左偏上' },
  { angle: 315, name: '左上' },
  { angle: 337.5, name: '上偏左' },
];

const MOVE_SPEED = 250; // 像素/秒
const BOUNCE_DURATION = 0.3; // 弹回动画时长（秒）

class Car {
  constructor(config) {
    this.id = config.id;
    this.color = config.color;

    // 像素坐标
    this.x = config.x || 0;
    this.y = config.y || 0;

    // 尺寸（像素）
    this.width = config.width || GRID_CELL_SIZE;
    this.height = config.height || GRID_CELL_SIZE;

    // 方向角度（0-360，步长 22.5°）
    this.direction = config.direction || 0;

    // 座位
    this.seats = config.seats || 2;
    this.passengers = 0;

    // 移动状态机: idle / moving_forward / bouncing_back / path_moving / arrived / departed
    this.status = 'idle';

    // 移动相关
    this.moveSpeed = MOVE_SPEED;
    this.targetX = this.x;
    this.targetY = this.y;

    // 路径点系统（多段路径）
    this.waypoints = [];         // [{x, y}, ...] 路径点队列
    this.waypointIndex = 0;     // 当前路径点索引
    this.waypointTarget = null; // 路径完成后的目标类型: 'slot' | 'depart'

    // 弹回相关
    this.originX = this.x;
    this.originY = this.y;
    this.bounceStartX = this.x;
    this.bounceStartY = this.y;
    this.bounceProgress = 0;
    this.bounceDuration = BOUNCE_DURATION;

    // 提示高亮
    this.highlighted = false;
    this.highlightTimer = 0;
  }

  /** 获取方向单位向量 */
  getDirectionVector() {
    const rad = this.direction * Math.PI / 180;
    return { dx: Math.sin(rad), dy: -Math.cos(rad) };
  }

  /** 判断点是否在车内 */
  containsPoint(px, py) {
    return (
      px >= this.x &&
      px <= this.x + this.width &&
      py >= this.y &&
      py <= this.y + this.height
    );
  }

  /** 获取车身中心点 */
  getCenter() {
    return {
      x: this.x + this.width / 2,
      y: this.y + this.height / 2,
    };
  }

  /** 设置目标位置并开始移动 */
  startMoving(targetX, targetY) {
    this.originX = this.x;
    this.originY = this.y;
    this.targetX = targetX;
    this.targetY = targetY;
    this.status = 'moving_forward';
  }

  /** 开始弹回 */
  startBounce() {
    this.bounceStartX = this.x;
    this.bounceStartY = this.y;
    this.bounceProgress = 0;
    this.status = 'bouncing_back';
  }

  /** 设置多段路径点 */
  setWaypoints(points, target) {
    this.waypoints = points;
    this.waypointIndex = 0;
    this.waypointTarget = target;
    this.status = 'path_moving';
  }

  /** 更新移动状态 */
  update(dt, grid) {
    if (this.status === 'moving_forward') {
      this.updateMoving(dt, grid);
    } else if (this.status === 'bouncing_back') {
      this.updateBounce(dt);
    } else if (this.status === 'path_moving') {
      this.updatePathMoving(dt);
    }
  }

  /** 前进移动 */
  updateMoving(dt, grid) {
    const { dx, dy } = this.getDirectionVector();
    const stepX = dx * this.moveSpeed * dt;
    const stepY = dy * this.moveSpeed * dt;

    const nextX = this.x + stepX;
    const nextY = this.y + stepY;

    // 检查是否到达或超过目标
    const distToTarget = Math.hypot(this.targetX - this.x, this.targetY - this.y);
    const stepDist = Math.hypot(stepX, stepY);

    if (stepDist >= distToTarget) {
      // 到达目标位置
      this.x = this.targetX;
      this.y = this.targetY;

      // 检查是否已开出停车区域 → 触发进入接待区
      if (!grid.isInsideParkingArea(this.x, this.y, this.width, this.height)) {
        const PickupSystem = require('../systems/PickupSystem.js');
        PickupSystem.onCarExitGrid(this);
        return;
      }

      this.status = 'idle';
      grid.updateOccupancy(require('../databus.js').cars);
      return;
    }

    // 先清除自己的占用标记，再做碰撞检测
    grid.unmarkCar(this);

    // 实时碰撞检测
    if (grid.isRectOccupied(nextX, nextY, this.width, this.height, this)) {
      // 恢复自己的标记
      grid.markCar(this);
      this.startBounce();
      return;
    }

    // 检查是否开出网格区域（进入接待区）
    if (!grid.isInsideParkingArea(nextX, nextY, this.width, this.height) &&
        grid.isInsideScreen(nextX, nextY, this.width, this.height)) {
      // 可能进入接待区，继续移动（不标记网格，已出区域）
      this.x = nextX;
      this.y = nextY;
      return;
    }

    // 检查是否完全离开屏幕
    if (!grid.isInsideScreen(nextX, nextY, this.width, this.height)) {
      this.x = nextX;
      this.y = nextY;
      this.status = 'idle';
      // 触发接待区检测
      const PickupSystem = require('../systems/PickupSystem.js');
      PickupSystem.onCarExitGrid(this);
      return;
    }

    // 正常移动
    this.x = nextX;
    this.y = nextY;
    grid.markCar(this);
  }

  /** 弹回动画 */
  updateBounce(dt) {
    this.bounceProgress += dt / this.bounceDuration;
    if (this.bounceProgress >= 1) {
      this.bounceProgress = 1;
      this.x = this.originX;
      this.y = this.originY;
      this.status = 'idle';
      require('../databus.js').grid.updateOccupancy(require('../databus.js').cars);
      return;
    }
    // easeInOut 缓动
    const t = this.easeInOutQuad(this.bounceProgress);
    this.x = this.bounceStartX + (this.originX - this.bounceStartX) * t;
    this.y = this.bounceStartY + (this.originY - this.bounceStartY) * t;
  }

  /** 路径点移动 - 依次跟随多段路径 */
  updatePathMoving(dt) {
    if (this.waypoints.length === 0 || this.waypointIndex >= this.waypoints.length) {
      this.handleWaypointComplete();
      return;
    }

    const wp = this.waypoints[this.waypointIndex];
    const dx = wp.x - this.x;
    const dy = wp.y - this.y;
    const dist = Math.hypot(dx, dy);

    if (dist < 0.5) {
      // 到达当前路径点
      this.x = wp.x;
      this.y = wp.y;
      this.waypointIndex++;
      if (this.waypointIndex >= this.waypoints.length) {
        this.handleWaypointComplete();
      }
      return;
    }

    // 向路径点平滑移动
    const step = this.moveSpeed * dt;
    if (step >= dist) {
      this.x = wp.x;
      this.y = wp.y;
      this.waypointIndex++;
      if (this.waypointIndex >= this.waypoints.length) {
        this.handleWaypointComplete();
      }
    } else {
      this.x += (dx / dist) * step;
      this.y += (dy / dist) * step;
    }
  }

  /** 路径点全部走完后的处理 */
  handleWaypointComplete() {
    const databus = require('../databus.js');

    if (this.waypointTarget === 'slot') {
      // 到达停车位，开始接客
      this.status = 'arrived';
      const PickupSystem = require('../systems/PickupSystem.js');
      const slot = databus.getSlotByCar(this);
      if (slot) {
        PickupSystem.boardPassengers(slot);
      }
    } else if (this.waypointTarget === 'depart') {
      // 驶离屏幕
      this.status = 'departed';
      const slot = databus.getSlotByCar(this);
      if (slot) {
        slot.release();
      }
      databus.grid.updateOccupancy(databus.cars);
    }
  }

  easeInOutQuad(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
  }

  /** 渲染 */
  render(ctx) {
    ctx.save();

    const cx = this.x + this.width / 2;
    const cy = this.y + this.height / 2;

    // 提示高亮
    if (this.highlighted) {
      this.highlightTimer += 0.05;
      const alpha = 0.5 + 0.3 * Math.sin(this.highlightTimer * 3);
      ctx.shadowColor = '#FFD700';
      ctx.shadowBlur = 12 + 4 * Math.sin(this.highlightTimer * 3);
      ctx.strokeStyle = `rgba(255, 215, 0, ${alpha})`;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(this.x - 3, this.y - 3, this.width + 6, this.height + 6, [6]);
      ctx.stroke();
    }

    // 车身
    const hex = getColorHex(this.color);
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.roundRect(this.x, this.y, this.width, this.height, [4]);
    ctx.fill();

    // 车身边框
    ctx.strokeStyle = 'rgba(0,0,0,0.2)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(this.x, this.y, this.width, this.height, [4]);
    ctx.stroke();

    // 方向箭头
    ctx.fillStyle = '#fff';
    ctx.translate(cx, cy);
    const arrowRad = (this.direction - 90) * Math.PI / 180;
    ctx.rotate(arrowRad);

    const arrowSize = Math.min(this.width, this.height) * 0.35;
    ctx.beginPath();
    ctx.moveTo(0, -arrowSize);
    ctx.lineTo(-arrowSize * 0.6, arrowSize * 0.5);
    ctx.lineTo(arrowSize * 0.6, arrowSize * 0.5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();

    // 座位指示器
    const seatSize = Math.min(this.width, this.height) * 0.15;
    const margin = 3;
    for (let i = 0; i < this.seats; i++) {
      const sx = this.x + margin + i * (seatSize + 2);
      const sy = this.y + this.height - seatSize - margin;
      ctx.fillStyle = i < this.passengers ? '#fff' : 'rgba(255,255,255,0.3)';
      ctx.beginPath();
      ctx.arc(sx + seatSize / 2, sy + seatSize / 2, seatSize / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

module.exports = Car;
