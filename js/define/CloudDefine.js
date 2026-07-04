// CloudDefine — 网络/云端下载配置与常量

var CLOUD = {

  // ---------- 云环境 ----------
  ENV: 'cloud1-4gmoyu9g16089510',

  // ---------- 云存储路径前缀 ----------
  DATA_PREFIX: 'cloud://cloud1-4gmoyu9g16089510.636c-cloud1-4gmoyu9g16089510-1316941984/data/',
  SKINS_PREFIX: 'cloud://cloud1-4gmoyu9g16089510.636c-cloud1-4gmoyu9g16089510-1316941984/data/skins/',
  AUDIO_PREFIX: 'cloud://cloud1-4gmoyu9g16089510.636c-cloud1-4gmoyu9g16089510-1316941984/audio/',

  // ---------- 云函数名 ----------
  FUNC: {
    SAVE_PLAYER: 'savePlayerData',
    GET_PLAYER: 'getPlayerData',
    UPLOAD_LEVEL: 'uploadLevel',
    DOWNLOAD_LEVEL: 'downloadLevel',
    DELETE_LEVEL: 'deleteLevel',
    LIST_LEVELS: 'listLevels',
    REPORT_BUG: 'reportBug',
    GET_LEVEL_INFO: 'getLevelInfo',
    CLAIM_MASTER: 'claimLevelMaster',
    GET_OPENID: 'getOpenId',
    SETTLE_LEVEL: 'settleLevel',
    DELETE_PROFILE: 'deletePlayerProfile',
    GET_ASSET_CONFIG: 'getAssetConfig',
  },

  // ---------- 下载参数 ----------
  DOWNLOAD_CONCURRENCY: 4,       // 同时下载数
  DOWNLOAD_TIMEOUT: 5000,        // 云端拉取超时 ms

};

module.exports = { CLOUD };
