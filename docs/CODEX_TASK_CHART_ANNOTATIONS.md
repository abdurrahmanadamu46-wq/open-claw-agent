# CODEX TASK: 图表事件标注（Annotations）— 审计日志联动监控图

**优先级：P1**  
**来源：GRAFANA_SIGNOZ_BORROWING_ANALYSIS.md P1-#2（Grafana Annotations）**

---

## 背景

运营人员查看质量评分趋势图时，看到分数突然下降，但不知道原因。Grafana Annotations 在时序图上打垂直标注线，标记关键事件（Prompt 升级/龙虾配置变更/系统部署）。我们借鉴此模式，让审计日志中的关键事件自动出现在监控图上。

---

## 一、Annotation 数据模型

```python
# dragon-senate-saas-v2/chart_annotation.py

from dataclasses import dataclass
from typing import Optional, Literal
from datetime import datetime

@dataclass
class ChartAnnotation:
    """图表事件标注"""
    id: str
    timestamp: datetime           # 事件发生时间
    label: str                    # 标注文字（简短）如 "Prompt v2"
    description: str              # 悬浮详情
    annotation_type: Literal[     # 标注类型
        "prompt_change",          # Prompt 版本变更
        "config_change",          # 龙虾配置变更
        "lobster_online",         # 新龙虾上线
        "deployment",             # 系统部署
        "edge_scale",             # 边缘节点扩容
        "incident",               # 故障
    ]
    severity: Literal["info", "warning", "critical"] = "info"
    lobster_id: Optional[str] = None   # 关联龙虾（None=全局）
    tenant_id: Optional[str] = None    # 关联租户（None=平台级）
    source_audit_log_id: Optional[str] = None  # 来源审计日志 ID

# 颜色映射
ANNOTATION_COLORS = {
    "prompt_change": "#6366f1",   # 紫色
    "config_change": "#f59e0b",   # 橙色
    "lobster_online": "#10b981",  # 绿色
    "deployment": "#3b82f6",      # 蓝色
    "edge_scale": "#06b6d4",      # 青色
    "incident": "#ef4444",        # 红色
}
```

---

## 二、自动从审计日志生成 Annotation

```python
# dragon-senate-saas-v2/annotation_sync.py

from .chart_annotation import ChartAnnotation, ANNOTATION_COLORS
from .audit_event_types import AuditEventType

# 审计事件 → Annotation 类型的映射
AUDIT_TO_ANNOTATION = {
    AuditEventType.LOBSTER_CONFIG_UPDATE: ("config_change", "info"),
    AuditEventType.PROMPT_VERSION_CHANGE: ("prompt_change", "warning"),
    AuditEventType.LOBSTER_CREATED: ("lobster_online", "info"),
    AuditEventType.DEPLOYMENT: ("deployment", "info"),
    AuditEventType.EDGE_NODE_ADDED: ("edge_scale", "info"),
    AuditEventType.INCIDENT_CREATED: ("incident", "critical"),
}

def audit_log_to_annotation(audit_log) -> Optional[ChartAnnotation]:
    """将审计日志转换为图表标注"""
    mapping = AUDIT_TO_ANNOTATION.get(audit_log.event_type)
    if not mapping:
        return None
    annotation_type, severity = mapping

    # 生成简短标签
    label_map = {
        "config_change": f"{audit_log.resource_name} 配置变更",
        "prompt_change": f"Prompt {audit_log.metadata.get('new_version', '')}",
        "lobster_online": f"{audit_log.resource_name} 上线",
        "deployment": f"部署 {audit_log.metadata.get('version', '')}",
        "edge_scale": f"边缘节点 {audit_log.metadata.get('node_id', '')} 接入",
        "incident": audit_log.metadata.get("title", "故障"),
    }

    return ChartAnnotation(
        id=f"ann_{audit_log.id}",
        timestamp=audit_log.created_at,
        label=label_map.get(annotation_type, audit_log.event_type),
        description=audit_log.description or "",
        annotation_type=annotation_type,
        severity=severity,
        lobster_id=audit_log.resource_id if audit_log.resource_type == "lobster" else None,
        tenant_id=audit_log.tenant_id,
        source_audit_log_id=audit_log.id,
    )
```

---

## 三、后端 Annotation API

```python
# dragon-senate-saas-v2/api_governance_routes.py 新增

@router.get("/chart/annotations")
async def get_chart_annotations(
    start_time: datetime,
    end_time: datetime,
    lobster_id: Optional[str] = None,
    annotation_types: Optional[str] = None,  # 逗号分隔
    tenant_context: TenantContext = Depends(get_tenant_context),
):
    """获取时间范围内的图表标注（用于在图表上叠加显示）"""
    # 从审计日志中查询相关事件
    query = db.query(AuditLog).filter(
        AuditLog.tenant_id == tenant_context.tenant_id,
        AuditLog.created_at.between(start_time, end_time),
        AuditLog.event_type.in_(list(AUDIT_TO_ANNOTATION.keys())),
    )
    if lobster_id:
        query = query.filter(
            (AuditLog.resource_id == lobster_id) | (AuditLog.resource_type == "platform")
        )
    if annotation_types:
        # 按标注类型过滤
        type_list = annotation_types.split(",")
        allowed_audit_types = [
            k for k, v in AUDIT_TO_ANNOTATION.items()
            if v[0] in type_list
        ]
        query = query.filter(AuditLog.event_type.in_(allowed_audit_types))

    annotations = [
        audit_log_to_annotation(log)
        for log in query.order_by(AuditLog.created_at).all()
        if audit_log_to_annotation(log)
    ]
    return {"annotations": [asdict(a) for a in annotations]}
```

