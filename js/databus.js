// 全局数据中心（单例）

class DataBus {
  constructor() {
    this.reset();
  }

  reset() {
    this.gameState = 'menu'; // menu / levelSelect / playing / editor
    this.frame = 0;
    this.screenWidth = 0;
    this.screenHeight = 0;
    this.currentLevel = null; // 选中的关卡数据 { name, data }
  }
}

module.exports = new DataBus();
