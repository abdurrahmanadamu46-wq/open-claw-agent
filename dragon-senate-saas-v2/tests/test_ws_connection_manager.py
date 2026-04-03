"""Tests for ws_connection_manager module."""

from __future__ import annotations

import asyncio
import os
import sys
import unittest
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ws_connection_manager import ConnectionManager, KickPolicy


def _run(coro):
    return asyncio.run(coro)


class TestConnectionManager(unittest.TestCase):
    """Test ConnectionManager core functionality."""

    def _make_ws(self) -> MagicMock:
        ws = AsyncMock()
        ws.send_text = AsyncMock()
        ws.close = AsyncMock()
        return ws

    def test_register_and_count(self):
        mgr = ConnectionManager()
        ws = self._make_ws()
        _run(mgr.register(ws, "user1", "t1", "dev1", "web"))
        self.assertEqual(mgr.online_user_count, 1)
        self.assertEqual(mgr.online_conn_count, 1)
        self.assertTrue(mgr.is_user_online("user1"))

    def test_multiple_devices(self):
        mgr = ConnectionManager(kick_policy=KickPolicy.NONE)
        ws1 = self._make_ws()
        ws2 = self._make_ws()
        _run(mgr.register(ws1, "user1", "t1", "dev1", "web"))
        _run(mgr.register(ws2, "user1", "t1", "dev2", "mobile"))
        self.assertEqual(mgr.online_user_count, 1)
        self.assertEqual(mgr.online_conn_count, 2)
        conns = mgr.get_user_connections("user1")
        self.assertEqual(len(conns), 2)

    def test_same_device_kick(self):
        mgr = ConnectionManager(kick_policy=KickPolicy.SAME_DEVICE_KICK)
        ws1 = self._make_ws()
        ws2 = self._make_ws()
        _run(mgr.register(ws1, "user1", "t1", "dev1", "web"))
        _run(mgr.register(ws2, "user1", "t1", "dev1", "web"))
        self.assertEqual(mgr.online_conn_count, 1)
        conns = mgr.get_user_connections("user1")
        self.assertEqual(len(conns), 1)
        self.assertIs(conns[0].ws, ws2)

    def test_unregister(self):
        mgr = ConnectionManager()
        ws = self._make_ws()
        _run(mgr.register(ws, "user1", "t1", "dev1"))
        _run(mgr.unregister("user1", "dev1"))
        self.assertEqual(mgr.online_user_count, 0)
        self.assertEqual(mgr.online_conn_count, 0)
        self.assertFalse(mgr.is_user_online("user1"))

    def test_snapshot(self):
        mgr = ConnectionManager()
        snap = mgr.snapshot()
        self.assertIn("online_user_count", snap)
        self.assertIn("online_conn_count", snap)
        self.assertIn("kick_policy", snap)

    def test_get_online_users_by_tenant(self):
        mgr = ConnectionManager(kick_policy=KickPolicy.NONE)
        _run(mgr.register(self._make_ws(), "u1", "t1", "d1"))
        _run(mgr.register(self._make_ws(), "u2", "t2", "d1"))
        self.assertEqual(mgr.get_online_users("t1"), ["u1"])
        self.assertEqual(mgr.get_online_users("t2"), ["u2"])
        self.assertEqual(len(mgr.get_online_users()), 2)

    def test_resolve_session_for_connection(self):
        mgr = ConnectionManager(kick_policy=KickPolicy.NONE)
        _run(
            mgr.register(
                self._make_ws(),
                "u1",
                "t1",
                "d1",
                metadata={"dm_scope": "per-peer", "peer_id": "peer-123"},
            )
        )
        session = mgr.resolve_session_for_connection(
            user_id="u1",
            device_id="d1",
            lobster_id="echoer",
        )
        self.assertIsNotNone(session)
        assert session is not None
        self.assertEqual(session.mode, "per-peer")
        self.assertEqual(session.peer_id, "peer-123")


class TestKickPolicy(unittest.TestCase):
    def test_policy_values(self):
        self.assertEqual(KickPolicy.NONE, "none")
        self.assertEqual(KickPolicy.SAME_DEVICE_KICK, "same_device")
        self.assertEqual(KickPolicy.SAME_PLATFORM_KICK, "same_platform")
        self.assertEqual(KickPolicy.SINGLE_SESSION, "single_session")


if __name__ == "__main__":
    unittest.main()
