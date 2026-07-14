// SkinDefine — 皮肤系统配置与常量

var SKIN = {

  // ---------- 存储 Key ----------
  STORAGE_OWNED: 'player_owned_skins',
  STORAGE_EQUIPPED: 'player_equipped_skin',
  STORAGE_CONFIG_VERSION: 'skin_config_version',

  // ---------- 默认皮肤 ----------
  DEFAULT_SKIN_ID: 0,
  DEFAULT_SKIN: {
    skinId: 0, name: '经典粉', quality: '普通', price: 0, sortOrder: 0
  },

  // ---------- 配置文件路径 ----------
  LOCAL_CONFIG_PATH: 'assets/skins/skinConfig.json',
  CLOUD_CONFIG_PATH: 'skins/skinConfig.json',
  CACHE_CONFIG_FILE: 'skinConfig.json',

  // ---------- 云端路径 ----------
  // 格式: cloud://{env-id}.{dirHash}-{appid}/data/skins/{skinId}/{animType}/{frame}.png
  SKINS_CLOUD_PREFIX: 'cloud://cloud1-4gmoyu9g16089510.636c-cloud1-4gmoyu9g16089510-1316941984/data/skins/',

};

module.exports = { SKIN };
