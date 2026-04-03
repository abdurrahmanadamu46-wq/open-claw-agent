# CTI Engine Service（威胁情报与女巫攻击检测）

防护**系统性、有组织的机房作弊（女巫攻击 Sybil Attack）**：成百上千虚假节点（同 IP 段、同 TTL/TCP 指纹、超高且一致的执行率）薅虾粮时，通过无监督聚类与硬性基线识别并处置。

## 能力概览

- **女巫检测**：对节点遥测（任务量、耗时、TTL、TCP 窗口等）做 StandardScaler + DBSCAN 聚类，同一集群视为机房团伙。
- **威胁评分**：机房 IP 黑名单、超人执行效率（如 >300 任务/小时且成功率 >99%）、聚类命中 → CRITICAL，并给出熔断动作。
- **蜜罐协议**：对女巫集群不直接封号，而是 `TRIGGER_HONEYPOT_PROTOCOL`，登记为蜜罐目标；调度下发脱敏/无价值任务，金算虾结算时余额置 0，消耗对方算力。

## 运行

```bash
pip install -r requirements.txt
cd cti-engine-service && python -m uvicorn main:app --host 0.0.0.0 --port 8030
# 或
python main.py
```

## 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `CTI_HOST` / `CTI_PORT` | 监听地址与端口 | `0.0.0.0` / `8030` |

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/v1/cti/analyze` | Body: `List[NodeTelemetryEvent]`，返回 `List[ThreatAlert]`；样本 >=10 时触发聚类 |
| GET | `/api/v1/cti/honeypot/targets` | 返回当前蜜罐目标节点 ID 列表 |
| DELETE | `/api/v1/cti/honeypot/targets/{node_id}` | 解除某节点蜜罐标记 |

## 与下游联动

- **WSS Hub**：将节点心跳/遥测推送到 `/api/v1/cti/analyze`。
- **点兵虾 / 调度**：查询 `/api/v1/cti/honeypot/targets`，对蜜罐节点仅下发垃圾任务。
- **金算虾 / CRM**：对 `action_taken in (BAN_NODE_PERMANENTLY, CONFISCATE_REWARDS)` 冻结提现；对蜜罐目标结算余额置 0、不发放虾粮。

## Docker

```bash
docker build -t cti-engine-service .
docker run -p 8030:8030 cti-engine-service
```

## 调参

- `core/sybil_detector.py`：DBSCAN 的 `eps`、`min_samples` 需按实际节点规模与分布调优。
- `core/threat_scorer.py`：`blacklisted_isps`、`superhuman_tasks_per_hour`、`superhuman_success_rate` 可按业务调整。生产环境黑名单建议从配置或风控库加载。
