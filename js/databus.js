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

    // 排查系统字段
    this.currentFPS = 60;       // 实时帧率（GameEngine.loop 更新）
    this.frameTimestamps = [];  // 最近 90 帧的时间戳（用于计算FPS）
    this.currentStep = 0;       // 当前步数（PlayingEngine 同步）
  }
}

module.exports = new DataBus();
