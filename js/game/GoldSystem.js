// 金币系统 — 纯逻辑模块
// 管理金币余额的本地读写、计算和云端同步

var GameDefine = require('../define/GameDefine.js');
var SK = GameDefine.GAME.STORAGE_KEYS;

var STORAGE_KEY = SK.GOLD;

var GoldSystem = {
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
      console.log('[cloud][Gold] GoldSystem 云端金币合并: ' + local + ' → ' + cloudGold);
      return cloudGold;
    }
    return local;
  },

  /**
   * 计算通关金币奖励 = 该关卡的小猪数量
   * @param {number} pigCount - 关卡的小猪数量
   * @returns {number} 金币数量
   */
  calculateReward: function (pigCount) {
    return Math.max(0, pigCount || 0);
  },
};

module.exports = GoldSystem;
