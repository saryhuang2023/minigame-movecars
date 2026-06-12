// BFS AI 求解器：提示功能 + 关卡验证

const databus = require('../databus.js');
const MoveSystem = require('../systems/MoveSystem.js');

const HintSolver = {
  cache: new Map(),

  /** 获取推荐车辆 ID */
  getHint() {
    const stateKey = this.serializeState();
    if (this.cache.has(stateKey)) {
      const cached = this.cache.get(stateKey);
      return cached.length > 0 ? cached[0] : null;
    }

    const result = this.bfs();
    this.cache.set(stateKey, result);
    return result.length > 0 ? result[0] : null;
  },

  /** 清除缓存 */
  clearCache() {
    this.cache.clear();
  },

  /** BFS 搜索 */
  bfs() {
    // 保存当前状态
    const savedState = this.saveGameState();

    const queue = [{
      stateKey: this.serializeState(),
      path: [],
    }];
    const visited = new Map();
    visited.set(queue[0].stateKey, 0);

    while (queue.length > 0) {
      const { stateKey, path } = queue.shift();

      // 深度限制
      if (path.length >= 20) continue;

      // 目标检测
      if (this.isGoalState()) {
        this.restoreGameState(savedState);
        return path;
      }

      // 枚举所有可移动的车
      const movableCars = this.getMovableCars();
      for (const carId of movableCars) {
        // 模拟移动
        const success = this.simulateMove(carId);
        if (!success) continue;

        const nextKey = this.serializeState();
        if (!visited.has(nextKey)) {
          visited.set(nextKey, path.length + 1);
          queue.push({ stateKey: nextKey, path: [...path, carId] });
        }

        // 撤销移动
        this.restoreGameState(savedState);
        // 重放到当前位置
        for (let j = 0; j < path.length; j++) {
          this.simulateMove(path[j]);
        }
      }
    }

    this.restoreGameState(savedState);
    return [];
  },

  /** 保存游戏状态快照 */
  saveGameState() {
    return {
      cars: databus.cars.map(c => ({
        id: c.id,
        x: c.x,
        y: c.y,
        status: c.status,
        passengers: c.passengers,
      })),
      slots: databus.slots.map(s => ({
        id: s.id,
        occupied: s.occupied,
        currentWait: s.currentWait,
        carPassengers: s.carRef ? s.carRef.passengers : 0,
      })),
      passengers: databus.passengers.map(p => ({
        boarded: p.boarded,
        animating: p.animating,
      })),
    };
  },

  /** 恢复游戏状态 */
  restoreGameState(snapshot) {
    for (let i = 0; i < databus.cars.length; i++) {
      const c = databus.cars[i];
      const sc = snapshot.cars[i];
      if (!sc) continue;
      c.x = sc.x;
      c.y = sc.y;
      c.status = sc.status;
      c.passengers = sc.passengers;
      // 重置动画相关
      c.targetX = c.x;
      c.targetY = c.y;
      c.originX = c.x;
      c.originY = c.y;
    }

    for (let i = 0; i < databus.slots.length; i++) {
      const s = databus.slots[i];
      const ss = snapshot.slots[i];
      if (!ss) continue;
      s.occupied = ss.occupied;
      s.currentWait = ss.currentWait;
      if (!ss.occupied) {
        s.carRef = null;
      }
    }

    for (let i = 0; i < databus.passengers.length; i++) {
      const p = databus.passengers[i];
      const sp = snapshot.passengers[i];
      if (!sp) continue;
      p.boarded = sp.boarded;
      p.animating = sp.animating;
    }

    databus.grid.updateOccupancy(databus.cars);
  },

  /** 模拟移动一辆车（用于 BFS 搜索） */
  simulateMove(carId) {
    const car = databus.cars.find(c => c.id === carId);
    if (!car || car.status !== 'idle') return false;

    const grid = databus.grid;
    const maxDist = MoveSystem.scanRay(car, grid);
    if (maxDist <= 0) return false;

    // 执行瞬移（BFS 不需要动画）
    const rad = car.direction * Math.PI / 180;
    car.x += Math.sin(rad) * maxDist;
    car.y -= Math.cos(rad) * maxDist;

    // 检查是否开出网格
    if (!grid.isInsideParkingArea(car.x, car.y, car.width, car.height)) {
      // 进入接待区
      const slot = databus.getAvailableSlot(car.color);
      if (slot) {
        slot.occupy(car);
        car.status = 'arrived';
        // 乘客上车（直接上完，BFS 不播放动画）
        while (slot.currentWait > 0 && car.passengers < car.seats) {
          slot.currentWait--;
          car.passengers++;
          const p = databus.passengers.find(
            p => p.slotRef === slot && !p.boarded
          );
          if (p) p.boarded = true;
        }
        // 坐满驶离
        if (car.passengers >= car.seats) {
          car.status = 'departed';
          slot.release();
        }
      } else {
        // 没有空闲车位，无法开出
        return false;
      }
    }

    grid.updateOccupancy(databus.cars);
    return true;
  },

  /** 获取所有可移动的车 */
  getMovableCars() {
    const grid = databus.grid;
    return databus.cars
      .filter(c => c.status === 'idle')
      .filter(c => MoveSystem.scanRay(c, grid) > 0)
      .map(c => c.id);
  },

  /** 序列化当前状态 */
  serializeState() {
    const cars = databus.cars
      .filter(c => c.status === 'idle' || c.status === 'arrived')
      .map(c => {
        const gx = Math.round(c.x / 20);
        const gy = Math.round(c.y / 20);
        return `${c.id}:${gx},${gy}:${c.passengers}`;
      })
      .sort()
      .join('|');

    const slots = databus.slots
      .map(s => `${s.color}:${s.currentWait}:${s.occupied ? 1 : 0}`)
      .sort()
      .join('|');

    return `${cars}||${slots}`;
  },

  /** 判断是否达成目标 */
  isGoalState() {
    return databus.slots.every(s => s.currentWait === 0) &&
           databus.passengers.every(p => p.boarded);
  },
};

module.exports = HintSolver;
