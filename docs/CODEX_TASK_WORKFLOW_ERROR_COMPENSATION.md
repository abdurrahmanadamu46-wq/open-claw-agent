# CODEX TASK: Error Workflow — 工作流失败补偿机制

**优先级：P1**  
**来源：N8N_BORROWING_ANALYSIS.md P1-#2（n8n Error Workflow）**

---

## 背景

工作流步骤失败时（LLM超时/渠道API错误/边缘节点断线），目前只记录错误，无任何自动补偿。借鉴 n8n Error Workflow 机制，每个工作流可配置"错误补偿工作流"，失败时自动触发降级逻辑。

---

## 一、WorkflowSchema 扩展

```python
# dragon-senate-saas-v2/workflow_schema.py — 新增 error_workflow_id

@dataclass
class WorkflowStep:
    step_id: str
    lobster_id: str
    skill_name: str
    input_mapping: dict
    output_key: str
    retry_count: int = 1           # 新增：步骤级重试次数
    retry_delay_seconds: int = 0   # 新增：重试间隔

@dataclass 
class WorkflowSchema:
    workflow_id: str
    name: str
    steps: List[WorkflowStep]
    # 新增字段
    error_workflow_id: Optional[str] = None   # 失败时触发此工作流
    error_notify_channels: List[str] = field(default_factory=list)  # 失败时通知渠道
```

---

## 二、执行引擎集成 Error Workflow

```python
# dragon-senate-saas-v2/lobster_runner.py

class LobsterRunner:

    async def run_workflow(self, workflow: WorkflowSchema, input_data: dict, tenant_id: str):
        execution_id = str(uuid.uuid4())
        failed_step = None
        error_context = None

        try:
            results = {}
            for step in workflow.steps:
                step_result = await self._run_step_with_retry(step, results, tenant_id)
                results[step.output_key] = step_result
            return results

        except WorkflowStepError as e:
            failed_step = e.step
            error_context = {
                "error_message": str(e.original_error),
                "error_type": type(e.original_error).__name__,
                "failed_step_id": failed_step.step_id,
                "failed_lobster_id": failed_step.lobster_id,
                "failed_skill_name": failed_step.skill_name,
                "workflow_id": workflow.workflow_id,
                "workflow_name": workflow.name,
                "execution_id": execution_id,
                "tenant_id": tenant_id,
                "original_input": input_data,
            }
            
            # 触发 Error Workflow
            if workflow.error_workflow_id:
                await self._trigger_error_workflow(
                    error_workflow_id=workflow.error_workflow_id,
                    error_context=error_context,
                    tenant_id=tenant_id,
                )
            
            # 直接通知渠道（无需单独 Error Workflow）
            if workflow.error_notify_channels:
                await self._notify_error(workflow.error_notify_channels, error_context)
            
            raise  # 重新抛出，让调用方知道失败了

    async def _run_step_with_retry(self, step: WorkflowStep, context: dict, tenant_id: str):
        """带重试的步骤执行"""
        last_error = None
        for attempt in range(step.retry_count + 1):
            try:
                if attempt > 0:
                    await asyncio.sleep(step.retry_delay_seconds * attempt)
                return await self._run_step(step, context, tenant_id)
            except Exception as e:
                last_error = e
                logger.warning(f"[WorkflowRunner] 步骤 {step.step_id} 第{attempt+1}次尝试失败: {e}")
        raise WorkflowStepError(step=step, original_error=last_error)

    async def _trigger_error_workflow(self, error_workflow_id: str, error_context: dict, tenant_id: str):
        """触发错误补偿工作流，注入错误上下文"""
        error_workflow = db.query(Workflow).filter(Workflow.id == error_workflow_id).first()
        if not error_workflow:
            logger.error(f"[ErrorWorkflow] 错误工作流 {error_workflow_id} 不存在")
            return
        
        logger.info(f"[ErrorWorkflow] 触发补偿工作流: {error_workflow.name}")
        # 将错误上下文作为新工作流的 input
        asyncio.create_task(
            self.run_workflow(
                workflow=error_workflow.schema,
                input_data={"error": error_context},
                tenant_id=tenant_id,
            )
        )
```

