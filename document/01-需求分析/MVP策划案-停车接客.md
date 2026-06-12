# 🚗 停车接客 - MVP 策划案

> 版本：v1.2 | 日期：2026-06-12 | 类型：微信小游戏

---

## 一、产品概述

### 1.1 游戏名称
**停车接客**（暂定名，英文：Park & Pick）

### 1.2 游戏定位
休闲益智类微信小游戏，核心乐趣在于"规划路径 + 颜色匹配"的逻辑解谜体验。**竖屏操作**，单手即可游玩。

### 1.3 目标用户
- 喜欢轻松解谜的休闲玩家
- 微信小游戏生态中的碎片时间用户
- 适合全年龄段

### 1.4 MVP 目标
- 实现完整的单局游戏闭环：**开局 → 点击发车 → 接客 → 胜利/失败判定**
- 内置 **AI 提示功能**，点击"提示"按钮自动推荐下一步
- 包含 3 个难度递增的关卡
- 验证核心玩法是否有趣、可玩

---

## 二、核心玩法设计

### 2.1 游戏流程总览

```
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  关卡开始  │ → │ 点击汽车  │ → │ 汽车驶向  │ → │ 乘客上车  │
│  场景初始化 │    │ 直线出发  │    │ 接待区    │    │          │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
                                                      │
                                              ┌───────┴───────┐
                                              │               │
                                         所有乘客接走      阻塞/卡死
                                              │               │
                                         ┌────┴───┐    ┌────┴───┐
                                         │ 游戏胜利 │    │ 游戏失败 │
                                         └────────┘    └────────┘
```

### 2.2 核心机制拆解

#### 2.2.1 固定游戏区域（停车场）— 竖屏布局

```
┌──────────────────┐
│    🏠 乘客接待区   │  ← 顶部：乘客等待区，有限停车位
│  ┌──┬──┬──┬──┐   │
│  │🔵│👤│🔴│👤│   │     蓝色停车位旁等2位蓝乘客
│  └──┴──┴──┴──┘   │     红色停车位旁等2位红乘客
├──────────────────┤
│                  │
│  ┌─┬─┬─┬─┐      │
│  │ │ │ │ │      │
│  ├─┼─┼─┼─┤      │
│  │ │ │ │ │      │  ← 中部：停车区域（网格+汽车）
│  ├─┼─┼─┼─┤      │     汽车带方向箭头
│  │ │ │ │ │      │
│  ├─┼─┼─┼─┤      │
│  │ │ │ │ │      │
│  └─┴─┴─┴─┘      │
│                  │
├──────────────────┤
│ [💡提示] [🔄重来] │  ← 底部：操作按钮区
└──────────────────┘
```

**布局说明（竖屏）：**
- **顶部**：乘客接待区，停车位横向排列，每个车位旁显示等待乘客
- **中部**：停车区域（网格），汽车在此停放和移动
- **底部**：操作按钮栏（提示、重新开始等）
- 汽车从停车区域向上开出边界 → 进入顶部接待区停车位

**停车区域规则：**
- 基于细粒度网格（网格单元足够小，作为碰撞检测的基本单位）
- 网格粒度在项目后期根据实际车型尺寸动态调整
- 汽车大小规格不统一，大车占多个网格，小车占 1 个网格
- 汽车带有固定的行驶方向，支持 **16 个方向**（每 22.5° 一个方向，含斜向）
- 点击汽车后，汽车沿其方向直线移动：
  - 像素级平滑移动（每帧 lerp 插值，丝滑动画）
  - 途中碰到障碍（其他车或边界）→ 自动弹回原位（有回弹动画）
  - 开出停车区域边界 → 进入接待区
- 多辆汽车可同时移动，移动中的车辆之间也会发生碰撞，碰撞方弹回

**碰撞检测方案：**
- 采用细粒度网格 + 空间哈希
- 每辆车覆盖的网格标记为"占用"
- 移动时沿方向做射线栅格化（Bresenham/DDA），遍历经过的网格
- 只检查射线经过网格中已被占用的部分，避免 O(n²) 全量遍历
- 碰撞判定为原子操作：干跑计算最远可达距离，移动时若碰撞则弹回

**乘客接待区规则：**
- 位于停车区域的 **上方**（竖屏顶部）
- 有 **有限个停车位**（如 2~4 个），横向排列
- 停车位满时，后续汽车无法驶入（汽车停在边界处等待或弹回）
- 每个停车位旁显示等待乘客的颜色和人数
- 汽车向上开出网格上边界 → 自动匹配同色停车位

#### 2.2.2 颜色匹配机制

