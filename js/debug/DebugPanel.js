// 开发者调试面板 — 三指长按 2 秒触发
// Canvas 渲染半屏卡片，显示运行时诊断信息 + 操作按钮

const { ctx, SCREEN_WIDTH, SCREEN_HEIGHT } = require('../render.js');
const BugReporter = require('./BugReporter.js');
const cloud = require('../cloud.js');
const GoldSystem = require('../game/GoldSystem.js');
const SkinSystem = require('../game/SkinSystem.js');
const Theme = require('../define/GameDefine.js').THEME;

// ========== 配置 ==========
const CONFIG = {
  LONG_PRESS_DURATION: 2000,    // 触发长按 ms
  FINGER_COUNT: 3,              // 需要的手指数量
  MOVE_TOLERANCE: 15,           // 允许的移动容差 px
  CARD_WIDTH: 320,              // 面板宽度
  CARD_RADIUS: 16,              // 圆角
  ROW_HEIGHT: 36,               // 每行高度
  BTN_HEIGHT: 40,               // 按钮高度
  FONT_SIZE_LABEL: 13,          // 标签字体
  FONT_SIZE_VALUE: 13,          // 值字体
  FONT_SIZE_TITLE: 16,          // 标题字体
  FONT_SIZE_BTN: 14,            // 按钮字体
};

// ========== 颜色 ==========
const C = {
  overlay: 'rgba(0, 0, 0, 0.45)',
  cardBg: '#FFFFFF',
  cardBorder: '#E2E8F0',
  titleText: '#0F172A',
  labelText: '#64748B',
  valueText: '#1E293B',
  divider: '#F1F5F9',
  btnBg: '#F8FAFC',
  btnText: '#334155',
  btnBorder: '#E2E8F0',
  btnDangerBg: '#FEF2F2',
  btnDangerText: '#DC2626',
  btnDangerBorder: '#FECACA',
  btnPrimaryBg: '#EC4899',
  btnPrimaryText: '#FFFFFF',
  fpsGood: '#10B981',
  fpsWarn: '#F59E0B',
  fpsBad: '#EF4444',
};

class DebugPanel {
  constructor() {
    this._visible = false;
    this._gestureTimer = null;
    this._gestureStartPos = null;  // 三指起点平均位置
    this._gestureActive = false;
    this._cardLayout = null;       // 面板按钮布局（碰撞检测用）

    // 日志查看状态
    this._showLogs = false;
    this._logScroll = 0;

    // simCrash 防抖
    this._simCrashCooldown = false;
  }

  // ========== 手势检测 ==========

  /** 在 InputManager.handlePendingEvents 之前调用，检查是否触发三指长按 */
  checkGesture(event) {
    if (!event || !event.touches) return;

    var count = event.touches.length;

    if (event.type === 'touchstart' && count >= CONFIG.FINGER_COUNT && !this._gestureActive) {
      this._startGesture(event.touches);
    } else if (event.type === 'touchmove' && this._gestureActive) {
      this._checkGestureMove(event.touches);
    } else if (event.type === 'touchend' && this._gestureActive) {
      this._cancelGesture();
    }
  }

  _startGesture(touches) {
    // 计算所有手指的平均位置
    var sumX = 0, sumY = 0;
    for (var i = 0; i < touches.length; i++) {
      sumX += touches[i].x;
      sumY += touches[i].y;
    }
    this._gestureStartPos = { x: sumX / touches.length, y: sumY / touches.length };
    this._gestureActive = true;

    var self = this;
    this._gestureTimer = setTimeout(function () {
      if (self._gestureActive) {
        self.toggle();
        self._gestureActive = false;
        self._gestureTimer = null;
      }
    }, CONFIG.LONG_PRESS_DURATION);
  }

  _checkGestureMove(touches) {
    if (!this._gestureStartPos || touches.length < CONFIG.FINGER_COUNT) return;

    var sumX = 0, sumY = 0;
    for (var i = 0; i < touches.length; i++) {
      sumX += touches[i].x;
      sumY += touches[i].y;
    }
    var avgX = sumX / touches.length;
    var avgY = sumY / touches.length;
    var dx = avgX - this._gestureStartPos.x;
    var dy = avgY - this._gestureStartPos.y;

    // 移动超过容差 → 取消
    if (Math.abs(dx) > CONFIG.MOVE_TOLERANCE || Math.abs(dy) > CONFIG.MOVE_TOLERANCE) {
      this._cancelGesture();
    }
  }

  _cancelGesture() {
    if (this._gestureTimer) {
      clearTimeout(this._gestureTimer);
      this._gestureTimer = null;
    }
    this._gestureActive = false;
    this._gestureStartPos = null;
  }

