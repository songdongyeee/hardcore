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
    version: "1.20.2", // 仅用于控制首页“新特性”弹窗的显示，不作为 App 真实版本上报
    title: "全新版本焕新开启",
    features: [
        {
            icon: "mic",
            title: "录音更易用",
            description: "增加了逐步录音、逐步继续的功能，更自由的对比和重录。"
        },
        {
            icon: "zap",
            title: "逐词精准交互",
            description: "新增句子和单词级的点击标记功能，支持实时卡拉 OK 高亮。"
        }
    ]
};
