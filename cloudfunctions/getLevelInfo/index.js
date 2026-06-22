// 查询关卡信息（关主 + 皇冠阈值）
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();

exports.main = async (event, context) => {
  const { levelId } = event;
  if (!levelId) return { code: 1, message: '缺少 levelId' };

  try {
    const res = await db.collection('level_info')
      .where({ levelId })
      .limit(1)
      .get();

    return {
      code: 0,
      data: res.data.length > 0 ? res.data[0] : null
    };
  } catch (err) {
    console.error('[getLevelInfo]', err);
    return { code: 2, message: err.message };
  }
};
