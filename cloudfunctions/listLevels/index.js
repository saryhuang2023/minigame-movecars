// 云函数：列出全部关卡（仅元数据，所有用户共享）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  try {
    const res = await db.collection('levels')
      .field({ _id: true, name: true, version: true })
      .orderBy('name', 'asc')
      .limit(500)
      .get();
    return { code: 0, data: res.data };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
