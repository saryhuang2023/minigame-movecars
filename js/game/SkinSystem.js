// 皮肤系统 — 纯逻辑模块
// 管理皮肤配置（三层加载）、持有、装备、购买和云端同步
// skinId=0 默认本地猪，1+ 云端按需下载
// 参照 GoldSystem.js 模式

var GoldSystem = require('./GoldSystem');
var cloud = require('../cloud.js');

const STORAGE_OWNED = 'player_owned_skins';
const STORAGE_EQUIPPED = 'player_equipped_skin';
const STORAGE_CONFIG_VERSION = 'skin_config_version';
const DEFAULT_SKIN_ID = 0;

// 云端皮肤图片路径前缀（代码写死，不存数据库 — v120 设计决策）
// 格式: cloud://{env-id}.{dirHash}-{appid}/data/skins/{skinId}/{animType}/{frame}.png
const CLOUD_SKINS_PREFIX = 'cloud://cloud1-4gmoyu9g16089510.636c-cloud1-4gmoyu9g16089510-1316941984/data/skins/';

// 配置文件路径
const LOCAL_CONFIG_PATH = 'assets/skins/skinConfig.json';
const CLOUD_CONFIG_PATH = 'skins/skinConfig.json';
const CACHE_CONFIG_FILE = 'skinConfig.json';

// 皮肤配置缓存
var _skinsConfig = null;
var _configVersion = 0;

// 配置更新回调（云端配置到达时触发）
var _onConfigUpdated = null;

// 章节配置缓存（懒加载，读取后常驻）
var _chaptersCache = null;

// 小金猪计数缓存
var _goldenPigsCache = { count: -1, timestamp: 0 };
var GOLDEN_PIGS_CACHE_TTL = 2000;

