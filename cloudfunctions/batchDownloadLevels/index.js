// 云函数：批量下载关卡（增量同步 + gzip 压缩打包）
// 客户端传入 versions: { "0001": 3, "0002": 5 }，仅返回版本号有变化的关卡
// 不传 versions 则返回全部（兼容旧客户端）
const cloud = require('wx-server-sdk');
const zlib = require('zlib');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    const { versions } = event;  // optional: { name: localVersion }

    const res = await db.collection('levels')
      .field({ _id: true, name: true, data: true, version: true, published: true, crownSteps: true })
      .limit(500)
      .get();

    if (!res.data || res.data.length === 0) {
      return { ok: true, count: 0, changed: 0, skipped: 0 };
    }

    const localVersions = versions || {};
    const payload = {};
    let skipped = 0;

    for (const level of res.data) {
      const serverVersion = level.version || 1;
      // 增量模式：跳过本地版本 >= 服务端版本的关卡
      if (localVersions[level.name] !== undefined && serverVersion <= localVersions[level.name]) {
        skipped++;
        continue;
      }
      payload[level.name] = {
        data: level.data,
        _id: level._id,
        version: serverVersion,
        published: level.published === true,
        crownSteps: level.crownSteps || 0
      };
    }

    if (Object.keys(payload).length === 0) {
      return { ok: true, count: res.data.length, changed: 0, skipped };
    }

    const jsonStr = JSON.stringify(payload);
    const compressed = zlib.gzipSync(Buffer.from(jsonStr, 'utf-8'));
    const base64 = compressed.toString('base64');

    return {
      ok: true,
      count: res.data.length,
      changed: Object.keys(payload).length,
      skipped,
      base64: base64,
      compressedSize: compressed.length,
      originalSize: Buffer.byteLength(jsonStr, 'utf-8')
    };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
};
