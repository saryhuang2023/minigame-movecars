// 云函数：保存玩家数据（每次保存自增版本号）
// 更新时 version +1（旧存档无 version 则从 1 开始），并把新版本号返回给客户端。
const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { OPENID } = cloud.getWXContext();
  const { data } = event;

  if (!data) {
    return { code: -1, msg: '缺少 data 参数' };
  }

  try {
    // 查找是否已有记录
    const exist = await db.collection('players')
      .where({ _openid: OPENID })
      .get();

    let newVersion;
    if (exist.data.length > 0) {
      // 更新：lastLevelIndex 只升不降（防止客户端 bug 导致进度回退）
      var updateData = { ...data, updatedAt: db.serverDate() };
      var existing = exist.data[0];
      if (typeof existing.lastLevelIndex === 'number' &&
          typeof updateData.lastLevelIndex === 'number' &&
          updateData.lastLevelIndex < existing.lastLevelIndex) {
        updateData.lastLevelIndex = existing.lastLevelIndex;
      }
      // 星级：按关卡 key 取最大值合并（只记录最高星级，防止整 map 覆盖丢失其它关）
      if (data.stars && typeof data.stars === 'object' &&
          existing.stars && typeof existing.stars === 'object') {
        var mergedStars = Object.assign({}, existing.stars);
        Object.keys(data.stars).forEach(function (k) {
          var v = data.stars[k];
          if (typeof v === 'number' && (typeof mergedStars[k] !== 'number' || v > mergedStars[k])) {
            mergedStars[k] = v;
          }
        });
        updateData.stars = mergedStars;
      }
      // 版本号：已有则 +1，旧存档无 version 字段则从 1 开始
      newVersion = (typeof existing.version === 'number') ? existing.version + 1 : 1;
      updateData.version = (typeof existing.version === 'number') ? _.inc(1) : 1;
      await db.collection('players')
        .doc(exist.data[0]._id)
        .update({ data: updateData });
    } else {
      // 新建
      newVersion = 1;
      await db.collection('players').add({
        data: {
          ...data,
          _openid: OPENID,
          version: 1,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate(),
        },
      });
    }

    return { code: 0, msg: 'ok', version: newVersion };
  } catch (err) {
    return { code: -1, msg: err.message };
  }
};
