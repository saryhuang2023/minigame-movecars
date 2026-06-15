// 云函数：获取玩家数据
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();

  try {
    const res = await db.collection('players')
      .where({ _openid: OPENID })
      .get();

    if (res.data.length > 0) {
      return { code: 0, data: res.data[0] };
    }
    return { code: 0, data: null };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
