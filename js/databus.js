// 全局数据中心（单例）

class DataBus {
  constructor() {
    this.reset();
  }

  reset() {
    // 游戏状态: menu / playing / victory / defeat
    this.gameState = 'menu';

    // 当前关卡配置
    this.levelConfig = null;
    this.currentLevel = 0;

    // 实体列表
    this.cars = [];
    this.slots = [];
    this.passengers = [];
    this.grid = null;

    // 提示结果
    this.hintCarId = null;

    // 帧计数器
    this.frame = 0;

    // 动画锁定（动画播放期间不允许操作）
    this.animLock = false;

    // 注意：this.levels 不在 reset 中清空，由 main.js 设置后保持引用
  }

  /** 加载指定关卡 */
  loadLevel(levelIndex) {
    const savedLevels = this.levels;
    this.reset();
    this.levels = savedLevels;
    const LevelClass = this.levels[levelIndex];
    if (!LevelClass) return false;

    this.levelConfig = new LevelClass();
    this.currentLevel = levelIndex;

    // 创建网格
    const Grid = require('./entities/Grid.js');
    this.grid = new Grid(this.levelConfig);

    // 创建停车位
    const PickupSlot = require('./entities/PickupSlot.js');
    this.slots = this.levelConfig.pickupSlots.map(s => new PickupSlot(s));

    // 创建乘客
    const Passenger = require('./entities/Passenger.js');
    this.passengers = [];
    this.slots.forEach(slot => {
      for (let i = 0; i < slot.maxWait; i++) {
        this.passengers.push(new Passenger(slot.color, slot));
      }
    });

    // 创建汽车
    const Car = require('./entities/Car.js');
    this.cars = this.levelConfig.cars.map(c => new Car(c));

    // 更新网格占用
    this.grid.updateOccupancy(this.cars);

    this.gameState = 'playing';
    return true;
  }

  /** 获取指定颜色的所有车 */
  getCarsByColor(color) {
    return this.cars.filter(c => c.color === color && c.status !== 'departed');
  }

  /** 获取指定颜色的空闲停车位 */
  getAvailableSlot(color) {
    return this.slots.find(s => s.color === color && !s.occupied);
  }

  /** 根据汽车引用查找其停靠的停车位 */
  getSlotByCar(car) {
    return this.slots.find(s => s.carRef === car);
  }

  /** 获取所有等待中的乘客 */
  getWaitingPassengers() {
    return this.passengers.filter(p => !p.boarded);
  }

  /** 检查是否所有乘客已接走 */
  allPassengersBoarded() {
    return this.passengers.every(p => p.boarded);
  }

  /** 是否有车正在移动或弹回中 */
  isAnyCarMoving() {
    return this.cars.some(c =>
      c.status === 'moving_forward' ||
      c.status === 'bouncing_back' ||
      c.status === 'path_moving'
    );
  }
}

// 单例
const databus = new DataBus();

module.exports = databus;
