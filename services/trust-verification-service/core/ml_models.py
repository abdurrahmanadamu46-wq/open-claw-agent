"""
异常检测模型加载与推理（可选扩展）
例如 Isolation Forest 等轻量模型，用于对延迟/时长/轨迹等特征做异常分。
当前为占位实现，生产可接入训练好的行为基线模型。
"""
from typing import Any

import numpy as np


def load_anomaly_detector(config: dict[str, Any] | None = None) -> Any:
    """
    加载异常检测模型。可选：
    - sklearn.ensemble.IsolationForest
    - 自研行为基线（延迟分布、动作序列 n-gram 等）
    config 可包含 model_path、contamination、n_estimators 等。
    """
    # 占位：实际可反序列化 joblib/pickle 或 ONNX
    return None


def predict_anomaly_score(
    model: Any,
    features: np.ndarray,
) -> float:
    """
    输入特征向量（如 [delay_mean, delay_var, like_per_min, ...]），返回 0~1 异常分。
    若 model 为 None，直接返回 0.0（不启用 ML 分支）。
    """
    if model is None:
        return 0.0
    # 示例：Isolation Forest 的 decision_function 或 score_samples 转成 0~1
    # score = model.decision_function(features.reshape(1, -1))[0]
    # return 1.0 / (1.0 + np.exp(-score))  # sigmoid 等
    return 0.0
