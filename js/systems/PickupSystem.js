// 接待区停车 + 乘客上车逻辑

const databus = require('../databus.js');

const PickupSystem = {
  /**
   * 汽车开出网格后调用
   */
  onCarExitGrid(car) {
    // 查找同色空闲停车位
    const slot = databus.getAvailableSlot(car.color);
    if (!slot) {
      // 没有空闲车位，弹回
      car.startBounce();
      return;
    }

    // 占用停车位
    slot.occupy(car);

    // 汽车定位到停车位
    car.x = slot.x + (slot.width - car.width) / 2;
    car.y = slot.y + (slot.height - car.height) / 2;
    car.status = 'arrived';

    // 乘客上车
    this.boardPassengers(slot);
  },

  /**
   * 乘客上车
   */
  boardPassengers(slot) {
    if (!slot.carRef) return;

    const car = slot.carRef;

    // 找到该停车位对应的等待乘客
    const waitingPassengers = databus.passengers.filter(
      p => p.slotRef === slot && !p.boarded && !p.animating
    );

    // 每次上车 1 人，有短暂动画
    if (waitingPassengers.length > 0 && car.passengers < car.seats) {
      const passenger = waitingPassengers[0];
      passenger.startBoardAnim();  // 动画结束后会自动设置 boarded = true
      slot.currentWait--;
      car.passengers++;
    }
  },

  /**
   * 每帧更新
   */
  update(dt) {
    // 更新乘客上车动画
    for (const p of databus.passengers) {
      p.update(dt);
    }

    // 检查是否有乘客动画结束 → 继续上车
    for (const slot of databus.slots) {
      if (!slot.occupied || !slot.carRef) continue;
      const car = slot.carRef;

      // 如果还有空位且还有等待乘客
      if (car.passengers < car.seats && slot.currentWait > 0) {
        const waiting = databus.passengers.filter(
          p => p.slotRef === slot && !p.boarded && !p.animating
        );
        if (waiting.length > 0) {
          // 连续上车（延迟处理，让动画有时间播放）
          if (!this._boardTimers) this._boardTimers = {};
          const key = slot.id;
          if (!this._boardTimers[key]) {
            this._boardTimers[key] = 0;
          }
          this._boardTimers[key] += dt;
          if (this._boardTimers[key] > 0.4) {
            this._boardTimers[key] = 0;
            this.boardPassengers(slot);
          }
        }
      }

      // 坐满驶离
      if (car.passengers >= car.seats) {
        car.status = 'departed';
        slot.release();
        databus.grid.updateOccupancy(databus.cars);
      }
    }
  },
};

module.exports = PickupSystem;
