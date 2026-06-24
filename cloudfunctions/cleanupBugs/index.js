// 云函数：定时清理 Bug 记录
// 触发器：每天凌晨 3:00 自动执行
// 规则：
//   - 已解决 (resolved/ignored) 超过 30 天 → 删除
//   - 未解决 (open/investigating) 超过 60 天 → 删除

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });
const db = cloud.database();
const _ = db.command;

// 时间阈值
const RESOLVED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;   // 30 天
const UNRESOLVED_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;  // 60 天

// 批量删除每批数量（云数据库单次 delete 最多 1000 条）
const BATCH_SIZE = 200;

/**
 * 批量删除符合条件且超过时间阈值的记录
 * @param {Object} whereBase  - 基础筛选条件
 * @param {number} maxAgeMs  - 最大保留时间（毫秒）
 * @param {string} label     - 日志标签
 * @returns {number} 删除数量
 */
async function deleteOldBugs(whereBase, maxAgeMs, label) {
  const cutoff = Date.now() - maxAgeMs;
  let totalDeleted = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      // 查询一批符合条件的记录
      const res = await db.collection('bug_reports')
        .where({
          ...whereBase,
          'meta.timestamp': _.lt(cutoff),
        })
        .limit(BATCH_SIZE)
        .get();

      if (res.data.length === 0) break;

      // 逐条删除
      const deletePromises = res.data.map(doc =>
        db.collection('bug_reports').doc(doc._id).remove()
      );

      await Promise.all(deletePromises);
      totalDeleted += res.data.length;

      console.log(`[cleanupBugs] ${label} 已删除 ${res.data.length} 条（累计 ${totalDeleted}）`);

      // 如果本批不足 BATCH_SIZE，说明已经没有更多了
      if (res.data.length < BATCH_SIZE) break;
    } catch (err) {
      console.error(`[cleanupBugs] ${label} 删除出错:`, err);
      break;
    }
  }

  return totalDeleted;
}

exports.main = async (event, context) => {
  console.log('[cleanupBugs] ========== 开始定时清理 ==========');
  console.log('[cleanupBugs] 触发时间:', new Date().toISOString());
  console.log('[cleanupBugs] 规则: 已解决 > 30天删除 | 未解决 > 60天删除');

  try {
    // 1. 删除已解决/已忽略且超过 30 天的记录
    const resolvedDeleted = await deleteOldBugs(
      { status: _.in(['resolved', 'ignored']) },
      RESOLVED_MAX_AGE_MS,
      '已解决(>30天)'
    );

    // 2. 删除未解决（open/investigating）且超过 60 天的记录
    const unresolvedDeleted = await deleteOldBugs(
      { status: _.in(['open', 'investigating']) },
      UNRESOLVED_MAX_AGE_MS,
      '未解决(>60天)'
    );

    const totalDeleted = resolvedDeleted + unresolvedDeleted;

    console.log(`[cleanupBugs] ========== 清理完成 ==========`);
    console.log(`[cleanupBugs] 已解决删除: ${resolvedDeleted} 条`);
    console.log(`[cleanupBugs] 未解决删除: ${unresolvedDeleted} 条`);
    console.log(`[cleanupBugs] 合计删除: ${totalDeleted} 条`);

    return {
      code: 0,
      msg: 'ok',
      resolvedDeleted,
      unresolvedDeleted,
      totalDeleted,
      timestamp: Date.now(),
    };
  } catch (err) {
    console.error('[cleanupBugs] 清理失败:', err);
    return { code: -1, msg: err.message || '清理失败' };
  }
};