  // ========== 显示/隐藏 ==========

  get visible() { return this._visible; }

  toggle() {
    this._visible = !this._visible;
    this._showLogs = false;
    this._logScroll = 0;
    if (this._visible) {
      console.log('[DebugPanel] 已打开');
    }
  }

  hide() {
    this._visible = false;
    this._showLogs = false;
  }

  // ========== 事件处理 ==========

  /** 面板可见时路由触摸事件，返回 true 表示事件已被面板消费 */
  handleEvent(event) {
    if (!this._visible || !event || event.type !== 'touchstart') return false;
    if (!event.touches || event.touches.length === 0) return false;

    var t = event.touches[0];

    // 日志模式：点击面板外关闭
    if (this._showLogs) {
      if (this._cardLayout && this._isInside(t, this._cardLayout)) {
        // 点击日志面板内 → 滚动
        this._logScroll += 6;
        return true;
      }
      this._showLogs = false;
      return true;
    }

    // 点击面板外 → 关闭
    if (this._cardLayout && !this._isInside(t, this._cardLayout)) {
      this.hide();
      return true;
    }

    // 面板内按钮
    if (this._btnLayouts) {
      for (var i = 0; i < this._btnLayouts.length; i++) {
        var btn = this._btnLayouts[i];
        if (this._isInside(t, btn)) {
          if (btn.action) btn.action();
          return true;
        }
      }
    }

    return true; // 面板内非按钮区域也消费事件
  }

  _isInside(touch, rect) {
    return touch.x >= rect.x && touch.x <= rect.x + rect.w &&
           touch.y >= rect.y && touch.y <= rect.y + rect.h;
  }

  // ========== 渲染 ==========

  render(databus, engine) {
    if (!this._visible) return;

    // 半透明遮罩
    ctx.fillStyle = C.overlay;
    ctx.fillRect(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    if (this._showLogs) {
      this._renderLogView(databus);
      return;
    }

    // 收集诊断数据
    var info = this._collectInfo(databus, engine);

    // 动态计算面板高度
    var infoRows = info.length;
    var btnRows = 2; // 每行 2 个按钮
    var cardH = 56 + infoRows * CONFIG.ROW_HEIGHT + 16 + btnRows * (CONFIG.BTN_HEIGHT + 10) + 24;
    var cardX = (SCREEN_WIDTH - CONFIG.CARD_WIDTH) / 2;
    var cardY = (SCREEN_HEIGHT - cardH) / 2;

    // 卡片背景
    this._drawRoundRect(cardX, cardY, CONFIG.CARD_WIDTH, cardH, CONFIG.CARD_RADIUS, C.cardBg, false);
    // 阴影
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.15)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 8;
    this._drawRoundRect(cardX, cardY, CONFIG.CARD_WIDTH, cardH, CONFIG.CARD_RADIUS, C.cardBg, true);
    ctx.restore();

    // 边框
    ctx.strokeStyle = C.cardBorder;
    ctx.lineWidth = 1;
    this._drawRoundRectStroke(cardX, cardY, CONFIG.CARD_WIDTH, cardH, CONFIG.CARD_RADIUS);

    // 标题栏
    var titleY = cardY + 18;
    ctx.fillStyle = C.titleText;
    ctx.font = 'bold ' + CONFIG.FONT_SIZE_TITLE + 'px ' + Theme.font.family + '';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('🔧 Debug Panel', cardX + 20, titleY + CONFIG.FONT_SIZE_TITLE / 2);

    // 关闭按钮区域 (右上角)
    ctx.fillStyle = C.labelText;
    ctx.font = '12px ' + Theme.font.family + '';
    ctx.textAlign = 'right';
    ctx.fillText('点击外部关闭', cardX + CONFIG.CARD_WIDTH - 20, titleY + CONFIG.FONT_SIZE_TITLE / 2);

    // 分割线
    var dividerY = cardY + 48;
    ctx.strokeStyle = C.divider;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + 16, dividerY);
    ctx.lineTo(cardX + CONFIG.CARD_WIDTH - 16, dividerY);
    ctx.stroke();

    // 信息行
    var rowStartY = dividerY + 16;
    for (var r = 0; r < infoRows; r++) {
      var row = info[r];
      var ry = rowStartY + r * CONFIG.ROW_HEIGHT;
      var midX = cardX + CONFIG.CARD_WIDTH * 0.42;

      // 标签
      ctx.fillStyle = C.labelText;
      ctx.font = CONFIG.FONT_SIZE_LABEL + 'px ' + Theme.font.family + '';
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(row.label, midX - 8, ry + CONFIG.ROW_HEIGHT / 2);

      // 值（支持带颜色）
      ctx.fillStyle = row.color || C.valueText;
      ctx.font = 'bold ' + CONFIG.FONT_SIZE_VALUE + 'px ' + Theme.font.family + '';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(row.value, midX + 8, ry + CONFIG.ROW_HEIGHT / 2);
    }

