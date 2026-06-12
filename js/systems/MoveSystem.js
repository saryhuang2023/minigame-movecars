// 汽车移动逻辑：射线扫描 + 碰撞检测

const databus = require('../databus.js');
const { GRID_CELL_SIZE } = require('../entities/Grid.js');
const { SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');

const MoveSystem = {
  /**
   * 尝试移动一辆车
   * 干跑扫描路径 → 计算目标位置 → 启动移动
   */
  tryMove(car) {
    if (car.status !== 'idle') return false;

    const grid = databus.grid;
    if (!grid) return false;

    // 射线扫描
    const maxDist = this.scanRay(car, grid);
    if (maxDist <= 0) return false;

    // 计算目标位置
    const rad = car.direction * Math.PI / 180;
    const targetX = car.x + Math.sin(rad) * maxDist;
    const targetY = car.y - Math.cos(rad) * maxDist;

    // 启动移动
    grid.unmarkCar(car);
    car.startMoving(targetX, targetY);
    grid.markCar(car);

    return true;
  },

  /**
   * 射线扫描：沿方向发射射线，计算不碰撞的最远距离
   * 使用 DDA 算法遍历细粒度网格
   */
  scanRay(car, grid) {
    const rad = car.direction * Math.PI / 180;
    const dx = Math.sin(rad);
    const dy = -Math.cos(rad);

    // 使用细粒度网格步长
    const step = GRID_CELL_SIZE / 2;
    let distance = 0;
    const maxDist = 2000; // 最大扫描距离

    while (distance < maxDist) {
      distance += step;

      const checkX = car.x + dx * distance;
      const checkY = car.y + dy * distance;

      // 检查是否已开出停车区域 → 可进入接待区
      if (!grid.isInsideParkingArea(checkX, checkY, car.width, car.height)) {
        // 再往外走一步确认真的离开了
        const furtherX = checkX + dx * step;
        const furtherY = checkY + dy * step;
        if (!grid.isInsideParkingArea(furtherX, furtherY, car.width, car.height)) {
          return distance + step;
        }
        // 检查是否能进入接待区（顶部区域）
        if (checkY < grid.offsetY) {
          return distance;
        }
      }

      // 检查是否超出屏幕
      if (checkX < 0 || checkY < 0 ||
          checkX + car.width > SCREEN_WIDTH ||
          checkY + car.height > SCREEN_HEIGHT) {
        return distance;
      }

      // 碰撞检测：检查该位置是否被占用
      if (grid.isRectOccupied(checkX, checkY, car.width, car.height, car)) {
        return distance - step; // 停在障碍物前
      }
    }

    return maxDist;
  },

  /**
   * 每帧更新所有车的移动状态
   */
  update(dt) {
    const grid = databus.grid;
    if (!grid) return;

    for (const car of databus.cars) {
      car.update(dt, grid);
    }
  },
};

module.exports = MoveSystem;