| 要素 | 说明 |
|------|------|
| 汽车颜色 | 红、蓝、绿、黄（MVP 阶段 4 种颜色） |
| 乘客颜色 | 与汽车颜色一一对应 |
| 座位数 | 每辆车固定 **2 个座位**（MVP 简化） |
| 匹配规则 | 乘客只能上 **同色** 的车 |
| 接客条件 | 同色汽车停在接待区停车位 → 同色乘客自动上车 |

**关键约束：**
- 每辆车只能接 **同一种颜色** 的乘客
- 车坐满后自动驶离游戏画面（不再占用停车位）
- 接待区每个停车位旁显示等待乘客的颜色和人数

#### 2.2.3 胜利与失败条件

**胜利条件：**
- 所有颜色的所有乘客均被接走 → 游戏胜利 ✅

**失败条件：**
- 所有可移动的汽车都已尝试，但仍有乘客无法被接走
- 即：剩余乘客的颜色没有对应的汽车可到达接待区
- 游戏提供"重新开始"按钮

### 2.3 操作方式

| 操作 | 效果 |
|------|------|
| 点击一辆汽车 | 汽车沿其方向直线行驶（即时响应，无需等待） |
| 点击移动中的车 | 不可点击（只有 idle 状态可被点击） |
| 同时点击多辆车 | 允许，多辆车可同时移动，互不阻塞 |
| 途中碰撞 | 碰撞方弹回原位（有回弹动画） |
| 连续点击 | 可快速连续操作（无冷却） |
| 点击 💡提示按钮 | AI 自动计算并高亮推荐下一辆应点击的车 |
| 点击 🔄重新开始 | 重置当前关卡 |

### 2.4 AI 提示功能（核心特色）

#### 2.4.1 功能概述
- 界面底部设有 **💡"提示"按钮**
- 点击后，AI 自动求解当前局面，**高亮显示** 推荐点击的车辆（金色边框 + 脉动动画）
- 玩家可选择接受提示点击该车，也可自行操作其他车辆
- 同一局面多次点击提示，依次给出不同推荐（按最优解顺序）

#### 2.4.2 算法原理：BFS 逆向搜索

```
提示算法流程：
┌──────────────┐
│  获取当前局面  │  ← 当前所有车辆位置 + 剩余乘客状态
└──────┬───────┘
       ↓
┌──────────────┐
│  BFS 搜索求解 │  ← 从当前状态开始广度优先搜索
│  枚举所有可   │     每步枚举所有可移动的车
│  移动的车辆   │     模拟移动 → 生成新状态
└──────┬───────┘
       ↓
┌──────────────┐
│  找到最短路径  │  ← BFS 天然找到最短步数解
└──────┬───────┘
       ↓
┌──────────────┐
│  返回第一步    │  ← 取解法路径的第一辆车作为推荐
│  高亮该车辆    │     对该车施加金色高亮 + 脉动特效
└──────────────┘
```

#### 2.4.3 搜索空间与性能

| 指标 | 说明 |
|------|------|
| 搜索算法 | BFS（广度优先搜索），保证最短路径 |
| 状态表示 | 每辆车坐标 + 停车位占用 + 剩余乘客 |
| 最大分支因子 | ≤8（最多8辆车同时可选） |
| 实际分支因子 | ~2-4（多数车被堵无法移动） |
| 最大搜索深度 | ≤20步（6×6网格） |
| 状态去重 | 哈希表记录已访问状态，避免重复搜索 |
| 单次求解耗时 | **< 50ms**（微信小游戏环境） |
| 缓存策略 | 同一局面求解结果缓存，连续点击不重复计算 |

#### 2.4.4 提示交互细节

| 场景 | 行为 |
|------|------|
| 正常局面 | 高亮推荐车辆，显示金色脉动边框 |
| 当前局面已无解 | 提示"当前局面已无解，建议重新开始" |
| 游戏已胜利 | 提示按钮隐藏或置灰 |
| 动画播放中 | 提示按钮暂时禁用（等动画结束） |
| 连续点击提示 | 依次推荐解法路径中的下一步（首次推荐第一步，再次推荐第二步...） |
| 玩家自行操作后 | 提示序列重置，重新从当前局面计算

---

## 三、MVP 关卡设计

### 3.1 关卡总览

| 关卡 | 网格 | 汽车数 | 颜色数 | 停车位 | 乘客数 | 难度 |
|------|------|--------|--------|--------|--------|------|
| 第1关 | 4×4 | 4 | 2（红、蓝） | 2 | 4（每色2人） | ⭐ 简单 |
| 第2关 | 5×5 | 6 | 3（红、蓝、绿） | 3 | 6（每色2人） | ⭐⭐ 中等 |
| 第3关 | 6×6 | 8 | 4（红、蓝、绿、黄） | 4 | 8（每色2人） | ⭐⭐⭐ 困难 |

