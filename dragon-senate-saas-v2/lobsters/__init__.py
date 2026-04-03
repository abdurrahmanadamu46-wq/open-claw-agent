"""
dragon-senate-saas-v2/lobsters/ — 9只龙虾独立模块包

已提取为独立完整实现：
- radar
- strategist
- inkwriter
- visualizer
- dispatcher
- echoer
- catcher
- abacus
- followup
"""

from lobsters.base_lobster import BaseLobster, load_role_card, load_prompt_kit, load_memory_policy
from lobsters.radar import radar, RadarLobster
from lobsters.strategist import strategist, StrategistLobster
from lobsters.inkwriter import inkwriter, InkWriterLobster
from lobsters.visualizer import visualizer, VisualizerLobster
from lobsters.dispatcher import dispatcher, DispatcherLobster
from lobsters.echoer import echoer, EchoerLobster
from lobsters.catcher import catcher, CatcherLobster
from lobsters.abacus import abacus, AbacusLobster
from lobsters.followup import followup, FollowUpLobster

__all__ = [
    "BaseLobster",
    "load_role_card",
    "load_prompt_kit",
    "load_memory_policy",
    "radar",
    "RadarLobster",
    "strategist",
    "StrategistLobster",
    "inkwriter",
    "InkWriterLobster",
    "visualizer",
    "VisualizerLobster",
    "dispatcher",
    "DispatcherLobster",
    "echoer",
    "EchoerLobster",
    "catcher",
    "CatcherLobster",
    "abacus",
    "AbacusLobster",
    "followup",
    "FollowUpLobster",
]
