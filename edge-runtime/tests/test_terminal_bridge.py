import asyncio
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from terminal_bridge import TerminalBridge


class TerminalBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_non_whitelist_command(self):
        bridge = TerminalBridge()
        output = await bridge.execute_safe_command("rm -rf /")
        self.assertIn("不在白名单", output)

    async def test_status_command_returns_runtime_details(self):
        bridge = TerminalBridge()
        output = await bridge.execute_safe_command("status")
        self.assertIn("[STATUS]", output)
        self.assertIn("python=", output)

    async def test_stream_logs_reads_initial_lines(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            log_path = Path(tmpdir) / "edge.log"
            log_path.write_text("line-1\nline-2\n", encoding="utf-8")
            bridge = TerminalBridge(str(log_path))
            stream = bridge.stream_logs("sess-1", lines=2)
            first_chunk = await anext(stream)
            self.assertIn("line-1", first_chunk)
            await bridge.stop_session("sess-1")
            with self.assertRaises(StopAsyncIteration):
                while True:
                    await anext(stream)


if __name__ == "__main__":
    unittest.main()
