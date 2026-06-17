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
    this.projectLevels = [];   // 正式关卡列表 [{ name, file, ... }]
    this.currentLevelIndex = -1; // 当前关卡在 projectLevels 中的索引
  }
}

module.exports = new DataBus();
