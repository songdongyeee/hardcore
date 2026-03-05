export interface ReleaseFeature {
    icon: string;
    title: string;
    description: string;
}

export interface ReleaseNote {
    version: string;
    title: string;
    features: ReleaseFeature[];
}

export const RELEASE_NOTES: ReleaseNote = {
    version: "1.10.7", // 每次发版前更新此版本号
    title: "全新版本焕新开启",
    features: [
        {
            icon: "sparkles",
            title: "丝滑交互体验",
            description: "深度优化了长文章的性能，彻底解决听力练习时的卡顿和发热。"
        },
        {
            icon: "zap",
            title: "逐词精准交互",
            description: "新增句子和单词级的点击标记功能，支持实时卡拉 OK 高亮。"
        },
        {
            icon: "bell",
            title: "远程推送通知",
            description: "重要的版本更新和学习提醒，现可通过桌面通知第一时间获知。"
        }
    ]
};
