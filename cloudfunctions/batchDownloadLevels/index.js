// 云函数：批量下载所有关卡（gzip 压缩打包，大幅降低传输数据量）
const cloud = require('wx-server-sdk');
const zlib = require('zlib');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    const res = await db.collection('levels')
      .field({ _id: true, name: true, data: true, version: true, published: true, crownSteps: true })
      .limit(500)
      .get();

    if (!res.data || res.data.length === 0) {
      return { ok: true, count: 0 };
    }

    const payload = {};
    for (const level of res.data) {
      payload[level.name] = {
        data: level.data,
        _id: level._id,
        version: level.version || 1,
        published: level.published === true,
        crownSteps: level.crownSteps || 0
      };
    }

    const jsonStr = JSON.stringify(payload);
    const compressed = zlib.gzipSync(Buffer.from(jsonStr, 'utf-8'));
    const base64 = compressed.toString('base64');

    return {
      ok: true,
      count: res.data.length,
      base64: base64,
      compressedSize: compressed.length,
      originalSize: Buffer.byteLength(jsonStr, 'utf-8')
    };
  } catch (err) {
    return { ok: false, msg: err.message };
  }
};