var SkinSystem = {
  DEFAULT_SKIN_ID: DEFAULT_SKIN_ID,

  // ---- 路径工具 ----

  /** 获取云存储皮肤路径前缀 */
  getCloudPrefix: function () {
    return CLOUD_SKINS_PREFIX;
  },

  /** 构造皮肤帧的 cloud:// URL（skinId=0 返回 null，走本地） */
  skinFrameUrl: function (skinId, animType, frame) {
    if (skinId === 0) return null;
    return CLOUD_SKINS_PREFIX + skinId + '/' + animType + '/' + frame + '.png';
  },

  /** 构造皮肤预览图的 cloud:// URL */
  skinPreviewUrl: function (skinId) {
    if (skinId === 0) return null;
    return CLOUD_SKINS_PREFIX + skinId + '/preview.png';
  },

  // ---- 配置加载（三层：本地打包 → 本地缓存 → 云端热更新）----

  /**
   * 加载皮肤配置
   * 1. 同步读取本地打包的 assets/skins/skinConfig.json（阻塞，保证立即可用）
   * 2. 异步拉取云端 data/skins/skinConfig.json（fire-and-forget，不阻塞启动）
   * 3. 云端版本号 > 缓存版本号 → 写入 USER_DATA_PATH 缓存 + 触发回调
   * @param {Function} [onUpdatedCallback] 云端配置到达时的回调
   */
  loadConfig: function (onUpdatedCallback) {
    _onConfigUpdated = onUpdatedCallback || null;

    // Step 1: 同步加载本地打包配置
    this._loadLocalConfigSync();

    // Step 2: 异步拉取云端配置
    this._loadCloudConfigAsync();
  },

  /** 同步读取本地打包的 skinConfig.json */
  _loadLocalConfigSync: function () {
    try {
      var fs = wx.getFileSystemManager();
      var raw = fs.readFileSync(LOCAL_CONFIG_PATH, 'utf8');
      var config = JSON.parse(raw);
      this._applyConfig(config);
      console.log('[LOG] SkinSystem 本地配置加载成功: version=' + config.version + ', ' + config.skins.length + ' 个皮肤');
    } catch (e) {
      console.warn('[LOG] SkinSystem 本地配置加载失败:', (e && e.message) || String(e));
      // 兜底：空配置，皮肤不会出现在商城中但不会崩溃
      _skinsConfig = [];
      _configVersion = 0;
    }
  },

  /** 异步拉取云端配置 + 版本比较 + 缓存写入 */
  _loadCloudConfigAsync: async function () {
    var self = this;
    try {
      // 读取缓存版本号
      var cachedVersion = self._getCachedVersion();

      // 下载云端配置
      var cloudConfig = await cloud.downloadCloudFile(CLOUD_CONFIG_PATH);
      if (!cloudConfig || typeof cloudConfig.version !== 'number') {
        // 云端拉取失败，尝试用缓存兜底
        if (cachedVersion > _configVersion) {
          self._loadCachedConfig();
        }
        return;
      }

      // 版本号比较：云端必须严格大于缓存才更新
      if (cloudConfig.version <= cachedVersion) {
        return;
      }

      console.log('[LOG] SkinSystem 云端配置更新: version ' + cachedVersion + ' → ' + cloudConfig.version);

      // 写入本地文件缓存
      self._cacheConfig(cloudConfig);

      // 应用配置
      self._applyConfig(cloudConfig);

      // 触发回调（如 ShopPanel 已打开则刷新）
      if (typeof _onConfigUpdated === 'function') {
        try {
          _onConfigUpdated();
        } catch (e) {
          console.warn('[LOG] SkinSystem onConfigUpdated 回调异常:', e);
        }
      }
    } catch (e) {
      // 默默失败，不提示用户
      console.warn('[LOG] SkinSystem 云端配置拉取异常:', (e && e.message) || String(e));
      if (cachedVersion > _configVersion) {
        self._loadCachedConfig();
      }
    }
  },

  /** 应用配置到内存（排序） */
  _applyConfig: function (config) {
    if (!config || !Array.isArray(config.skins)) return;
    _configVersion = config.version || 0;
    _skinsConfig = config.skins.slice().sort(function (a, b) {
      return (a.sortOrder || 0) - (b.sortOrder || 0);
    });
  },

  /** 读取缓存的版本号 */
  _getCachedVersion: function () {
    try {
      var v = wx.getStorageSync(STORAGE_CONFIG_VERSION);
      return parseInt(v, 10) || 0;
    } catch (e) { return 0; }
  },

  /** 写入版本号 */
  _setCachedVersion: function (version) {
    try {
      wx.setStorageSync(STORAGE_CONFIG_VERSION, version);
    } catch (e) { /* ignore */ }
  },

  /** 将配置写入 USER_DATA_PATH 文件缓存 */
  _cacheConfig: function (config) {
    try {
      var fs = wx.getFileSystemManager();
      var path = wx.env.USER_DATA_PATH + '/' + CACHE_CONFIG_FILE;
      fs.writeFileSync(path, JSON.stringify(config), 'utf8');
      this._setCachedVersion(config.version);
    } catch (e) {
      console.warn('[LOG] SkinSystem 配置缓存写入失败:', (e && e.message) || String(e));
    }
  },

  /** 从 USER_DATA_PATH 读取缓存的配置 */
  _loadCachedConfig: function () {
    try {
      var fs = wx.getFileSystemManager();
      var path = wx.env.USER_DATA_PATH + '/' + CACHE_CONFIG_FILE;
      var raw = fs.readFileSync(path, 'utf8');
      var config = JSON.parse(raw);
      this._applyConfig(config);
      console.log('[LOG] SkinSystem 缓存配置加载成功: version=' + config.version);
    } catch (e) {
      console.warn('[LOG] SkinSystem 缓存配置读取失败:', (e && e.message) || String(e));
    }
  },

  // ---- 配置查询 ----

  /** 获取全部皮肤配置（默认猪 skinId=0 始终排首位） */
  getAllSkins: function () {
    var list = _skinsConfig || [];
    // 默认猪硬编码（不在 skinConfig.json 中）
    var defaultSkin = { skinId: 0, name: '经典粉', quality: '普通', price: 0, sortOrder: 0, unlockCondition: {} };
    return [defaultSkin].concat(list);
  },

  /** 获取单个皮肤配置 */
  getSkin: function (skinId) {
    if (skinId === 0) return { skinId: 0, name: '经典粉', quality: '普通', price: 0, sortOrder: 0, unlockCondition: {} };
    if (!_skinsConfig) return null;
    for (var i = 0; i < _skinsConfig.length; i++) {
      if (_skinsConfig[i].skinId === skinId) return _skinsConfig[i];
    }
    return null;
  },

  // ---- 解锁条件求值 ----

  /**
   * 检查皮肤是否已解锁
   * skinId=0 始终解锁；其他皮肤根据 unlockCondition 求值
   * @param {number} skinId
   * @returns {boolean}
   */
  isUnlocked: function (skinId) {
    if (skinId === 0) return true;
    var skin = this.getSkin(skinId);
    if (!skin) return false;
    return this.evaluateCondition(skin.unlockCondition);
  },

  /**
   * 求值解锁条件对象
   * 多字段 AND 语义：所有条件必须同时满足
   * 空对象 / undefined / null → 永久解锁
   * @param {object|undefined} condition
   * @returns {boolean}
   */
  evaluateCondition: function (condition) {
    // 无条件 → 永久解锁
    if (!condition || typeof condition !== 'object' || Object.keys(condition).length === 0) {
      return true;
    }

    var allPassed = true;

    // chapterCleared: 玩家已通关指定章节
    if (condition.chapterCleared !== undefined) {
      var chapters = this._getChapters();
      var targetChapter = condition.chapterCleared;
      if (chapters.length > targetChapter) {
        var endIndex = chapters[targetChapter].endIndex;
        var lastLevelIndex = parseInt(wx.getStorageSync('lastLevelIndex'), 10) || 0;
        if (lastLevelIndex < endIndex) allPassed = false;
      } else {
        allPassed = false;
      }
    }

    // levelReached: 玩家已解锁指定关卡索引
    if (allPassed && condition.levelReached !== undefined) {
      var lastLevelIndex = parseInt(wx.getStorageSync('lastLevelIndex'), 10) || 0;
      if (lastLevelIndex < condition.levelReached) allPassed = false;
    }

    // goldenPigs: 玩家已收集至少 N 个小金猪
    if (allPassed && condition.goldenPigs !== undefined) {
      var pigCount = this._countGoldenPigs();
      if (pigCount < condition.goldenPigs) allPassed = false;
    }

    // ownsSkin: 玩家必须拥有指定皮肤
    if (allPassed && condition.ownsSkin !== undefined) {
      if (!this.isOwned(condition.ownsSkin)) allPassed = false;
    }

    return allPassed;
  },

  /** 懒加载章节配置 */
  _getChapters: function () {
    if (_chaptersCache) return _chaptersCache;
    try {
      var fs = wx.getFileSystemManager();
      var raw = fs.readFileSync('assets/levels/chapter.json', 'utf8');
      _chaptersCache = JSON.parse(raw);
    } catch (e) {
      console.warn('[LOG] SkinSystem 读取 chapter.json 失败:', (e && e.message) || String(e));
      _chaptersCache = [];
    }
    return _chaptersCache;
  },

  /** 统计已获得的小金猪数量（短期缓存，2 秒 TTL） */
  _countGoldenPigs: function () {
    var now = Date.now();
    if (_goldenPigsCache.count >= 0 && (now - _goldenPigsCache.timestamp) < GOLDEN_PIGS_CACHE_TTL) {
      return _goldenPigsCache.count;
    }
    try {
      var info = wx.getStorageInfoSync();
      var keys = info.keys || [];
      var count = 0;
      for (var i = 0; i < keys.length; i++) {
        if (keys[i].indexOf('crown_') === 0) count++;
      }
      _goldenPigsCache = { count: count, timestamp: now };
      return count;
    } catch (e) { return 0; }
  },

  // ---- 装备管理 ----

  /** 获取当前装备的皮肤 ID（缺省 0） */
  getEquippedSkinId: function () {
    try {
      var v = wx.getStorageSync(STORAGE_EQUIPPED);
      if (v !== '' && v !== undefined && v !== null) {
        var n = parseInt(v, 10);
        return isNaN(n) ? DEFAULT_SKIN_ID : n;
      }
    } catch (e) { /* ignore */ }
    return DEFAULT_SKIN_ID;
  },

  /**
   * 装备指定皮肤
   * @param {number} skinId
   * @returns {boolean} 是否装备成功
   */
  equipSkin: function (skinId) {
    if (skinId !== 0 && !this.isOwned(skinId)) return false;
    try {
      wx.setStorageSync(STORAGE_EQUIPPED, skinId);
    } catch (e) {
      console.warn('[LOG] SkinSystem.equipSkin 写入失败:', e);
      return false;
    }
    return true;
  },

  // ---- 拥有管理 ----

  /**
   * 获取已拥有的商城皮肤 ID 列表（不含 skinId=0）
   * @returns {number[]}
   */
  getOwnedSkinIds: function () {
    try {
      var raw = wx.getStorageSync(STORAGE_OWNED);
      if (raw && typeof raw === 'string' && raw.length > 0) {
        return raw.split(',')
          .map(function (id) { return parseInt(id, 10); })
          .filter(function (id) { return id > 0 && !isNaN(id); });
      }
    } catch (e) { /* ignore */ }
    return [];
  },

  /**
   * 是否已拥有该皮肤（skinId=0 始终返回 true）
   * @param {number} skinId
   * @returns {boolean}
   */
  isOwned: function (skinId) {
    if (skinId === 0) return true;
    var owned = this.getOwnedSkinIds();
    return owned.indexOf(skinId) >= 0;
  },

  /**
   * 添加拥有（购买/解锁后调用，skinId=0 无操作）
   * @param {number} skinId
   */
  addOwnedSkin: function (skinId) {
    if (skinId === 0) return;
    var owned = this.getOwnedSkinIds();
    if (owned.indexOf(skinId) >= 0) return; // 已拥有
    owned.push(skinId);
    try {
      wx.setStorageSync(STORAGE_OWNED, owned.join(','));
    } catch (e) {
      console.warn('[LOG] SkinSystem.addOwnedSkin 写入失败:', e);
    }
  },

  // ---- 购买 ----

  /**
   * 检查是否可以购买（需已解锁、未拥有、金币够）
   * @param {number} skinId
   * @returns {boolean}
   */
  canBuy: function (skinId) {
    var skin = this.getSkin(skinId);
    if (!skin || skin.price <= 0) return false;
    if (!this.isUnlocked(skinId)) return false;
    if (this.isOwned(skinId)) return false;
    return GoldSystem.getGold() >= skin.price;
  },

  /**
   * 购买皮肤（扣金币 + 记拥有，不自动装备）
   * @param {number} skinId
   * @returns {{ok: boolean, skinName?: string, reason?: string}}
   */
  buySkin: function (skinId) {
    var skin = this.getSkin(skinId);
    if (!skin) return { ok: false, reason: 'skin_not_found' };
    if (this.isOwned(skinId)) return { ok: false, reason: 'already_owned' };
    if (GoldSystem.getGold() < skin.price) return { ok: false, reason: 'not_enough_gold' };

    GoldSystem.addGold(-skin.price);
    this.addOwnedSkin(skinId);
    return { ok: true, skinName: skin.name };
  },

  // ---- 云端同步 ----

  /**
   * 获取云端同步状态（供 savePlayerData 推送）
   * @returns {{owned: number[], equipped: number}}
   */
  getCloudState: function () {
    return {
      owned: this.getOwnedSkinIds(),
      equipped: this.getEquippedSkinId()
    };
  },

  /**
   * 云端合并（云端优先覆盖本地）
   * @param {{owned?: number[], equipped?: number}} data
   */
  mergeFromCloud: function (data) {
    if (!data || typeof data !== 'object') return;

    // 合并拥有的皮肤（云端有而本地没有的，补到本地）
    if (Array.isArray(data.owned)) {
      var localOwned = this.getOwnedSkinIds();
      var changed = false;
      for (var i = 0; i < data.owned.length; i++) {
        var sid = data.owned[i];
        if (sid > 0 && localOwned.indexOf(sid) < 0) {
          localOwned.push(sid);
          changed = true;
        }
      }
      if (changed) {
        try {
          wx.setStorageSync(STORAGE_OWNED, localOwned.join(','));
        } catch (e) {
          console.warn('[LOG] SkinSystem.mergeFromCloud owned 写入失败:', e);
        }
      }
    }

    // 装备皮肤：云端覆盖本地
    if (typeof data.equipped === 'number') {
      try {
        wx.setStorageSync(STORAGE_EQUIPPED, data.equipped);
      } catch (e) {
        console.warn('[LOG] SkinSystem.mergeFromCloud equipped 写入失败:', e);
      }
    }
  }
};

module.exports = SkinSystem;