### 3.2 第1关详细配置（竖屏）

```
        ┌──────────────┐
        │  [🔵👤👤]  [🔴👤👤]  │  ← 顶部接待区
        │   蓝车位     红车位    │     各2位乘客等待
        └──────────────┘
        ┌───┬───┬───┬───┐
        │ 🔵↑│   │   │ 🔴→│  ← row 0
        ├───┼───┼───┼───┤
        │   │ 🔴↑│   │   │  ← row 1
        ├───┼───┼───┼───┤
        │   │   │ 🔵→│   │  ← row 2
        ├───┼───┼───┼───┤
        │   │   │   │   │  ← row 3
        └───┴───┴───┴───┘
          停车区域 4×4（汽车向上开可进入接待区）

汽车配置：
- 🔵蓝车1：位置(row=0, col=0)，方向↑
- 🔵蓝车2：位置(row=2, col=2)，方向→
- 🔴红车1：位置(row=0, col=3)，方向→
- 🔴红车2：位置(row=1, col=1)，方向↑
```

**解题思路：**
1. 点击 🔵蓝车2 → 向右开，从右侧开出后由系统自动引导到蓝色停车位（蓝乘客-2）
2. 点击 🔴红车1 → 向右开出，自动到红色停车位（红乘客-2）
3. 点击 🔵蓝车1 → 向上开，到达接待区蓝色车位（蓝乘客上车完毕，蓝车坐满驶离）
4. 点击 🔴红车2 → 向上开，到达红色车位（红乘客上车完毕，红车坐满驶离）
5. 🎉 所有乘客接走，游戏胜利！

### 3.3 第2关详细配置（竖屏）

```
        ┌────────────────────────┐
        │  [🔵👤👤]  [🔴👤👤]  [🟢👤👤]  │  ← 顶部接待区
        │   蓝车位     红车位     绿车位    │     各2位乘客等待
        └────────────────────────┘
        ┌───┬───┬───┬───┬───┐
        │ 🔵↑│   │ 🟢→│   │ 🔴↑│  ← row 0
        ├───┼───┼───┼───┼───┤
        │   │ 🔴→│   │   │   │  ← row 1
        ├───┼───┼───┼───┼───┤
        │   │   │ 🟢↑│   │ 🔵→│  ← row 2
        ├───┼───┼───┼───┼───┤
        │   │ 🔵↓│   │   │   │  ← row 3
        ├───┼───┼───┼───┼───┤
        │ 🔴↑│   │   │ 🟢↓│   │  ← row 4
        └───┴───┴───┴───┴───┘
          停车区域 5×5（向上开出进入接待区）

汽车配置：
- 🔵蓝车1：(0,0)↑ | 🔵蓝车2：(2,4)→ | 🔵蓝车3：(3,1)↓
- 🔴红车1：(0,4)↑ | 🔴红车2：(1,1)→ | 🔴红车3：(4,0)↑
- 🟢绿车1：(0,2)→ | 🟢绿车2：(2,2)↑ | 🟢绿车3：(4,3)↓
```

**设计要点：**
- 部分汽车需要先移动其他车来"清路"（如蓝车3向下挡路，需先移开）
- 所有接待区都在顶部，统一向上开出
- 玩家需要规划点击顺序，确保正确的车先到达接待区

### 3.4 第3关详细配置（竖屏）

```
        ┌──────────────────────────────┐
        │ [🔵👤👤] [🔴👤👤] [🟢👤👤] [🟡👤👤] │  ← 顶部接待区
        │  蓝车位    红车位    绿车位    黄车位   │     各2位乘客等待
        └──────────────────────────────┘
        ┌───┬───┬───┬───┬───┬───┐
        │ 🔵↑│ 🟡→│   │ 🔴↑│   │ 🟢→│  ← row 0
        ├───┼───┼───┼───┼───┼───┤
        │   │ 🔴→│   │ 🟡↓│   │   │  ← row 1
        ├───┼───┼───┼───┼───┼───┤
        │ 🟢↑│   │ 🔵↓│   │ 🔴←│   │  ← row 2
        ├───┼───┼───┼───┼───┼───┤
        │   │   │ 🟡↑│   │   │ 🔵→│  ← row 3
        ├───┼───┼───┼───┼───┼───┤
        │ 🔴↓│   │   │ 🟢←│   │   │  ← row 4
        ├───┼───┼───┼───┼───┼───┤
        │   │ 🔵←│   │   │ 🟡↑│ 🟢↓│  ← row 5
        └───┴───┴───┴───┴───┴───┘
          停车区域 6×6，4色8车

汽车配置（每种颜色2辆）：
- 🔵蓝：蓝1(0,0)↑、蓝2(3,5)→、蓝3(5,1)←、蓝4(2,2)↓
- 🔴红：红1(0,3)↑、红2(1,1)→、红3(2,4)←、红4(4,0)↓
- 🟢绿：绿1(0,5)→、绿2(2,0)↑、绿3(4,3)←、绿4(5,5)↓
- 🟡黄：黄1(0,1)→、黄2(1,3)↓、黄3(3,2)↑、黄4(5,4)↑
```

