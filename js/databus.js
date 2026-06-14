// 全局数据中心（单例）

class DataBus {
  constructor() {
    this.reset();
  }

  reset() {
    this.gameState = 'playing';
    this.frame = 0;
    this.screenWidth = 0;
    this.screenHeight = 0;
  }
}

module.exports = new DataBus();
