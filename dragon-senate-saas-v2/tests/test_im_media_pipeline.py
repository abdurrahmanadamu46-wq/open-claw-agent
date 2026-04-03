from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from channel_account_manager import ChannelAccount  # noqa: E402
from channel_account_manager import channel_account_manager  # noqa: E402
from im_media_pipeline import classify_media_type  # noqa: E402
from im_media_pipeline import extract_media_refs_from_output  # noqa: E402
from im_media_pipeline import send_media_to_channel  # noqa: E402


class ImMediaPipelineTestCase(unittest.TestCase):
    def setUp(self) -> None:
        channel_account_manager.register_account(
            ChannelAccount(
                account_id="acc-im-1",
                channel="feishu",
                tenant_id="tenant-a",
                enabled=True,
                options={},
            )
        )

    def test_extract_media_refs_from_output(self) -> None:
        output = """
        文案如下
        MEDIA: data/artifacts/demo.png
        ![cover](data/artifacts/cover.jpg)
        """
        refs = extract_media_refs_from_output(output)
        self.assertIn("data/artifacts/demo.png", refs)
        self.assertIn("data/artifacts/cover.jpg", refs)

    def test_classify_media_type(self) -> None:
        self.assertEqual(classify_media_type("demo.png"), "image")
        self.assertEqual(classify_media_type("demo.mp4"), "video")
        self.assertEqual(classify_media_type("demo.opus"), "audio")
        self.assertEqual(classify_media_type("demo.bin"), "file")

    def test_send_media_to_channel_with_allowlist(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = Path(tmpdir) / "demo.png"
            file_path.write_bytes(b"fake")
            with patch("im_media_pipeline.ALLOWED_OUTBOUND_DIRS", [Path(tmpdir)]):
                ok = asyncio.run(send_media_to_channel("feishu:acc-im-1", str(file_path), chat_id="chat-1"))
        self.assertTrue(ok)


if __name__ == "__main__":
    unittest.main()