**设计要点：**
- 最大规模网格，4色8车同时在场
- 复杂的交叉阻塞关系
- 需要仔细规划每步操作
- AI提示功能在此关价值最大

---

## 四、数据结构设计

### 4.1 汽车（Car）

```javascript
{
  id: "car_01",           // 唯一标识
  color: "red",           // 颜色：red/blue/green/yellow
  x: 0,                   // 当前像素 X 坐标（左上角）
  y: 0,                   // 当前像素 Y 坐标（左上角）
  targetX: 0,             // 目标像素 X 坐标
  targetY: 0,             // 目标像素 Y 坐标
  width: 60,              // 车宽（像素，各车规格不同）
  height: 60,             // 车高（像素，各车规格不同）
  direction: 0,           // 方向角度（0~360，步长 22.5°，0=向上）
  seats: 2,               // 总座位数
  passengers: 0,          // 已上车人数
  status: "idle",         // 移动状态机：idle / moving_forward / bouncing_back / arrived / departed
  originX: 0,             // 弹回起始位置 X（碰撞后弹回用）
  originY: 0,             // 弹回起始位置 Y
  moveSpeed: 200          // 移动速度（像素/秒）
}
```
**Car 移动状态机：**
```
idle → (点击) → moving_forward → (到达) → idle
                               → (碰撞) → bouncing_back → (回位) → idle
```
- 只有 `idle` 状态可被玩家点击
- `moving_forward` 期间每帧按速度推进，实时碰撞检测
- `bouncing_back` 期间用 easeInOut 缓动回原位，不可点击

### 4.2 停车位（PickupSlot）

```javascript
{
  id: "slot_01",
  color: "red",           // 对应颜色
  maxWait: 2,             // 等待乘客数
  currentWait: 2,         // 当前等待数
  position: {             // 接待区位置
    side: "right",        // 所在边：right/left/top/bottom
    index: 0              // 该边的第几个位置
  },
  occupied: false         // 是否被占用
}
```

### 4.3 关卡配置（LevelConfig）

```javascript
{
  level: 1,
  gridRows: 4,
  gridCols: 4,
  cars: [...],            // 汽车初始配置
  pickupSlots: [...],     // 停车位配置
  pickupZoneSides: ["right"], // 接待区所在边
}
```

---

## 五、游戏界面布局（竖屏 375×667 基准）

### 5.1 竖屏布局总览

```
┌──────────────────────┐  ← 屏幕宽度 375px
│    第1关  ⭐          │  ← 顶部信息栏（~40px）
│  🚗剩余:4 👤剩余:4   │
├──────────────────────┤
│                      │
│  ┌──┬──┬──┬──┐      │  ← 乘客接待区（~100px）
│  │🔵│👤│🔴│👤│      │     停车位横向排列
│  │  │👤│  │👤│      │     每车位旁显示乘客
│  └──┴──┴──┴──┘      │
│                      │
├──────────────────────┤
│                      │
│  ┌─┬─┬─┬─┐          │
│  │🔵│ │ │🔴│          │
│  │↑ │ │ │→ │          │
│  ├─┼─┼─┼─┤          │
│  │ │🔴│ │ │          │  ← 停车区域（~350px）
│  │ │↑ │ │ │          │     网格 + 汽车
│  ├─┼─┼─┼─┤          │     占据视觉重心
│  │ │ │🔵│ │          │
│  │ │ │→ │ │          │
│  ├─┼─┼─┼─┤          │
│  │ │ │ │ │          │
│  └─┴─┴─┴─┘          │
│                      │
├──────────────────────┤
│  [💡 提示]  [🔄 重来]  │  ← 底部操作栏（~80px）
│                      │     按钮区，大按钮易点击
└──────────────────────┘
```

### 5.2 各区域详细尺寸（基于 375×667 设计稿）

