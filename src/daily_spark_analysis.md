# Daily Spark "Built-in Material Only" Issue Analysis (每日一句只显示内置材料问题的深度分析)

## 1. Problem Description (问题描述)
用户反馈：App 中有很多远程材料，但 Daily Spark（每日一句）始终只显示唯一的内置材料（尚雯婕采访），无法显示远程材料。即使重启 App 也无法恢复。

## 2. Root Cause Analysis (根本原因分析)

经过对 `useDailySpark.ts` 和 `materialService.ts` 的深度排查，我们发现这是一个由 **"秒开优化" (Instant Render)** 和 **"每日锁定" (Daily Lock)** 机制相互冲突导致的 **竞态条件 (Race Condition)** bug。

### The Mechanism of Failure (故障机制详解)

1.  **初期化阶段 (Initialization - 0ms)**：
    *   App 启动时，为了避免白屏，`useDailySpark` 钩子会**同步**初始化数据。
    *   此时，唯一的可用数据是内置材料（Bundled Material, ID: `bundled-ShangWenJie...`）。
    *   **状态**：`allMaterials` = `[ 内置材料 ]`。

2.  **首次渲染与锁定 (First Render & Logic - 10ms)**：
    *   `useMemo` 开始计算今日推荐。
    *   它发现只有一个候选：内置材料。
    *   它根据日期哈希选中了这个材料。
    *   **关键错误点**：代码逻辑判定“既然选中了，为了防止一天内变来变去，我必须把它**锁定**”。
    *   **执行锁定**：`sessionStorage.setItem('daily_spark_locked_id', 'bundled-ShangWenJie...')`。

3.  **远程数据加载 (Remote Loading - 500ms~1s)**：
    *   `useEffect` 中的 `loadRemoteMaterials()` 异步获取到了 100+ 条远程材料。
    *   状态更新：`allMaterials` = `[ 内置材料, 远程1, 远程2, ... ]`。

4.  **二次渲染与死锁 (re-Render & Deadlock)**：
    *   `useMemo` 再次运行。
    *   它首先检查“今日锁定”记录：
    ```typescript
    if (lockedDate === businessDate && lockedId) {
        // "今天已经选过 bundled-ShangWenJie 了，直接返回它！"
        return locked;
    }
    ```
    *   **结果**：尽管现在池子里有更好的远程材料，代码逻辑通过“锁定机制”强制忽略了它们，固执地返回了第一次渲染时匆忙选定的内置材料。

### 结论
**"过早锁定" (Premature Locking)** 是根本原因。系统在数据尚未完全加载（只加载了占位符）时就触发了“每日锁定”，导致后续加载的真实数据无法生效。

## 3. Proposed Solution (解决方案)

我们需要引入**"智能升级锁定" (Smart Lock Upgrade)** 机制。

**新逻辑：**
当遇到“今日已锁定”的情况时，不应盲目遵循，而要检查锁定的质量：
1.  如果当前锁定的是 **内置材料** (ID 以 `bundled-` 开头)；
2.  **并且** 现在的候选池里包含了 **远程材料** (Source 为 `remote`)；
3.  **那么**：判定当前锁定为“低质量/占位符锁定”，允许**打破锁定**，重新从全量池中选择，并更新锁定记录。

## 4. Fix Implementation (修复代码预览)

我们将修改 `useDailySpark.ts` 中的 `useMemo` 逻辑：

```typescript
// ... inside useMemo ...

const lockedId = sessionStorage.getItem('daily_spark_locked_id');

// 🔍 检测逻辑：是否需要升级锁定？
const isLockedItemBundled = lockedId?.startsWith('bundled-');
// 检查是否有真正的远程材料可用（不仅仅是内置的）
const hasRemoteCandidates = candidates.some(m => !m.id.startsWith('bundled-') && m.source === 'remote');

let validLockFound = false;

if (lockedDate === businessDate && lockedId) {
    if (isLockedItemBundled && hasRemoteCandidates) {
        console.log('🔓 [Daily Spark] 检测到远程数据已加载，正在升级占位符锁定...');
        // 不返回 locked，而是让代码继续向下执行，触发重新选择
    } else {
        // 有效锁定（已经是远程的，或者是离线状态确实只有内置的），保持锁定
        const locked = candidates.find(m => m.id === lockedId);
        if (locked) return locked;
    }
}

// ... 下面是正常的重新选择逻辑 ...
```

## 5. Verification (预期效果)

1.  **冷启动**：用户打开 App，可能会瞬间看到内置材料（0.1秒）。
2.  **数据到达**：一旦远程数据加载完毕（0.5秒），Daily Spark 卡片会自动**刷新**，变为从远程库中选出的真正“每日一句”。
3.  **后续保持**：如果不杀后台再次进入，或者刷新页面，将保持这个新的远程选择（因为新的锁定已经是远程 ID 了）。

---
**确认执行此修复方案？**