    // 按钮区域
    var btnStartY = rowStartY + infoRows * CONFIG.ROW_HEIGHT + 16;
    var btnW = (CONFIG.CARD_WIDTH - 56) / 2;
    var btnGap = 12;

    var buttons = this._getButtons();
    this._btnLayouts = [];

    for (var b = 0; b < buttons.length; b++) {
      var col = b % 2;
      var row = Math.floor(b / 2);
      var bx = cardX + 20 + col * (btnW + btnGap);
      var by = btnStartY + row * (CONFIG.BTN_HEIGHT + 10);

      var btn = buttons[b];
      var bgColor = btn.danger ? C.btnDangerBg : (btn.primary ? C.btnPrimaryBg : C.btnBg);
      var textColor = btn.danger ? C.btnDangerText : (btn.primary ? C.btnPrimaryText : C.btnText);
      var borderColor = btn.danger ? C.btnDangerBorder : (btn.primary ? C.btnPrimaryBg : C.btnBorder);

      this._drawRoundRect(bx, by, btnW, CONFIG.BTN_HEIGHT, 8, bgColor, false);
      ctx.strokeStyle = borderColor;
      ctx.lineWidth = 1.5;
      this._drawRoundRectStroke(bx, by, btnW, CONFIG.BTN_HEIGHT, 8);

      ctx.fillStyle = textColor;
      ctx.font = 'bold ' + CONFIG.FONT_SIZE_BTN + 'px ' + Theme.font.family + '';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(btn.label, bx + btnW / 2, by + CONFIG.BTN_HEIGHT / 2);

      this._btnLayouts.push({ x: bx, y: by, w: btnW, h: CONFIG.BTN_HEIGHT, action: btn.action });
    }