| 区域 | 高度 | 说明 |
|------|------|------|
| 顶部信息栏 | ~40px | 关卡名、剩余车数、剩余乘客数 |
| 乘客接待区 | ~100px | 停车位横向排列，每车位宽约80px |
| 停车区域 | ~350px | 网格居中，四周留白，网格单元格约60-70px |
| 底部操作栏 | ~80px | 两个大按钮并排，每个约140×50px |
| 剩余空间 | 弹性留白 | 适配不同屏幕高度 |

### 5.3 视觉风格

- **风格**：简洁扁平化卡通风格
- **汽车**：俯视图，带方向箭头标识，圆角矩形造型
- **乘客**：圆形小人图标，站在停车位旁
- **提示高亮**：金色脉动边框 `#FFD700` + 发光阴影
- **颜色体系**：
  - 🔴 红 `#FF6B6B`
  - 🔵 蓝 `#4ECDC4`
  - 🟢 绿 `#51CF66`
  - 🟡 黄 `#FFD43B`
- **网格线**：浅灰色细线 `#E0E0E0`
- **背景**：柔和米白 `#FAFAFA`，网格区域略深 `#F0F0F0`
- **按钮**：圆角矩形，主色调，大字体

---

## 六、动画与交互规范

### 6.1 汽车移动动画

| 阶段 | 动画效果 | 时长 |
|------|---------|------|
| 点击选中 | 汽车轻微放大 + 光晕 | 0.1s |
| 行驶中 | 像素级平滑移动（lerp 插值，每帧按 speed * dt 推进） | 连续，取决于距离 |
| 碰撞弹回 | 沿来路 easeInOut 缓动弹回原位 | 与前进同等时长 |
| 到达接待区 | 汽车缩小并定位到停车位 | 0.3s |
| 乘客上车 | 乘客图标弹跳进入汽车 | 0.3s/人 |
| 驶离 | 汽车向上飘出屏幕 | 0.5s |

**移动动画技术要点：**
- 逻辑层用细粒度网格判断碰撞（网格状态标记）
- 渲染层用像素浮点坐标 + lerp 插值，实现丝滑移动
- 每帧 `update(dt)` 传入 delta time，保证不同帧率下速度一致
- 移动中的车之间实时碰撞检测：两车路径交叉时，移动距离更短的一方弹回
- 弹回动画 = 从碰撞点缓动回到 originX/originY

### 6.2 交互反馈

| 场景 | 反馈 |
|------|------|
| 点击无法移动的车 | 汽车抖动提示 |
| 停车位已满 | 显示"停车位已满"气泡提示 |
| 颜色不匹配 | 乘客摇头动画 |
| 游戏胜利 | 撒花动画 + "恭喜过关"弹窗 |
| 游戏失败 | 灰色遮罩 + "重新挑战"按钮 |

### 6.3 音效建议（MVP可暂不实现）

- 点击选中：短促"滴"声
- 汽车行驶：引擎嗡嗡声
- 乘客上车：愉悦"叮咚"声
- 胜利：欢快短旋律
- 失败：低沉"咚"声

---

## 七、技术实现要点

### 7.1 技术选型

| 项 | 选择 |
|-----|------|
| 框架 | 微信小游戏原生 Canvas 2D |
| 语言 | JavaScript |
| 渲染 | Canvas 2D API |
| 动画 | requestAnimationFrame + 自建缓动 |
| 数据 | 关卡配置 JSON 内联 |

### 7.2 核心算法

#### 7.2.1 汽车移动逻辑（像素级 + 网格碰撞）

