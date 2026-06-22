// 排查系统 — BugReporter
// 四层架构：捕获 → 采集 → 传输 → 恢复
// 依赖注入式接入，不侵入现有模块

const cloud = require('../cloud.js');

// ========== 配置 ==========
const CONFIG = {
  MAX_REPORTS_PER_SESSION: 5,       // 单次启动最多上报
  MAX_LOG_BUFFER: 200,               // 控制台日志环大小
  MAX_ACTION_LOG: 30,                // 操作回放环大小
  MAX_PENDING_STORAGE: 50,           // 离线缓冲上限
  LAG_FPS_THRESHOLD: 18,            // 低于此FPS开始计数
  LAG_DURATION_THRESHOLD: 3000,     // 连续低帧 >= 3秒触发
  CRASH_RECOVERY_DELAY: 500,        // 崩溃后延迟恢复(ms)
};

/** 生成 UUID v4 */
function uuid() {
  var s = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
  return s.replace(/[xy]/g, function (c) {
    var r = Math.random() * 16 | 0;
    var v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

// ========== BugReporter 单例 ==========

class BugReporter {
  constructor() {
    this._enabled = false;
    this._sessionReportCount = 0;
    this._logBuffer = [];
    this._actionLog = [];
    this._pendingReports = [];
    this._lagTimer = 0;
    this._lagActive = false;
    this._engineRef = null;   // GameEngine 引用（供 snapshot 用）
    this._databusRef = null;  // databus 引用

    // 劫持 console
    this._hijacked = false;
    this._originalConsole = {};
  }

  // ========== Layer 1: 捕获 ==========

  /**
   * 初始化（在云开发初始化之后、GameEngine 创建之后调用）
   * @param {object} engine GameEngine 实例
   * @param {object} databus 全局 databus
   */
  init(engine, databus) {
    if (this._enabled) return;
    this._engineRef = engine;
    this._databusRef = databus;
    this._enabled = true;

    // 劫持 console
    this._hijackConsole();

    // JS 异常捕获
    if (typeof wx !== 'undefined' && wx.onError) {
      wx.onError((err) => this._onCrash(err, 'onError'));
    }

    // Promise 未捕获拒绝
    if (typeof wx !== 'undefined' && wx.onUnhandledRejection) {
      wx.onUnhandledRejection((res) => {
        var msg = '';
        if (typeof res.reason === 'string') {
          msg = res.reason;
        } else if (res.reason && res.reason.message) {
          msg = res.reason.message;
        } else {
          msg = JSON.stringify(res.reason).substring(0, 200);
        }
        this._onCrash({ message: msg, stack: '' }, 'unhandledRejection');
      });
    }

    // 加载离线缓冲
    this._loadPending();

    // 网络恢复时补报
    if (typeof wx !== 'undefined' && wx.onNetworkStatusChange) {
      var self = this;
      wx.onNetworkStatusChange(function (res) {
        if (res.isConnected) self._flushPending();
      });
    }

    console.log('[BugReporter] 排查系统已启动');
  }

  /** 劫持 console.log/warn/error 写入环形缓冲 */
  _hijackConsole() {
    if (this._hijacked) return;
    this._hijacked = true;
    var self = this;
    var levels = ['log', 'warn', 'error'];

    for (var i = 0; i < levels.length; i++) {
      (function (lv) {
        self._originalConsole[lv] = console[lv];
        console[lv] = function () {
          // 写入环形缓冲
          var d = new Date();
          var ts = pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) + '.' + pad3(d.getMilliseconds());
          var args = [];
          for (var j = 0; j < arguments.length; j++) {
            args.push(String(arguments[j]));
          }
          self._logBuffer.push('[' + ts + '] [' + lv.toUpperCase() + '] ' + args.join(' '));
          if (self._logBuffer.length > CONFIG.MAX_LOG_BUFFER) {
            self._logBuffer.shift();
          }
          // 保留原始输出
          self._originalConsole[lv].apply(console, arguments);
        };
      })(levels[i]);
    }
  }

  /** 记录用户操作（供回放） */
  logAction(event) {
    if (!this._enabled) return;
    var entry = {
      t: Date.now(),
      type: event.type
    };
    if (event.touches && event.touches.length > 0) {
      entry.x = Math.round(event.touches[0].clientX || event.touches[0].x);
      entry.y = Math.round(event.touches[0].clientY || event.touches[0].y);
    } else if (event.x !== undefined) {
      entry.x = Math.round(event.x);
      entry.y = Math.round(event.y);
    }
    this._actionLog.push(entry);
    if (this._actionLog.length > CONFIG.MAX_ACTION_LOG) {
      this._actionLog.shift();
    }
  }

  /** FPS 卡顿检测（每帧调用） */
  checkLag(now) {
    if (!this._enabled) return;
    if (typeof this._databusRef === 'undefined' || !this._databusRef) return;
    var fps = this._databusRef.currentFPS;
    if (typeof fps !== 'number' || fps <= 0) return;

    if (fps < CONFIG.LAG_FPS_THRESHOLD) {
      if (!this._lagActive) {
        this._lagTimer += (now - (this._lastCheckTime || now));
        if (this._lagTimer >= CONFIG.LAG_DURATION_THRESHOLD) {
          this._lagActive = true;
          this._onLag();
        }
      }
    } else {
      this._lagTimer = 0;
      this._lagActive = false;
    }
    this._lastCheckTime = now;
  }

  // ========== Layer 2: 上下文采集 ==========

  /** 生成完整上下文快照 */
  snapshot(trigger, error) {
    return {
      meta: {
        reportId: uuid(),
        timestamp: Date.now(),
        trigger: trigger,       // 'crash' | 'lag' | 'user' | 'unhandledRejection'
        version: this._getVersion(),
        sessionCount: this._sessionReportCount,
        dupCount: 1
      },
      device: this._getDeviceInfo(),
      game: this._getGameState(),
      error: error ? { message: error.message || '', stack: error.stack || '' } : null,
      replay: this._actionLog.slice(-CONFIG.MAX_ACTION_LOG),
      perf: this._getPerf(),
      logs: this._logBuffer.slice(-CONFIG.MAX_LOG_BUFFER)
    };
  }

  _getVersion() {
    try {
      if (typeof __wxConfig !== 'undefined' && __wxConfig) return __wxConfig.version || 'dev';
    } catch (e) { /* ignore */ }
    return 'dev';
  }

  _getDeviceInfo() {
    var info = { platform: 'unknown', model: 'unknown' };
    try {
      if (typeof wx !== 'undefined' && wx.getSystemInfoSync) {
        var s = wx.getSystemInfoSync();
        info = {
          platform: s.platform,
          model: s.model,
          system: s.system,
          brand: s.brand,
          screenWidth: s.screenWidth,
          screenHeight: s.screenHeight,
          pixelRatio: s.pixelRatio,
          SDKVersion: s.SDKVersion,
          benchmarkLevel: s.benchmarkLevel,
          memorySize: s.memorySize
        };
      }
    } catch (e) { /* ignore */ }
    // 生成设备指纹（不包含个人信息）
    info.deviceId = this._deviceFingerprint(info);
    return info;
  }

  _deviceFingerprint(info) {
    var raw = (info.model || '') + '|' + (info.system || '') + '|' +
              (info.screenWidth || '') + '|' + (info.screenHeight || '') + '|' +
              (info.pixelRatio || '');
    var hash = 0;
    for (var i = 0; i < raw.length; i++) {
      hash = ((hash << 5) - hash) + raw.charCodeAt(i);
      hash |= 0;
    }
    return 'dev_' + Math.abs(hash).toString(36).substring(0, 8);
  }

  _getGameState() {
    var g = this._databusRef;
    if (!g) return { scene: 'unknown' };

    var state = {
      scene: g.gameState || 'unknown',
      frame: g.frame || 0,
      fps: g.currentFPS || 0
    };

    // 关卡信息
    if (g.currentLevelIndex >= 0) {
      state.levelIndex = g.currentLevelIndex;
    }
    if (g.currentLevel && g.currentLevel.name) {
      state.levelName = g.currentLevel.name;
    }
    if (typeof g.currentStep === 'number') {
      state.step = g.currentStep;
    }

    // 棋盘配置（从活跃引擎提取）
    var eng = this._engineRef;
    if (eng) {
      var gp = null;
      if (g.gameState === 'editor' && eng.editor && eng.editor.gp) {
        gp = eng.editor.gp;
      } else if (g.gameState === 'playing' && eng.playing && eng.playing.gp) {
        gp = eng.playing.gp;
      }

      if (gp) {
        state.boardConfig = {
          rows: gp.rows,
          oddCols: gp.oddCols,
          boardWidth: gp.boardWidth,
          boardRate: gp.boardRate,
          scaledDiameter: Math.round(gp.scaledDiameter * 10) / 10,
          boardScale: gp.boardScale ? Math.round(gp.boardScale * 100) / 100 : 1
        };
        // 猪信息精简
        if (gp.pigs && gp.pigs.length > 0) {
          state.pigs = [];
          for (var i = 0; i < gp.pigs.length; i++) {
            var p = gp.pigs[i];
            state.pigs.push({
              id: p.id,
              tail: p.tailIndex,
              len: p.length,
              angle: Math.round(p.angle * 100) / 100
            });
          }
        }
        state.activeEngine = (g.gameState === 'editor') ? 'EditorEngine' : 'PlayingEngine';
      }
    }

    return state;
  }

  _getPerf() {
    var g = this._databusRef;
    if (!g) return {};
    return {
      avgFps: g.currentFPS || 0
    };
  }

  // ========== Layer 3: 传输 ==========

  /** 崩溃上报 */
  _onCrash(err, trigger) {
    // 频率限制
    if (this._sessionReportCount >= CONFIG.MAX_REPORTS_PER_SESSION) {
      console.warn('[BugReporter] 已达单次启动上报上限，丢弃本条');
      return;
    }
    this._sessionReportCount++;

    var snapshot = this.snapshot(trigger, err);
    this._report(snapshot);

    // 恢复：弹窗 + 回到选关
    var self = this;
    if (typeof wx !== 'undefined' && wx.showModal) {
      wx.showModal({
        title: '出了点问题',
        content: '游戏遇到异常，已自动记录。\n点击确定返回主菜单。',
        showCancel: false,
        success: function () {
          if (self._databusRef) {
            self._databusRef.gameState = 'menu';
          }
        }
      });
    }
  }

  /** 卡顿上报（静默） */
  _onLag() {
    if (this._sessionReportCount >= CONFIG.MAX_REPORTS_PER_SESSION) return;
    this._sessionReportCount++;

    var snapshot = this.snapshot('lag', { message: 'FPS < ' + CONFIG.LAG_FPS_THRESHOLD + ' for ' + CONFIG.LAG_DURATION_THRESHOLD + 'ms', stack: '' });
    // 静默上报，无 UI 弹窗
    this._report(snapshot);
    this._lagTimer = 0;
    this._lagActive = false;
  }

  /** 用户主动报告 */
  userReport(remark) {
    var snapshot = this.snapshot('user', null);
    if (remark) snapshot.userRemark = remark.substring(0, 200);
    this._report(snapshot);

    if (typeof wx !== 'undefined' && wx.showToast) {
      wx.showToast({ title: '已上报', icon: 'success', duration: 1500 });
    }
  }

  /** 实际传输 */
  _report(snapshot) {
    // 先尝试直接上报
    var self = this;
    this._sendReport(snapshot)
      .then(function () {
        console.log('[BugReporter] 上报成功', snapshot.meta.reportId);
      })
      .catch(function (err) {
        // 网络失败 → 离线缓存
        console.warn('[BugReporter] 上报失败，离线缓存', err && err.message);
        self._pendingReports.push(snapshot);
        if (self._pendingReports.length > CONFIG.MAX_PENDING_STORAGE) {
          self._pendingReports.shift();
        }
        self._savePending();
      });
  }

  _sendReport(snapshot) {
    return cloud.callFunction('reportBug', { report: snapshot });
  }

  // ========== 离线缓冲 ==========

  _savePending() {
    try {
      if (typeof wx !== 'undefined' && wx.setStorageSync) {
        wx.setStorageSync('bug_reports_pending', JSON.stringify(this._pendingReports));
      }
    } catch (e) { /* ignore */ }
  }

  _loadPending() {
    try {
      if (typeof wx !== 'undefined' && wx.getStorageSync) {
        var raw = wx.getStorageSync('bug_reports_pending');
        if (raw) {
          this._pendingReports = JSON.parse(raw);
          console.log('[BugReporter] 加载离线缓冲', this._pendingReports.length, '条');
        }
      }
    } catch (e) { /* ignore */ }
  }

  _flushPending() {
    if (this._pendingReports.length === 0) return;
    console.log('[BugReporter] 补报离线缓冲', this._pendingReports.length, '条');

    var self = this;
    var reports = this._pendingReports.slice();
    this._pendingReports = [];
    this._savePending();

    // 逐条补报
    function flushOne(idx) {
      if (idx >= reports.length) return;
      self._sendReport(reports[idx])
        .then(function () { flushOne(idx + 1); })
        .catch(function () { flushOne(idx + 1); });
    }
    flushOne(0);
  }

  // ========== 开发者工具 ==========

  /** 获取当前诊断快照（字符串化，供复制/调试） */
  getDiagnosticString() {
    var snap = this.snapshot('manual', null);
    return JSON.stringify(snap, null, 2);
  }

  /** 将诊断快照写入剪贴板（开发工具内使用） */
  copyDiagnostic() {
    var str = this.getDiagnosticString();
    if (typeof wx !== 'undefined' && wx.setClipboardData) {
      wx.setClipboardData({ data: str.substring(0, 10000) });
    }
    return str;
  }
}

// 位补齐工具函数
function pad2(n) { return ('0' + n).slice(-2); }
function pad3(n) { return ('00' + n).slice(-3); }

// 导出单例
module.exports = new BugReporter();
