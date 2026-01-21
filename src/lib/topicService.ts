import { pb } from './api';

// ==================== 类型定义 ====================

export interface TopicMeta {
    id: string;
    topic_name: string;
    category: 'daily_spark' | 'core_library';
    display_order: number;
    status: 'active' | 'coming_soon' | 'locked';
    coming_soon_label?: string;
    cover?: string; // File字段
    description?: string;
}

export interface Topic {
    name: string;
    category: string;
    count: number;
    order: number;
    status?: 'active' | 'coming_soon' | 'locked';
    comingSoonLabel?: string;
    coverUrl?: string;
    description?: string;
}

// ==================== 主要函数 ====================

/**
 * 获取指定分类的所有主题（动态聚合 + 自动创建）
 */
export async function getTopicsByCategory(
    category: 'daily_spark' | 'core_library'
): Promise<Topic[]> {
    try {
        // 1. 从materials聚合topic（获取真实材料数量）
        const materials = await pb.collection('transcripts').getFullList({
            filter: `location = "${category}"`,
            fields: 'topic',
            sort: '-created',
            requestKey: null // 🔥 禁用自动取消，防止 Promise.all 中的并行请求互相取消
        });

        // 2. 统计各topic的材料数量
        const topicCounts: Record<string, number> = {};
        materials.forEach((m: any) => {
            const topic = m.topic || 'General';
            topicCounts[topic] = (topicCounts[topic] || 0) + 1;
        });

        // 3. 获取topic元数据 (允许失败)
        let topicMetas: TopicMeta[] = [];
        try {
            topicMetas = await pb.collection('topic_meta').getFullList<TopicMeta>({
                filter: `category = "${category}"`,
                sort: 'display_order',
                requestKey: null // 🔥 禁用自动取消
            });
        } catch (e: any) {
            console.warn(`⚠️ [Topic] Failed to load topic_meta (using defaults): ${e.message}`);
            // Fallback: continue with empty metas
        }

        // 4. 创建主题映射
        const metaMap = new Map<string, TopicMeta>();
        topicMetas.forEach(meta => metaMap.set(meta.topic_name, meta));

        console.log(`🔍 [Topic Debug] Category: ${category}`);
        console.log(`   - Found ${materials.length} materials -> ${Object.keys(topicCounts).length} unique topics`);
        console.log(`   - Found ${topicMetas.length} meta records in PB`);

        // 打印不匹配的项
        const unmatched = Object.keys(topicCounts).filter(t => !metaMap.has(t));
        if (unmatched.length > 0) {
            console.warn(`   - ⚠️ Unmatched topics (using defaults):`, unmatched);
            console.log(`   - Available meta names:`, Array.from(metaMap.keys()));
        }

        // 5. 🔥 自动创建缺失的topic_meta (仅即尝试, 失败不阻塞)
        for (const topicName of Object.keys(topicCounts)) {
            if (!metaMap.has(topicName)) {
                // 如果没有 meta，也不要必须创建（因为可能没权限），我们会在 map 阶段使用默认值
                try {
                    // 仅当确实需要且有权限时才尝试创建，这里其实可以跳过，
                    // 因为前端不应该负责 schema 的维护，除非是 admin app。
                    // 为了性能和稳定性，我们在 catch 中仅记录
                    /* 
                    const newMeta = await pb.collection('topic_meta').create({
                        topic_name: topicName,
                        category: category,
                        display_order: 999,
                        status: 'active'
                    }) as TopicMeta;
                    metaMap.set(topicName, newMeta);
                    */
                } catch (e) {
                    // console.error(`❌ [Topic] Failed to create topic_meta for ${topicName}:`, e);
                }
            }
        }

        // 6. 合并数据
        // 6. 合并数据 (Modified: Include topics from meta even if count is 0)
        const allTopicNames = new Set([...Object.keys(topicCounts), ...metaMap.keys()]);

        const topics: Topic[] = Array.from(allTopicNames).map(name => {
            const count = topicCounts[name] || 0;
            const meta = metaMap.get(name);

            // If topic has no materials, force explicit status or default to coming_soon if created in PB
            // But usually we respect the meta status. 
            // If it has no materials ONLY show it if it has meta (which implies it's a planned topic)

            return {
                name,
                category,
                count,
                order: meta?.display_order || 999,
                status: meta?.status || 'active',
                comingSoonLabel: meta?.coming_soon_label,
                coverUrl: meta?.cover ? pb.files.getUrl(meta, meta.cover) : undefined,
                description: meta?.description
            };
        });

        // 7. 按order排序，order 相同的按名称排序
        topics.sort((a, b) => {
            if (a.order !== b.order) return a.order - b.order;
            return a.name.localeCompare(b.name);
        });

        return topics;
    } catch (error) {
        console.error(`❌ [Topic] Failed to get topics for ${category}:`, error);
        return [];
    }
}

/**
 * 获取所有分类的主题
 */
export async function getAllTopics(): Promise<Record<string, Topic[]>> {
    const [dailySparkTopics, coreLibraryTopics] = await Promise.all([
        getTopicsByCategory('daily_spark'),
        getTopicsByCategory('core_library')
    ]);

    return {
        daily_spark: dailySparkTopics,
        core_library: coreLibraryTopics
    };
}

/**
 * 获取指定主题的材料列表
 */
export async function getMaterialsByTopic(
    category: string,
    topicName: string,
    page: number = 1,
    perPage: number = 20
) {
    try {
        const result = await pb.collection('transcripts').getList(page, perPage, {
            filter: `location = "${category}" && topic = "${topicName}"`,
            sort: 'topicOrder,-created' // 先按topicOrder排序，再按创建时间
        });

        return result;
    } catch (error) {
        console.error(`❌ [Topic] Failed to get materials for ${topicName}:`, error);
        return {
            items: [],
            page: 1,
            perPage: 20,
            totalItems: 0,
            totalPages: 0
        };
    }
}