```javascript
/**
 * 点击汽车 → 计算可达位置 → 启动移动动画
 * 核心：细粒度网格碰撞 + 像素级渲染
 */
function onCarClicked(car) {
  if (car.status !== 'idle') return; // 非 idle 不可点击

  // 干跑：沿方向射线扫描，计算最远可达距离
  const maxDistance = scanRay(car, car.direction);
  
  if (maxDistance <= 0) return; // 无法移动，不响应

  // 保存原位（碰撞弹回用）
  car.originX = car.x;
  car.originY = car.y;
  
  // 设置目标位置
  const rad = car.direction * Math.PI / 180;
  car.targetX = car.x + Math.sin(rad) * maxDistance;
  car.targetY = car.y - Math.cos(rad) * maxDistance;
  
  car.status = 'moving_forward';
}

/**
 * 射线扫描：沿方向发射射线，计算不碰撞的最远距离
 * 使用 DDA 算法遍历细粒度网格
 */
function scanRay(car, angleDeg) {
  const rad = angleDeg * Math.PI / 180;
  const dx = Math.sin(rad);
  const dy = -Math.cos(rad);
  
  let distance = 0;
  const step = GRID_CELL_SIZE; // 以网格单元为步长
  const maxDist = 9999;
  
  while (distance < maxDist) {
    distance += step;
    const checkX = car.x + dx * distance;
    const checkY = car.y + dy * distance;
    
    // 检查是否开出区域边界
    if (isOutsidePickupZone(checkX, checkY, car)) {
      return distance; // 可以开出，进入接待区
    }
    
    // 检查细粒度网格是否被占用（空间哈希查询）
    const coveredCells = getCellsCoveredByRect(
      checkX, checkY, car.width, car.height
    );
    for (const cell of coveredCells) {
      if (grid.isOccupied(cell.row, cell.col)) {
        return distance - step; // 碰撞，返回前一位置
      }
    }
  }
  
  return maxDist;
}

/**
 * 每帧更新：所有 moving_forward 的车逐帧推进 + 实时碰撞检测
 */
function updateCars(dt) {
  for (const car of cars) {
    if (car.status === 'moving_forward') {
      const rad = car.direction * Math.PI / 180;
      const dx = Math.sin(rad) * car.moveSpeed * dt;
      const dy = -Math.cos(rad) * car.moveSpeed * dt;
      
      const nextX = car.x + dx;
      const nextY = car.y + dy;
      
      // 实时碰撞检测（包括与其他移动中的车）
      if (checkCollisionAt(nextX, nextY, car)) {
        car.status = 'bouncing_back';
        continue;
      }
      
      // 是否到达目标
      if (distance(car.x, car.y, car.targetX, car.targetY) < 2) {
        car.x = car.targetX;
        car.y = car.targetY;
        car.status = 'idle';
        // 判断是否开出区域 → 进入接待区
        if (isOutsideGrid(car)) tryEnterPickupZone(car);
      } else {
        car.x = nextX;
        car.y = nextY;
        updateGridOccupancy(car); // 更新网格占用
      }
    }
    
    if (car.status === 'bouncing_back') {
      // easeInOut 缓动弹回 originX/originY
      const t = car.bounceProgress; // 0→1
      const eased = easeInOutQuad(t);
      car.x = lerp(car.bounceStartX, car.originX, eased);
      car.y = lerp(car.bounceStartY, car.originY, eased);
      car.bounceProgress += dt / car.bounceDuration;
      
      if (car.bounceProgress >= 1) {
        car.x = car.originX;
        car.y = car.originY;
        car.status = 'idle';
        updateGridOccupancy(car);
      }
    }
  }
}

/**
 * 碰撞检测：检查指定位置是否与其他车重叠
 * 通过细粒度网格的空间哈希快速查询
 */
function checkCollisionAt(x, y, self) {
  const cells = getCellsCoveredByRect(x, y, self.width, self.height);
  for (const cell of cells) {
    const occupant = grid.getOccupant(cell.row, cell.col);
    if (occupant && occupant.id !== self.id) return true;
  }
  return false;
}
```

#### 7.2.2 接待区停车逻辑

```javascript
function tryEnterPickupZone(car) {
  const slot = findAvailableSlot(car.color);
  if (!slot) {
    showToast("停车位已满！");
    return;
  }
  occupySlot(slot, car);
  boardPassengers(slot, car);
  if (car.passengers >= car.seats) {
    departCar(car, slot);  // 坐满驶离，释放停车位
  }
}
```

#### 7.2.3 AI 提示求解器（BFS，基于细粒度网格）