---

## 三、内置"通用错误通知"工作流模板

```yaml
# 系统内置的错误通知工作流模板（可直接配置为 error_workflow_id）
workflow_id: "system_error_notifier"
name: "通用错误通知"
steps:
  - step_id: "notify"
    lobster_id: "dispatcher-laojian"
    skill_name: "send_error_alert"
    input_mapping:
      error_message: "{{input.error.error_message}}"
      workflow_name: "{{input.error.workflow_name}}"
      failed_step: "{{input.error.failed_skill_name}}"
      execution_id: "{{input.error.execution_id}}"
    output_key: "notify_result"
```

---

## 四、前端：工作流配置页新增 Error Workflow 设置

```typescript
// web/src/app/workflows/[id]/edit/page.tsx
// 在工作流高级设置区域添加 Error Workflow 配置

<Card>
  <CardHeader>
    <CardTitle>失败处理</CardTitle>
    <CardDescription>工作流步骤失败时的补偿策略</CardDescription>
  </CardHeader>
  <CardContent className="space-y-4">
    {/* 错误工作流选择 */}
    <FormField name="error_workflow_id" render={({ field }) => (
      <FormItem>
        <FormLabel>错误补偿工作流（可选）</FormLabel>
        <Select onValueChange={field.onChange} value={field.value ?? ""}>
          <SelectTrigger>
            <SelectValue placeholder="选择失败时触发的补偿工作流" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">不配置</SelectItem>
            <SelectItem value="system_error_notifier">内置：错误通知</SelectItem>
            {userWorkflows.map(wf => (
              <SelectItem key={wf.id} value={wf.id}>{wf.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <FormDescription>
          失败时自动执行该工作流，并注入错误上下文（错误信息/失败步骤/执行ID）
        </FormDescription>
      </FormItem>
    )} />

    {/* 步骤级重试配置 */}
    <div className="rounded-md border p-3 space-y-2">
      <p className="text-sm font-medium">步骤重试策略</p>
      <div className="grid grid-cols-2 gap-3">
        <FormField name="default_retry_count" render={({ field }) => (
          <FormItem>
            <FormLabel>每步最多重试次数</FormLabel>
            <Select onValueChange={v => field.onChange(parseInt(v))} defaultValue="1">
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="0">不重试</SelectItem>
                <SelectItem value="1">1次</SelectItem>
                <SelectItem value="2">2次</SelectItem>
                <SelectItem value="3">3次</SelectItem>
              </SelectContent>
            </Select>
          </FormItem>
        )} />
        <FormField name="default_retry_delay" render={({ field }) => (
          <FormItem>
            <FormLabel>重试间隔（秒）</FormLabel>
            <Input type="number" min={0} max={300} defaultValue={30} {...field} />
          </FormItem>
        )} />
      </div>
    </div>
  </CardContent>
</Card>
```

---

## 验收标准

- [ ] `WorkflowSchema` 新增 `error_workflow_id` + `error_notify_channels` + 步骤级 `retry_count`/`retry_delay_seconds`
- [ ] `LobsterRunner._run_step_with_retry()`：步骤失败时按配置重试（指数退避）
- [ ] 步骤彻底失败后抛出 `WorkflowStepError`（含步骤引用 + 原始错误）
- [ ] `_trigger_error_workflow()`：将 error_context 注入新工作流并异步执行
- [ ] 系统内置 `system_error_notifier` 工作流模板（通用错误通知）
- [ ] 前端工作流编辑页新增"失败处理"配置区（错误工作流选择 + 重试次数）
- [ ] 错误工作流执行时，在执行历史中标记为 `error_compensation` 类型
- [ ] 错误上下文字段完整：error_message / error_type / failed_step / workflow_name / execution_id

---

*Codex Task | 来源：N8N_BORROWING_ANALYSIS.md P1-#2 | 2026-04-02*
