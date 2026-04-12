# Edge Runtime — OpenClaw Agent

Executor-only modules that run on edge nodes (Windows machines with browsers).  
These modules receive commands from the cloud control plane and execute them locally using Playwright + BBP Kernel for human-like browser automation.

## Architecture Boundary

**Edge runtime is executor-only.** It:
- ✅ Receives SOP packets from cloud via WebSocket
- ✅ Resolves DOM selectors to screen coordinates
- ✅ Executes browser actions with human-like mouse/keyboard behavior
- ✅ Reports progress and results back to cloud
- ❌ Never makes strategy/content decisions
- ❌ Never calls LLMs directly

## Modules

### `wss_receiver.py` — WebSocket Client
Connects to the Fleet WebSocket Gateway, maintains heartbeat, receives `execute_task` / `execute_behavior_session` commands, and dispatches them to registered handlers.

```python
from wss_receiver import WSSReceiver

receiver = WSSReceiver(
    gateway_url="wss://fleet-gw.openclaw.io/edge",
    node_id="node-001",
    edge_secret="your-secret",
)

async def handle_task(payload: dict) -> dict:
    # Execute the task...
    return {"status": "done"}

receiver.on_task(handle_task)
```

### `context_navigator.py` — Selector Resolution
Resolves cloud-issued target selectors (CSS, XPath, text hints, coordinate hints) into concrete `(x, y)` screen coordinates for the BBP Kernel.

Supported selector formats:
| Format | Example | Description |
|--------|---------|-------------|
| CSS | `.submit-btn`, `#editor` | Standard CSS selector |
| XPath | `//div[@class='editor']` | XPath expression |
| Text | `text:发布` | Match by visible text |
| Coordinate | `xy:100,200` | Direct coordinate hint |

```python
from context_navigator import ContextNavigator

nav = ContextNavigator(viewport=(1920, 1080))
resolution = await nav.resolve("text:发布", page=playwright_page)
print(resolution.center_x, resolution.center_y)
```

### `marionette_executor.py` — SOP Step Runner
Executes `MarionetteSopPacket` steps sequentially with human-like timing. Integrates ContextNavigator for target resolution and BBP Kernel for mouse trajectories.

Supported actions:
- `WAIT` — Pause for specified milliseconds
- `NAVIGATE` — Go to URL
- `CLICK_SELECTOR` — Click element with human-like mouse trajectory
- `INPUT_TEXT` — Type text with realistic per-character timing
- `SCROLL` — Scroll page
- `SCREENSHOT` — Capture screenshot
- `UPLOAD_VIDEO` / `UPLOAD_IMAGE` — Upload files
- `DOWNLOAD_ASSET` — Download from URL
- `GRAB_SOURCE` — Extract page content
- `REPORT_BACK` — Report status

## Testing

```bash
# Run all edge-runtime tests
python -m pytest edge-runtime/tests/ -v

# Run specific test file
python -m pytest edge-runtime/tests/test_context_navigator.py -v
```

## Dependencies

- Python 3.10+
- `playwright` (async API)
- `psutil` (optional, for system metrics in heartbeat)
- `bbp_kernel` (project internal — human-like mouse movement)
