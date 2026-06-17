// 云函数：列出当前用户所有关卡（仅元数据）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  try {
    const res = await db.collection('levels')
      .where({ _openid: OPENID })
      .field({ _id: true, name: true, pigCount: true, version: true, updatedAt: true })
      .orderBy('name', 'asc')
      .get();
    return { code: 0, data: res.data };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
