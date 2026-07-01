// SkinLoader — 皮肤资源路径与帧数查询
// 依赖 EntityTypes.module，接口层不做路径拼接暴露给调用方

var SKIN_BASE = 'assets/skins/';

var _configs = {};  // { skinId: skinJson }
var _cloudCache = null;  // { 'skins/rock/idle/1.png': 'wxfile://tmp_xxx.png' } — LoadingManager 注入

/** 同步读取本地 skin.json（游戏启动时调用，无异步真空期） */
function loadSkinConfig(skinId) {
  // skin.json 在 assets/skins/ 根目录，不在 {skinId}/ 下
  var path = SKIN_BASE + 'skin.json';
  try {
    var raw = wx.getFileSystemManager().readFileSync(path, 'utf8');
    var data = JSON.parse(raw);
    // 解析所有皮肤配置：key → { anim: frameCount }
    _configs[skinId] = data;
    console.log('[SkinLoader] 加载皮肤配置: path=' + path + ' keys=' + Object.keys(data).join(','));
  } catch (e) {
    console.error('[SkinLoader] 读取 skin.json 失败 path=' + path + ':', e && e.message);
    _configs[skinId] = {};
  }
}

/** 获取某精灵某动作的帧数 */
function getAnimFrameCount(skinId, entityKey, anim) {
  if (entityKey === 'rock') {
    var cfg0 = _configs[0];
    if (cfg0 && cfg0.rock) return cfg0.rock[anim] || 1;
    return 1;
  }
  var cfg = _configs[skinId];
  var result = 1;
  if (cfg) {
    var typeCfg = cfg[entityKey];
    if (typeCfg) {
      result = typeCfg[anim] || 1;
    }
  }
  if (_animLogOnce) {
    _animLogOnce = false;
    console.log('[LOG_load] getAnimFrameCount skinId=' + skinId + ' key=' + entityKey + ' anim=' + anim + ' → ' + result + ' (cfg=' + !!cfg + ')');
  }
  return Math.max(1, result);
}
var _animLogOnce = true;  // 首次打印后置 false

/** 获取图片路径
 *  pig_0 → assets/skins/0/{anim}/{frame}.png
 *  rock  → assets/skins/rock/{anim}/{frame}.png
 */
function getSkinFramePath(skinId, entityKey, anim, frame) {
  var dirKey = (entityKey === 'rock') ? 'rock' : String(skinId);
  return SKIN_BASE + dirKey + '/' + anim + '/' + frame + '.png';
}

/** LoadingManager 下载完成后注入云端图片缓存 */
function setCloudCache(cache) {
  _cloudCache = cache;
  if (cache) {
    console.log('[SkinLoader] 云端缓存已注入: ' + Object.keys(cache).join(', '));
  }
}

/** rock 图片路径：优先云端缓存，不可用时回退本地 */
function getRockImagePath(anim) {
  var cloudKey = 'skins/rock/' + anim + '/1.png';
  if (_cloudCache && _cloudCache[cloudKey]) {
    return _cloudCache[cloudKey];
  }
  // 兜底：本地路径
  return SKIN_BASE + 'rock/' + anim + '/1.png';
}

module.exports = {
  loadSkinConfig: loadSkinConfig,
  getAnimFrameCount: getAnimFrameCount,
  getSkinFramePath: getSkinFramePath,
  setCloudCache: setCloudCache,
  getRockImagePath: getRockImagePath,
};
