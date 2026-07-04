// 金币系统 — 纯逻辑模块
// 管理金币余额的本地读写、计算和云端同步

var GameDefine = require('../define/GameDefine.js');
var SK = GameDefine.GAME.STORAGE_KEYS;

var STORAGE_KEY = SK.GOLD;
var CLAIMED_KEY = SK.GOLD_CLAIMED;  // 已领取金币的关卡 ID 数组

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

  /** 直接设值金币（服务器权威覆盖） */
  setGold: function (amount) {
    var n = Math.max(0, parseInt(amount, 10) || 0);
    try {
      wx.setStorageSync(STORAGE_KEY, n);
    } catch (e) {
      console.warn('[LOG] GoldSystem.setGold 写入失败:', e);
    }
    return n;
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

  // ========== 领取记录管理（goldClaimedLevels 数组） ==========

  /** 获取已领取金币的关卡 ID 列表 */
  getClaimedLevels: function () {
    try {
      var val = wx.getStorageSync(CLAIMED_KEY);
      if (val && typeof val === 'string') {
        // 兼容 JSON 字符串存储
        var arr = JSON.parse(val);
        return Array.isArray(arr) ? arr : [];
      }
      return Array.isArray(val) ? val : [];
    } catch (e) {
      return [];
    }
  },

  /** 检查关卡是否已领取金币（新 key 优先，兜底旧 first_gold_XXX） */
  isSettled: function (levelId) {
    var claimed = this.getClaimedLevels();
    if (claimed.indexOf(levelId) !== -1) return true;
    // 兼容旧版 first_gold_XXX 标记
    try {
      var v = wx.getStorageSync(SK.FIRST_GOLD_PREFIX + levelId);
      if (v) return true;
    } catch (e) {}
    return false;
  },

  /** 标记关卡已领取金币 */
  markSettled: function (levelId) {
    var claimed = this.getClaimedLevels();
    if (claimed.indexOf(levelId) === -1) {
      claimed.push(levelId);
      try {
        wx.setStorageSync(CLAIMED_KEY, claimed);
      } catch (e) {
        console.warn('[LOG] GoldSystem.markSettled 写入失败:', e);
      }
    }
  },

  /** 收集领取记录数组（供云端同步用） */
  collectClaimHistory: function () {
    return this.getClaimedLevels();
  },

  /** 从云端还原领取记录（覆盖本地） */
  restoreClaimHistory: function (levels) {
    if (!Array.isArray(levels) || levels.length === 0) return;
    try {
      wx.setStorageSync(CLAIMED_KEY, levels);
      console.log('[LOG] GoldSystem 还原领取记录: ' + levels.length + ' 条');
    } catch (e) {
      console.warn('[LOG] GoldSystem.restoreClaimHistory 写入失败:', e);
    }
  },

  /**
   * 计算通关金币奖励 = 该关卡的小猪数量
   * @param {number} pigCount - 关卡的小猪数量
   * @returns {number} 金币数量
   */
  calculateReward: function (pigCount) {
    return Math.max(0, pigCount || 0);
  },

  /**
   * 检查是否为首次通关（未曾获得过该关卡的金币奖励）
   * @param {string} levelName - 关卡名
   * @returns {boolean}
   * @deprecated 使用 isSettled 替代
   */
  isFirstGoldClear: function (levelName) {
    return !this.isSettled(levelName);
  },

  /**
   * 标记该关卡已领取过金币奖励（防止重复领取）
   * @param {string} levelName - 关卡名
   * @deprecated 使用 markSettled 替代
   */
  markGoldClaimed: function (levelName) {
    this.markSettled(levelName);
  },
};

module.exports = GoldSystem;
