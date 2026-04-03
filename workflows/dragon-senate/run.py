# -*- coding: utf-8 -*-
"""
龙虾元老院 — 本地运行入口
用法: python run.py  或  python -m dragon_senate.run
"""
from langchain_core.messages import HumanMessage

from dragon_senate import compile_app
from dragon_senate.state import DragonState


def main():
    app = compile_app()
    initial_state: DragonState = {
        "task_description": "帮我分析这个抖音爆款视频，生成短平快剧本并收网",
        "messages": [HumanMessage(content="开始新任务")],
    }
    config = {"configurable": {"thread_id": "dragon_senate_001"}}

    print("[DragonSenate] 龙虾元老院启动!")
    result = app.invoke(initial_state, config)

    print("\n=== 最终结果 ===")
    print("评分:", result.get("score"))
    print("进化记录:", result.get("evolution_log"))
    print("全流程已闭环！下次任务会更聪明")


if __name__ == "__main__":
    main()
