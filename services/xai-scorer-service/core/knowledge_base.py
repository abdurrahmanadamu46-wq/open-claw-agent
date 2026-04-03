"""
商业意图特征库：高转化词 vs 羊毛词
生产环境可替换为 RAG 知识库或嵌入向量比对。
"""
# 关键词 → 分数调整（正为高意向，负为比价/羊毛）
INTENT_WEIGHTS: dict[str, dict[str, int]] = {
    "keywords": {
        "多少钱": -20,
        "求链接": 10,
        "怎么卖": 10,
        "孕妇能用吗": 40,
        "过敏肌": 35,
        "有售后吗": 30,
    },
    "personas": {
        "DealHunter": -10,
        "FastScroller": 0,
        "StoryEmpathizer": 15,
        "ValueResearcher": 25,
    },
}