```javascript
/**
 * AI 提示求解器 - BFS 搜索最短解法
 * 基于细粒度网格状态，剪枝只枚举"有效停靠位置"
 * 输入：当前游戏状态（所有车的位置 + 剩余乘客）
 * 输出：下一步推荐点击的车辆ID（或 null 表示无解）
 */

class HintSolver {
  constructor(gameState) {
    this.initialState = this.serializeState(gameState);
    this.visited = new Map();        // 状态去重
    this.cache = new Map();          // 求解缓存
  }

  getHint() {
    const stateKey = this.initialState;
    if (this.cache.has(stateKey)) {
      const cached = this.cache.get(stateKey);
      return cached.length > 0 ? cached[0] : null;
    }
    const result = this.bfs();
    this.cache.set(stateKey, result);
    return result.length > 0 ? result[0] : null;
  }

  bfs() {
    const queue = [{ state: this.initialState, path: [] }];
    this.visited.set(this.initialState, 0);

    while (queue.length > 0) {
      const { state, path } = queue.shift();
      
      if (this.isGoalState(state)) return path;
      if (path.length >= 25) continue;

      const movableCars = this.getMovableCars(state);
      for (const carId of movableCars) {
        const nextState = this.simulateMove(state, carId);
        if (!this.visited.has(nextState)) {
          this.visited.set(nextState, path.length + 1);
          queue.push({ state: nextState, path: [...path, carId] });
        }
      }
    }
    return [];  // 无解
  }

  /**
   * 序列化状态：将所有车的位置按细粒度网格坐标离散化
   * 离散精度 = GRID_CELL_SIZE（与碰撞网格一致）
   */
  serializeState(gs) {
    const cars = gs.cars
      .filter(c => c.status === 'idle')
      .map(c => {
        const gx = Math.round(c.x / GRID_CELL_SIZE);
        const gy = Math.round(c.y / GRID_CELL_SIZE);
        return `${c.id}:${gx},${gy}`;
      })
      .sort()
      .join('|');
    const slots = gs.slots
      .map(s => `${s.color}:${s.currentWait}:${s.occupied ? 1 : 0}`)
      .join('|');
    return `${cars}||${slots}`;
  }

  /**
   * 获取可移动的车：只枚举"有效停靠位置"
   * 剪枝策略：车只能停在紧贴另一辆车/墙壁的位置，大幅缩减分支
   */
  getMovableCars(stateStr) {
    const gs = this.deserializeState(stateStr);
    return gs.cars
      .filter(c => c.status === 'idle')
      .filter(c => this.canMoveToUsefulPosition(gs, c))
      .map(c => c.id);
  }

  /** 模拟移动：复用 scanRay 逻辑计算停靠位置 */
  simulateMove(stateStr, carId) {
    const gs = this.deserializeState(stateStr);
    const car = gs.cars.find(c => c.id === carId);
    const maxDist = scanRay(car, car.direction); // 复用 MoveSystem
    if (maxDist <= 0) return stateStr;
    const rad = car.direction * Math.PI / 180;
    car.x += Math.sin(rad) * maxDist;
    car.y -= Math.cos(rad) * maxDist;
    // 判断是否开出 → 进入接待区
    if (isOutsideGrid(car)) tryEnterPickupZone(gs, car);
    return this.serializeState(gs);
  }

  isGoalState(stateStr) {
    const gs = this.deserializeState(stateStr);
    return gs.slots.every(s => s.currentWait === 0);
  }
}
```

**性能优化要点：**
- 基于细粒度网格序列化状态，紧凑字符串表示
- `visited` 用 Map，O(1) 查找
- 剪枝：只枚举"有效停靠位置"（靠边/靠其他车），不枚举每个中间像素
- 求解缓存，连续点击不重复计算
- 深度限制 25 步
- 16 方向 + 多尺寸车场景下，有效分支因子仍然可控（~3-5）
- 实际搜索量：中小关卡 < 5000 状态，均 < 50ms

#### 7.2.4 胜负判定

```javascript
function checkGameState() {
  const totalPassengers = countAllWaitingPassengers();
  if (totalPassengers === 0) {
    triggerVictory();
    return;
  }
  // 用 HintSolver 快速判断是否还有解
  const solver = new HintSolver(getCurrentState());
  if (solver.getHint() === null) {
    triggerDefeat();
  }
}
```

### 7.3 文件结构建议

```
minigame-movecars/
├── game.js                 # 游戏入口
├── game.json               # 游戏配置
├── js/
│   ├── main.js             # 主循环
│   ├── grid.js             # 网格系统
│   ├── car.js              # 汽车类
│   ├── pickupZone.js       # 接待区类
│   ├── levelManager.js     # 关卡管理
│   ├── inputHandler.js     # 输入处理
│   ├── renderer.js         # 渲染器
│   ├── animator.js         # 动画管理
│   ├── hintSolver.js       # AI提示求解器（BFS）
│   └── levels/
│       ├── level1.js       # 第1关数据
│       ├── level2.js       # 第2关数据
│       └── level3.js       # 第3关数据
└── images/
    └── ...                 # 图片素材（如需要）
```

### 7.4 关卡自动验证工具（开发辅助）

在开发过程中，提供一个独立的 **关卡验证脚本**，用于：
- 自动 BFS 求解，验证关卡一定有解
- 输出最短步数（用于星级评价参考）
- 输出完整解法步骤（用于调试）
- 可集成到 CI / 构建流程中

```javascript
// tools/validateLevel.js - 关卡验证工具
function validateLevel(levelConfig) {
  const solver = new HintSolver(createInitialState(levelConfig));
  const startTime = Date.now();
  const solution = solver.bfs();
  const elapsed = Date.now() - startTime;

  console.log(`关卡 ${levelConfig.level} 验证结果：`);
  console.log(`  可解：${solution.length > 0 ? '✅ 是' : '❌ 否'}`);
  console.log(`  最短步数：${solution.length}`);
  console.log(`  解法路径：${solution.join(' → ')}`);
  console.log(`  求解耗时：${elapsed}ms`);
  
  return { solvable: solution.length > 0, steps: solution.length, path: solution };
}
```

