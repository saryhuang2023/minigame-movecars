// 主入口：启动主循环

// ===== 全局错误兜底：把崩溃信息直接画到屏幕画布（不依赖 DevTools 控制台，真机可见）=====
// 注意：此前兜底用 wx.createCanvas() 新建画布，但 render.js 已抢走屏幕画布，
// 新建的其实是离屏画布，画上去屏幕看不到。此处改为画到 render.js 的屏幕画布。
function showFatal(title, msg, stack) {
  try {
    var R = require('./render.js');
    var screen = R.canvas;
    var g = screen.getContext('2d');
    g.fillStyle = '#1a0000';
    g.fillRect(0, 0, screen.width, screen.height);
    g.fillStyle = '#ff6363';
    g.font = '14px sans-serif';
    g.textBaseline = 'top';
    g.textAlign = 'left';
    var lines = ['[错误] ' + title, String(msg || '').substring(0, 90)];
    var st = (stack || '').split('\n');
    for (var i = 0; i < st.length && lines.length < 26; i++) {
      lines.push(st[i].substring(0, 90));
    }
    var y = 24;
    for (var j = 0; j < lines.length; j++) {
      g.fillText(lines[j], 12, y);
      y += 20;
      if (y > screen.height - 24) break;
    }
  } catch (e2) {
    // render.js 没加载成功（首屏前就崩）：退回新建画布，此时它就是屏幕画布
    try {
      var c = wx.createCanvas();
      var x = c.getContext('2d');
      x.fillStyle = '#1a0000'; x.fillRect(0, 0, c.width, c.height);
      x.fillStyle = '#ff6363'; x.font = '14px sans-serif'; x.textBaseline = 'top';
      x.fillText('[错误] ' + title + ': ' + String(msg || '').substring(0, 90), 12, 24);
    } catch (e3) {}
  }
}

// 捕获每帧渲染循环 / 异步任务里的崩溃（try-catch 只罩得住启动引导，罩不住 rAF 循环）
function _globalErrHandler(msg, source, lineno, colno, error) {
  var m = (typeof msg === 'string') ? msg
    : (msg && msg.message) ? msg.message
    : String(msg);
  var stack = (error && error.stack) ? error.stack : '';
  showFatal('运行时崩溃', m + ' @' + (source || '') + ':' + (lineno || ''), stack);
}
if (typeof GameGlobal !== 'undefined') GameGlobal.onerror = _globalErrHandler;
if (typeof wx !== 'undefined' && wx.onError) {
  wx.onError(function (err) {
    if (typeof err === 'string') showFatal('运行时崩溃', err, '');
    else showFatal('运行时崩溃', err.message || String(err), err.stack || '');
  });
}

try {
  console.log('[Main] 入口文件开始执行');
  var cloud = require('./cloud.js');
  var Theme = require('./define/GameDefine.js').THEME;
  console.log('[Main] cloud 模块加载完成');
  cloud.initCloud();
  console.log('[cloud][Main] 云开发初始化完成');

  console.log('[Main] 开始加载音频系统...');
  var AudioDefine = require('./audio/AudioDefine.js');
  AudioDefine.setCloudPrefix('cloud://cloud1-4gmoyu9g16089510.636c-cloud1-4gmoyu9g16089510-1316941984/data/audio/sfx/escape_1.mp3');
  console.log('[LOG] main.js — after setCloudPrefix: CLOUD_PREFIX=' + AudioDefine.CLOUD_PREFIX + ' isCloudEnabled=' + AudioDefine.isCloudEnabled());
  var audio = require('./audio/AudioManager.js');
  console.log('[Main] AudioManager 加载完成');
  // (audio.init 已移至 LoadingManager Phase2，此处不再调用)

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
  // 画到屏幕画布（覆盖启动引导阶段的崩溃）
  showFatal('初始化失败', e.message || String(e), e.stack);
}
