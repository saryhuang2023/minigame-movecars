// 主入口：启动主循环

try {
  console.log('[Main] 入口文件开始执行');
  var cloud = require('./cloud.js');
  console.log('[Main] cloud 模块加载完成');
  cloud.initCloud();
  console.log('[Main] 云开发初始化完成');

  console.log('[Main] 开始加载 GameEngine...');
  var GameEngine = require('./core/GameEngine.js');
  console.log('[Main] GameEngine 模块加载完成');
  var databus = require('./databus.js');
  console.log('[Main] databus 加载完成');
  var BugReporter = require('./debug/BugReporter.js');
  console.log('[Main] BugReporter 加载完成');

  console.log('[Main] 开始创建 GameEngine 实例...');
  var engine = new GameEngine();
  console.log('[Main] GameEngine 实例创建完成, gameState=' + databus.gameState);

  BugReporter.init(engine, databus);
  console.log('[Main] BugReporter 初始化完成');
} catch (e) {
  console.error('[Main] 致命错误:', e);
  console.error('[Main] 错误堆栈:', e.stack);
  // 尝试在 Canvas 上画错误信息
  try {
    var c = wx.createCanvas();
    var ctx2 = c.getContext('2d');
    ctx2.fillStyle = '#000';
    ctx2.fillRect(0, 0, c.width, c.height);
    ctx2.fillStyle = '#f00';
    ctx2.font = '16px sans-serif';
    ctx2.fillText('初始化失败: ' + (e.message || String(e)), 20, c.height / 2);
  } catch (e2) {
    // 彻底失败，无能为力
  }
}
