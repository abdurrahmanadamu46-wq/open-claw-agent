# VoxCPM Service

独立语音能力服务，供 Dragon Senate 主工程通过 HTTP 调用。

当前阶段能力：

- `GET /healthz`
- `POST /v1/tts/synthesize`
- `POST /v1/tts/clone`

当前实现包含 `VOXCPM_FAKE_MODE` 开关，便于本地无 GPU / 无模型权重时做联调。

建议环境变量：

- `VOXCPM_MODEL_NAME=VoxCPM2`
- `VOXCPM_DEVICE=cuda:0`
- `VOXCPM_OUTPUT_DIR=/app/data/output`
- `VOXCPM_REFERENCE_DIR=/app/data/reference`
- `VOXCPM_ENABLE_CLONE=false`
- `VOXCPM_FAKE_MODE=true`

生产接入时请替换 `main.py` 中的 fake inference 逻辑，改成真实 VoxCPM 推理调用，并在 `requirements.txt` 中补齐官方依赖栈。
