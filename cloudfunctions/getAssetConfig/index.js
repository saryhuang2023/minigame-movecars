// 云函数：获取资源文件版本号（按文件名独立管理）
// 客户端传入 files: ["skins/rock/idle/1.png", ...]
// 返回 { versions: { "文件名": version } }
// 如果文件未在数据库注册，自动创建记录 version=1
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    const { files } = event;
    if (!files || !Array.isArray(files) || files.length === 0) {
      return { code: 0, data: { versions: {} } };
    }

    const COLL = 'config';
    const DOC_ID = 'asset_versions';
    const docRef = db.collection(COLL).doc(DOC_ID);

    // 读取现有版本记录
    let doc;
    try {
      const res = await docRef.get();
      doc = res.data;
    } catch (e) {
      doc = null;
    }

    var versions = (doc && doc.versions) ? doc.versions : {};
    const result = {};
    let updated = false;

    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      if (versions[f] != null) {
        result[f] = versions[f];
      } else {
        // 新文件 → 注册 version=1
        versions[f] = 1;
        result[f] = 1;
        updated = true;
      }
    }

    // 有新文件 → 写回数据库
    if (updated) {
      try {
        if (doc) {
          await docRef.update({ data: { versions: versions } });
        } else {
          await docRef.set({ data: { versions: versions } });
        }
      } catch (e) {
        // 写入失败不影响查询结果（下次重试即可）
        console.warn('getAssetConfig: 写入新文件版本失败', e.message);
      }
    }

    return { code: 0, data: { versions: result } };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