---

## 四、前端：在图表上渲染 Annotation

```typescript
// web/src/components/charts/ChartAnnotations.tsx
// Recharts ReferenceLine 渲染标注线

import { ReferenceLine, Label } from 'recharts';

interface ChartAnnotation {
  id: string;
  timestamp: string;
  label: string;
  description: string;
  annotation_type: string;
  severity: 'info' | 'warning' | 'critical';
}

const ANNOTATION_COLORS: Record<string, string> = {
  prompt_change: '#6366f1',
  config_change: '#f59e0b',
  lobster_online: '#10b981',
  deployment: '#3b82f6',
  edge_scale: '#06b6d4',
  incident: '#ef4444',
};

interface ChartAnnotationsProps {
  annotations: ChartAnnotation[];
  xAxisKey?: string;  // 图表 x 轴的数据 key（如 "date"）
}

// 将 annotation timestamp 转为图表 x 轴对应值
function getXValue(annotation: ChartAnnotation, xAxisKey: string): string {
  // 简化：按日期格式化（与图表 x 轴一致）
  return new Date(annotation.timestamp).toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
  });
}

export function ChartAnnotationLines({
  annotations,
}: ChartAnnotationsProps) {
  return (
    <>
      {annotations.map(annotation => (
        <ReferenceLine
          key={annotation.id}
          x={getXValue(annotation, 'date')}
          stroke={ANNOTATION_COLORS[annotation.annotation_type] ?? '#888'}
          strokeDasharray="3 3"
          strokeWidth={1.5}
        >
          <Label
            value={annotation.label}
            position="insideTopRight"
            style={{
              fontSize: 10,
              fill: ANNOTATION_COLORS[annotation.annotation_type] ?? '#888',
            }}
          />
        </ReferenceLine>
      ))}
    </>
  );
}
```

```typescript
// web/src/hooks/useChartAnnotations.ts
// 获取 Annotation 数据的 Hook

export function useChartAnnotations({
  startTime,
  endTime,
  lobsterId,
}: {
  startTime: string;
  endTime: string;
  lobsterId?: string;
}) {
  const [annotations, setAnnotations] = useState<ChartAnnotation[]>([]);

  useEffect(() => {
    api.get('/v1/chart/annotations', {
      params: { start_time: startTime, end_time: endTime, lobster_id: lobsterId },
    }).then(res => setAnnotations(res.data.annotations));
  }, [startTime, endTime, lobsterId]);

  return annotations;
}
```

```typescript
// 在 QualityScoreChart 中集成 Annotations（示例）
export function QualityScoreChart({ data, lobsterId, timeRange }) {
  const annotations = useChartAnnotations({
    startTime: getStartTime(timeRange),
    endTime: new Date().toISOString(),
    lobsterId,
  });

  return (
    <ChartContainer config={chartConfig} className="h-[160px] w-full">
      <LineChart data={data}>
        {/* ... 原有配置 */}
        <ReferenceLine y={7.0} stroke="hsl(var(--destructive))" strokeDasharray="4 4" />
        {/* 注入 Annotation 标注线 */}
        <ChartAnnotationLines annotations={annotations} />
        <Line dataKey="score" ... />
      </LineChart>
    </ChartContainer>
  );
}
```

---

## 五、Annotation 图例说明

```typescript
// web/src/components/charts/AnnotationLegend.tsx
// 图表下方或右侧显示图例

export function AnnotationLegend({ annotations }: { annotations: ChartAnnotation[] }) {
  if (annotations.length === 0) return null;

  const grouped = Object.groupBy(annotations, a => a.annotation_type);

  return (
    <div className="flex flex-wrap gap-2 mt-2">
      {Object.entries(grouped).map(([type, items]) => (
        <div key={type} className="flex items-center gap-1 text-xs text-muted-foreground">
          <span
            className="inline-block w-3 h-0.5"
            style={{
              background: ANNOTATION_COLORS[type] ?? '#888',
              borderTop: `2px dashed ${ANNOTATION_COLORS[type] ?? '#888'}`,
            }}
          />
          <span>{items!.length} 个{ANNOTATION_LABEL_MAP[type] ?? type}</span>
        </div>
      ))}
    </div>
  );
}

const ANNOTATION_LABEL_MAP: Record<string, string> = {
  prompt_change: 'Prompt 变更',
  config_change: '配置变更',
  lobster_online: '龙虾上线',
  deployment: '系统部署',
  edge_scale: '边缘扩容',
  incident: '故障',
};
```

---

## 验收标准

- [ ] `ChartAnnotation` 数据模型定义（Python dataclass）
- [ ] `annotation_sync.py`：审计日志 → Annotation 映射（6种事件类型）
- [ ] `GET /v1/chart/annotations` API（支持时间范围/龙虾过滤/类型过滤）
- [ ] `ChartAnnotationLines` 组件（Recharts ReferenceLine + Label）
- [ ] `useChartAnnotations` Hook（按时间范围获取标注数据）
- [ ] `QualityScoreChart` 集成 Annotations（质量分趋势图上可见变更事件）
- [ ] `ExecutionTrendChart` 集成 Annotations（执行量趋势图上可见部署事件）
- [ ] `AnnotationLegend` 组件（图表下方显示标注图例）
- [ ] Prompt 版本变更时（`PROMPT_VERSION_CHANGE` 审计事件）自动生成紫色标注线
- [ ] 系统部署时（`DEPLOYMENT` 审计事件）自动生成蓝色标注线

---

*Codex Task | 来源：GRAFANA_SIGNOZ_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
