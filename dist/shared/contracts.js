/**
 * ClawCommerce 数据字典约定 - 双端必须严格遵守
 * 来源：PM 文档 v1.3 研发协同协议 & 第一阶段双端开发任务书
 * @module shared/contracts
 */
/**
 * Agent 节点状态枚举（与后端 Entity 一致，禁止越权流转）
 */
export var NodeStatusEnum;
(function (NodeStatusEnum) {
    NodeStatusEnum["IDLE"] = "IDLE";
    /** 正在拉起环境/指纹 */
    NodeStatusEnum["INITIALIZING"] = "INIT";
    /** 正在采集对标 */
    NodeStatusEnum["SCRAPING"] = "SCRAPING";
    /** 正在二创渲染 */
    NodeStatusEnum["GENERATING"] = "GENERATING";
    /** 正在发布 */
    NodeStatusEnum["PUBLISHING"] = "PUBLISHING";
    /** 风控冷却中 */
    NodeStatusEnum["COOLING"] = "COOLING";
    /** 账号/IP 被封禁 */
    NodeStatusEnum["BANNED"] = "BANNED";
})(NodeStatusEnum || (NodeStatusEnum = {}));
/**
 * PM v1.8 动态分镜规则配置表（双端同步）
 * 取消固定 5/7/15 分镜，改为弹性区间；语意边界 + 物理字数/时长校验在 Agent 侧完成。
 */
export const TEMPLATE_DYNAMIC_RULES = {
    '10秒爆款短视频': { min_clips: 3, max_clips: 6 },
    '15秒故事带货': { min_clips: 5, max_clips: 9 },
    '30秒深度种草': { min_clips: 10, max_clips: 18 },
};
//# sourceMappingURL=contracts.js.map