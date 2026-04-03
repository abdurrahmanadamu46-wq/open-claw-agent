"""
龙虾工具注册表

所有外部工具在此统一注册，供 LobsterRunner 和各龙虾模块调用。
"""

from tools.agent_reach import SearchResult, agent_reach_tool

__all__ = ["agent_reach_tool", "SearchResult"]
