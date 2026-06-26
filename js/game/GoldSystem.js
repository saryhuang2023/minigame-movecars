// 金币系统 — 纯逻辑模块
// 管理金币余额的本地读写、计算和云端同步

const STORAGE_KEY = 'player_gold';

var GoldSystem = {
  _chapters: null,  // 章节数据引用（setChapters 注入）

  /** 注入章节数据（云端优先，本地兜底） */
  setChapters: function (chapters) {
    if (chapters && Array.isArray(chapters)) {
      this._chapters = chapters;
    }
  },

  /** 获取当前金币余额（本地） */
  getGold: function () {
    try {
      var val = wx.getStorageSync(STORAGE_KEY);
      if (val !== '' && val !== undefined && val !== null) {
        var n = parseInt(val, 10);
        return isNaN(n) ? 0 : Math.max(0, n);
      }
    } catch (e) {}
    return 0;
  },

  /** 增加金币（返回增加后的余额） */
  addGold: function (amount) {
    var current = this.getGold();
    var newGold = Math.max(0, current + amount);
    try {
      wx.setStorageSync(STORAGE_KEY, newGold);
    } catch (e) {
      console.warn('[LOG] GoldSystem.addGold 写入失败:', e);
    }
    return newGold;
  },

  /** 从云端数据合并金币（取较大值） */
  mergeFromCloud: function (cloudGold) {
    if (typeof cloudGold !== 'number' || cloudGold <= 0) return this.getGold();
    var local = this.getGold();
    if (cloudGold > local) {
      try {
        wx.setStorageSync(STORAGE_KEY, cloudGold);
      } catch (e) {}
      console.log('[LOG] GoldSystem 云端金币合并: ' + local + ' → ' + cloudGold);
      return cloudGold;
    }
    return local;
  },

  /**
   * 查找 levelIndex 所在的章节
   * @param {number} levelIndex - 关卡全局索引
   * @returns {Object|null} 章节对象
   */
  _findChapter: function (levelIndex) {
    var chapters = this._chapters;
    if (!chapters || chapters.length === 0) return null;
    var start = 0;
    for (var i = 0; i < chapters.length; i++) {
      var end = chapters[i].endIndex;
      if (levelIndex >= start && levelIndex <= end) {
        return chapters[i];
      }
      start = end + 1;
    }
    return null;
  },

  /**
   * 计算通关金币奖励
   * @param {number} levelIndex - 关卡全局索引
   * @returns {number} 金币数量（章节数据缺失时返回 0 并上报异常）
   */
  calculateReward: function (levelIndex) {
    var chapter = this._findChapter(levelIndex);
    if (!chapter) {
      console.error('[LOG] GoldSystem.calculateReward 无法定位章节: levelIndex=' + levelIndex + ' chapters=' + (this._chapters ? this._chapters.length : 'null'));
      return 0;
    }
    if (typeof chapter.goldBase !== 'number' || chapter.goldBase <= 0) {
      console.error('[LOG] GoldSystem.calculateReward 章节缺少 goldBase: levelIndex=' + levelIndex + ' chapter=' + (chapter.name || 'unknown') + ' goldBase=' + chapter.goldBase);
      return 0;
    }
    var base = chapter.goldBase;
    var ratio = 0.9 + Math.random() * 0.2;   // 0.9 ~ 1.1
    return Math.round(base * ratio);
  },

  /**
   * 检查是否为首次通关（未曾获得过该关卡的金币奖励）
   * @param {string} levelName - 关卡名
   * @returns {boolean}
   */
  isFirstGoldClear: function (levelName) {
    var key = 'first_gold_' + levelName;
    try {
      var v = wx.getStorageSync(key);
      return !v;  // 不存在或空字符串 → 首次
    } catch (e) {
      return true;
    }
  },

  /**
   * 标记该关卡已领取过金币奖励（防止重复领取）
   * @param {string} levelName - 关卡名
   */
  markGoldClaimed: function (levelName) {
    var key = 'first_gold_' + levelName;
    try {
      wx.setStorageSync(key, true);
    } catch (e) {}
  },
};

module.exports = GoldSystem;
