"""
BBP Kernel — 生物行为物理引擎 (Biometric Behavior Physics)
将起止坐标转化为带菲茨定律、贝塞尔弧线与高斯抖动的人类鼠标轨迹。
适用于 PC 端 Playwright/Selenium 隐身模式；Android 可移植算法到 GestureDescription。
"""
import math
import random
from typing import List, Tuple


def _smoothstep(t: float) -> float:
    """Ease-in-out：慢-快-慢，符合菲茨定律的速度分布。"""
    t = max(0.0, min(1.0, t))
    return t * t * (3.0 - 2.0 * t)


def _cubic_bezier(t: float, p0: float, p1: float, p2: float, p3: float) -> float:
    """三次贝塞尔曲线 B(t) = (1-t)³P0 + 3(1-t)²t P1 + 3(1-t)t² P2 + t³ P3。"""
    u = 1.0 - t
    return u * u * u * p0 + 3.0 * u * u * t * p1 + 3.0 * u * t * t * p2 + t * t * t * p3


class HumanMouseMimic:
    """
    人类鼠标轨迹模拟器：贝塞尔曲线 + 高斯噪声 + 菲茨定律 + 可选越界折返。
    反作弊检测的是轨迹平滑度与时间分布，本类生成「慢-快-慢」且带轻微手抖的路径。
    """

    def __init__(
        self,
        noise_std: float = 1.5,
        overshoot_probability: float = 0.15,
        overshoot_scale: float = 0.08,
        fps: float = 60.0,
    ):
        self.noise_std = noise_std
        self.overshoot_probability = overshoot_probability
        self.overshoot_scale = overshoot_scale
        self.fps = fps

    def generate_trajectory(
        self,
        start_x: float,
        start_y: float,
        end_x: float,
        end_y: float,
        duration_ms: int,
    ) -> List[Tuple[int, int, int]]:
        """
        生成带时间戳的人类鼠标轨迹 (x, y, timestamp_ms)。
        - 基础路径：三次贝塞尔，控制点随机偏移，打破直线。
        - 时间分布：smoothstep 实现慢-快-慢。
        - 抖动：路径点上叠加高斯白噪声。
        - 约 15% 概率在终点后追加越界再折返点。
        """
        dx = end_x - start_x
        dy = end_y - start_y
        distance = math.hypot(dx, dy)
        if distance < 1e-6:
            return [(int(round(start_x)), int(round(start_y)), 0)]

        # 1. 随机控制点（制造弧度，避免完美直线）
        offset = distance * 0.2
        cp1_x = (
            start_x + dx * random.uniform(0.1, 0.4)
            + random.uniform(-offset, offset)
        )
        cp1_y = (
            start_y + dy * random.uniform(0.1, 0.4)
            + random.uniform(-offset, offset)
        )
        cp2_x = (
            start_x + dx * random.uniform(0.6, 0.9)
            + random.uniform(-offset, offset)
        )
        cp2_y = (
            start_y + dy * random.uniform(0.6, 0.9)
            + random.uniform(-offset, offset)
        )

        # 2. 采样点数（按时长与帧率）
        num_points = max(10, int((duration_ms / 1000.0) * self.fps))

        points: List[Tuple[int, int, int]] = []

        for i in range(num_points):
            linear_t = i / (num_points - 1) if num_points > 1 else 1.0
            # 菲茨定律：非线性时间，接近起点/终点时「时间流逝」更慢 → 点位更密
            t = _smoothstep(linear_t)

            x = _cubic_bezier(t, start_x, cp1_x, cp2_x, end_x)
            y = _cubic_bezier(t, start_y, cp1_y, cp2_y, end_y)

            # 3. 高斯噪声（手抖）
            x += random.gauss(0, self.noise_std)
            y += random.gauss(0, self.noise_std)

            # 时间戳也按 smoothstep 分布，使实际速度呈慢-快-慢
            ts = int(round(_smoothstep(linear_t) * duration_ms))
            points.append((int(round(x)), int(round(y)), ts))

        # 4. 约 15% 概率：越界 (Overshoot) 再折返
        if random.random() < self.overshoot_probability and num_points >= 2:
            points = self._append_overshoot(
                points, start_x, start_y, end_x, end_y, duration_ms
            )

        return points

    def _append_overshoot(
        self,
        points: List[Tuple[int, int, int]],
        start_x: float,
        start_y: float,
        end_x: float,
        end_y: float,
        duration_ms: int,
    ) -> List[Tuple[int, int, int]]:
        """在轨迹末尾追加越过终点再折回的点，模拟人类微调。"""
        dx = end_x - start_x
        dy = end_y - start_y
        dist = math.hypot(dx, dy)
        overshoot_dist = max(5.0, dist * self.overshoot_scale)
        # 沿运动方向 overshoot，再带一点随机偏角
        angle = math.atan2(dy, dx) + random.gauss(0, 0.15)
        ox = end_x + overshoot_dist * math.cos(angle)
        oy = end_y + overshoot_dist * math.sin(angle)

        last_ts = points[-1][2] if points else 0
        extra_ms = random.randint(40, 120)
        t1 = last_ts + extra_ms // 2
        t2 = last_ts + extra_ms

        out = list(points)
        out.append((int(round(ox)), int(round(oy)), t1))
        out.append((int(round(end_x)), int(round(end_y)), t2))
        return out

    def trajectory_variance(self, points: List[Tuple[int, int, int]]) -> float:
        """
        计算轨迹的「平滑度」指标，供遥测上报云端审计。
        方差过小表示过于直线/机器；人类轨迹应有明显波动。
        """
        if len(points) < 3:
            return 0.0
        xs = [p[0] for p in points]
        ys = [p[1] for p in points]
        n = len(points)
        mean_x = sum(xs) / n
        mean_y = sum(ys) / n
        var_x = sum((x - mean_x) ** 2 for x in xs) / n
        var_y = sum((y - mean_y) ** 2 for y in ys) / n
        return (var_x + var_y) / 1e4  # 归一化到约 0.x 量级便于上报