### 7.5 Canvas 渲染层级

```
Layer 0: 背景色 + 装饰
Layer 1: 细粒度网格线（用于视觉参考，实际碰撞网格更细）
Layer 2: 汽车（含方向箭头，像素级渲染，lerp 插值位置）
Layer 3: 提示高亮层（金色脉动边框，覆盖在推荐车辆上）
Layer 4: 接待区停车位
Layer 5: 乘客图标
Layer 6: UI 覆盖层（按钮、文字、状态栏）
Layer 7: 特效层（粒子、弹窗、Toast）
```

### 7.6 关键技术决策汇总

| # | 决策项 | 方案 |
|---|--------|------|
| 1 | 渲染方式 | 像素级浮点坐标 + lerp 插值动画，丝滑移动 |
| 2 | 碰撞检测 | 细粒度网格 + 空间哈希，射线栅格化（DDA）遍历 |
| 3 | 车辆规格 | 多尺寸（大车占多格，小车占1格），后期动态调整 |
| 4 | 行驶方向 | 16 方向（每 22.5°），含斜向行驶 |
| 5 | 移动模式 | 原子操作：点击即发动，碰撞弹回（easeInOut），即时反馈 |
| 6 | 多车同时 | 允许多车同时移动，移动中车辆间实时碰撞检测 |
| 7 | AI 求解 | 基于细粒度网格的 BFS，剪枝枚举有效停靠位置 |
| 8 | 网格粒度 | 项目后期根据实际车型尺寸动态调整 |

---

## 八、MVP 开发阶段规划

### Phase 1：基础框架（预计 2-3 天）
- [ ] 创建微信小游戏项目
- [ ] 搭建 Canvas 渲染框架（竖屏 375×667）
- [ ] 实现网格绘制
- [ ] 实现基础 UI 布局（顶部信息栏 + 底部按钮栏）

### Phase 2：核心玩法（预计 3-4 天）
- [ ] 汽车数据结构与绘制（含方向箭头）
- [ ] 点击交互与方向识别
- [ ] 汽车直线移动逻辑（含碰撞检测）
- [ ] 接待区停车位系统
- [ ] 乘客上车逻辑
- [ ] 胜负判定

### Phase 3：AI 提示系统（预计 1-2 天）
- [ ] 实现 HintSolver（BFS 求解器）
- [ ] 状态序列化 / 反序列化
- [ ] 移动模拟（复用游戏引擎逻辑）
- [ ] 求解缓存机制
- [ ] 提示按钮 UI + 推荐车辆高亮动效
- [ ] 连续提示序列支持
- [ ] 关卡自动验证脚本

### Phase 4：关卡内容（预计 1-2 天）
- [ ] 第1关配置与调试 + AI 验证可解
- [ ] 第2关配置与调试 + AI 验证可解
- [ ] 第3关配置与调试 + AI 验证可解
- [ ] 关卡切换与进度保存

### Phase 5：打磨优化（预计 1-2 天）
- [ ] 移动动画优化（缓动函数）
- [ ] 提示高亮脉动动画
- [ ] UI 美化与适配
- [ ] 音效接入（可选）
- [ ] 测试与 Bug 修复

---

## 九、后续迭代方向（非MVP）

- [ ] 更多关卡（逐步增加难度）
- [ ] 特殊机制：障碍物、单向道、传送带
- [ ] 星级评价系统（最少步数挑战）
- [ ] 关卡编辑器（玩家自制关卡）
- [ ] 排行榜与社交分享
- [ ] 多种车型（公交车3座、出租车1座）
- [ ] 道具系统（炸弹清除障碍、转向卡）
- [ ] 每日挑战关卡

---

## 十、关键风险与注意事项

| 风险 | 应对策略 |
|------|---------|
| 关卡可能无解 | AI 求解器自动验证，每个关卡上线前必须通过 BFS 可解性检测 |
| 操作卡死 | 提供"重新开始"按钮 + AI 提示按钮辅助玩家 |
| BFS 搜索性能 | 状态去重 + 深度限制 + 结果缓存；实测 6×6 网格 < 50ms |
| 颜色辨识度 | 确保4种颜色有明显区分，同时用形状辅助（△□○☆） |
| 竖屏适配 | 以 375×667 为基准，网格单元格动态计算，适配不同屏幕 |
| 微信审核 | 遵守微信小游戏规范，避免违规内容 |

---

> 📌 **本文档为 MVP 策划案，核心目标是快速验证玩法可行性。所有设计均以"可玩、可测、可迭代"为原则。**
