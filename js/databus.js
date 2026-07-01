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
    this.chapters = [];        // 章节配置 [{ chapter, name, icon, themeColor, bgColor, endIndex }]

    // 排查系统字段
    this.currentFPS = 60;       // 实时帧率（GameEngine.loop 更新）
    this.frameTimestamps = [];  // 最近 90 帧的时间戳（用于计算FPS）
    this.currentStep = 0;       // 当前步数（PlayingEngine 同步）

    // 调试开关
    this.DEBUG_TEST_BUTTONS = false; // 游戏内"奖""币"测试按钮（改 true 显示）
  }
}

module.exports = new DataBus();