    // 记录卡片范围（用于点击外关闭）
    this._cardLayout = { x: cardX, y: cardY, w: CONFIG.CARD_WIDTH, h: cardH };
  }

  _renderLogView(databus) {
    var BugReporter = require('./BugReporter.js');
    var snap = JSON.parse(BugReporter.getDiagnosticString());
    var logs = snap.logs || [];

    var cardW = SCREEN_WIDTH - 32;
    var cardH = SCREEN_HEIGHT - 120;
    var cardX = 16;
    var cardY = 60;

    // 背景
    this._drawRoundRect(cardX, cardY, cardW, cardH, CONFIG.CARD_RADIUS, C.cardBg, false);
    ctx.strokeStyle = C.cardBorder;
    ctx.lineWidth = 1;
    this._drawRoundRectStroke(cardX, cardY, cardW, cardH, CONFIG.CARD_RADIUS);

    // 标题
    ctx.fillStyle = C.titleText;
    ctx.font = 'bold ' + CONFIG.FONT_SIZE_TITLE + 'px ' + Theme.font.family + '';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('📋 Console Logs (点击继续滚动)', cardX + 16, cardY + 14);

    // 分割线
    ctx.strokeStyle = C.divider;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(cardX + 16, cardY + 42);
    ctx.lineTo(cardX + cardW - 16, cardY + 42);
    ctx.stroke();

    // 日志内容（从后往前显示最新）
    var logY = cardY + 52;
    var lineH = 18;
    var maxLines = Math.floor((cardH - 80) / lineH);
    var scrollOffset = Math.min(this._logScroll, Math.max(0, logs.length - maxLines));
    var startIdx = Math.max(0, logs.length - maxLines - scrollOffset);

    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';

    for (var i = startIdx; i < Math.min(logs.length, startIdx + maxLines); i++) {
      var line = logs[i];
      if (line.length > 80) line = line.substring(0, 80);

      // 根据日志级别着色
      if (line.indexOf('[ERROR]') !== -1) {
        ctx.fillStyle = '#DC2626';
      } else if (line.indexOf('[WARN]') !== -1) {
        ctx.fillStyle = '#D97706';
      } else {
        ctx.fillStyle = '#475569';
      }

      var lineIdx = i - startIdx;
      ctx.fillText(line, cardX + 16, logY + lineIdx * lineH);
    }

    // 滚动提示
    ctx.fillStyle = C.labelText;
    ctx.font = '11px ' + Theme.font.family + '';
    ctx.textAlign = 'center';
    ctx.fillText('点击继续滚动 · 点击外部返回', cardX + cardW / 2, cardY + cardH - 16);

    this._cardLayout = { x: cardX, y: cardY, w: cardW, h: cardH };
  }

  // ========== 辅助方法 ==========

  _collectInfo(databus, engine) {
    var info = [];

    // FPS
    var fps = databus.currentFPS || 0;
    var fpsColor = fps >= 50 ? C.fpsGood : (fps >= 25 ? C.fpsWarn : C.fpsBad);
    info.push({ label: 'FPS', value: String(fps), color: fpsColor });

    // 内存
    var memStr = 'N/A';
    try {
      if (typeof wx !== 'undefined' && typeof wx.getMemoryInfo === 'function') {
        var memInfo = wx.getMemoryInfo();
        if (memInfo) {
          var used = memInfo.usedJSHeapSize || 0;
          memStr = (used / 1024 / 1024).toFixed(1) + ' MB';
        }
      } else if (typeof performance !== 'undefined' && performance.memory) {
        var pm = performance.memory;
        memStr = (pm.usedJSHeapSize / 1024 / 1024).toFixed(1) + ' MB';
      }
    } catch (e) { /* ignore */ }
    info.push({ label: '内存', value: memStr, color: C.valueText });

    // 场景
    var sceneMap = { menu: '主菜单', levelSelect: '选关', playing: '游戏中', editor: '编辑器' };
    info.push({ label: '场景', value: sceneMap[databus.gameState] || databus.gameState, color: C.valueText });

    // 关卡
    var lvStr = databus.currentLevelIndex >= 0 ? '第 ' + (databus.currentLevelIndex + 1) + ' 关' : '无';
    if (databus.currentLevel && databus.currentLevel.name) {
      lvStr += ' (' + databus.currentLevel.name + ')';
    }
    info.push({ label: '关卡', value: lvStr, color: C.valueText });

    // 步数
    info.push({ label: '步数', value: String(databus.currentStep || 0), color: C.valueText });

    // 猪数
    var pigCount = 0;
    try {
      if (databus.gameState === 'editor' && engine.editor && engine.editor.gp) {
        pigCount = engine.editor.gp.pigs ? engine.editor.gp.pigs.length : 0;
      } else if (databus.gameState === 'playing' && engine.playing && engine.playing.gp) {
        pigCount = engine.playing.gp.pigs ? engine.playing.gp.pigs.length : 0;
      }
    } catch (e) { /* ignore */ }
    info.push({ label: '猪数', value: String(pigCount), color: C.valueText });

    // 帧号
    info.push({ label: '帧号', value: String(databus.frame || 0), color: C.valueText });

    // 已上报
    info.push({ label: '已上报', value: String(BugReporter._sessionReportCount || 0), color: C.valueText });

    return info;
  }

  _getButtons() {
    var self = this;
    return [
      {
        label: '📋 查看日志',
        action: function () { self._showLogs = true; self._logScroll = 0; }
      },
      {
        label: '🗑️ 删除档案',
        danger: true,
        action: function () {
          wx.showModal({
            title: '确认删除云端档案？',
            content: '将删除云端所有数据（金币、进度、皮肤），不可恢复。本地数据将被清空。',
            success: function (modalRes) {
              if (modalRes.confirm) {
                cloud.deletePlayerProfile().then(function(delRes) {
                  console.log('[DebugPanel] deletePlayerProfile:', delRes);
                  try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
                  wx.showToast({ title: delRes && delRes.deleted ? '已删除' : '云端无记录', icon: 'success', duration: 1500 });
                }).catch(function(err) {
                  wx.showToast({ title: '删除失败: ' + (err && err.message || '未知'), icon: 'none', duration: 2000 });
                });
              }
            }
          });
        }
      },
      {
        label: '⚠️ 模拟崩溃',
        danger: true,
        action: function () {
          if (self._simCrashCooldown) return;
          self._simCrashCooldown = true;
          setTimeout(function () { self._simCrashCooldown = false; }, 3000);
          throw new Error('[DEBUG] 手动模拟崩溃测试');
        }
      },
      {
        label: '🗑️ 清空缓存',
        danger: true,
        action: function () {
          wx.showModal({
            title: '确认清空？',
            content: '将清除所有本地存储数据（含通关记录），不可恢复。',
            success: function (res) {
              if (res.confirm) {
                try { wx.clearStorageSync(); } catch (e) { /* ignore */ }
                wx.showToast({ title: '已清空', icon: 'success', duration: 1000 });
              }
            }
          });
        }
      }
    ];
  }

  // ========== Canvas 绘图工具 ==========

  _drawRoundRect(x, y, w, h, r, color, strokeOnly) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    if (!strokeOnly) {
      ctx.fillStyle = color;
      ctx.fill();
    }
  }

  _drawRoundRectStroke(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
    ctx.stroke();
  }
}

// 导出单例
module.exports = new DebugPanel();
