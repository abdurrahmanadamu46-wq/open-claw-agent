# CODEX TASK: shadcn/ui Form 验证体系 — zod + react-hook-form 统一规范

**优先级：P1**  
**来源借鉴：shadcn/ui Form（react-hook-form + zod + FormMessage 完整集成）**  
**参考分析：`docs/SHADCN_UI_BORROWING_ANALYSIS.md` 第三节 3.1**

---

## 背景

我们的表单（龙虾配置/Feature Flag 配置/代理商入驻/渠道账号绑定）目前各自为政，没有统一的验证规范：有的用原生 `useState`，有的没有验证，错误信息展示不统一，提交时无 loading 状态。

shadcn/ui Form 体系（react-hook-form + zod + FormField/FormMessage）是业界最佳实践，一次建立，所有表单受益。

---

## 任务目标

1. 安装 `react-hook-form` + `zod` + `@hookform/resolvers`
2. 建立统一 Form 规范（FormField / FormLabel / FormMessage / FormDescription）
3. 为3个核心表单实现 zod schema + Form 组件：
   - **龙虾配置表单**（Config 标签）
   - **Feature Flag 创建/编辑表单**
   - **代理商入驻信息表单**（第一步）

---

## 一、安装依赖

```bash
npm install react-hook-form zod @hookform/resolvers
npx shadcn@latest add form
```

---

## 二、Form 规范说明

### shadcn/ui Form 标准模式：

```typescript
// 模板结构（所有表单遵循此规范）
const schema = z.object({...});
type FormValues = z.infer<typeof schema>;

const form = useForm<FormValues>({
  resolver: zodResolver(schema),
  defaultValues: {...},
});

<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)}>
    <FormField
      control={form.control}
      name="field_name"
      render={({ field }) => (
        <FormItem>
          <FormLabel>字段标签</FormLabel>
          <FormControl>
            <Input {...field} />
          </FormControl>
          <FormDescription>辅助说明文字</FormDescription>
          <FormMessage />  {/* 自动展示 zod 错误 */}
        </FormItem>
      )}
    />
    <Button type="submit" disabled={form.formState.isSubmitting}>
      {form.formState.isSubmitting ? '提交中...' : '保存'}
    </Button>
  </form>
</Form>
```

---

## 三、龙虾配置表单（`LobsterConfigForm.tsx`）

```typescript
// web/src/components/lobster/forms/LobsterConfigForm.tsx

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import {
  Form, FormControl, FormDescription, FormField,
  FormItem, FormLabel, FormMessage,
} from '@/components/ui/form';

// ── Schema ──
const lobsterConfigSchema = z.object({
  display_name: z.string().min(1, '显示名不能为空').max(20, '最多20个字符'),
  description: z.string().max(200, '描述最多200字').optional(),
  max_tokens: z.number()
    .min(100, '最少100 tokens')
    .max(8192, '最多8192 tokens'),
  temperature: z.number()
    .min(0, '最小值 0')
    .max(2, '最大值 2'),
  prompt_version: z.string().min(1, '请选择 Prompt 版本'),
  edge_compatible: z.boolean(),
  max_concurrent: z.number().int().min(1).max(10),
});

type LobsterConfigValues = z.infer<typeof lobsterConfigSchema>;

interface LobsterConfigFormProps {
  lobster: Lobster;
  onSave: (values: LobsterConfigValues) => Promise<void>;
}

export function LobsterConfigForm({ lobster, onSave }: LobsterConfigFormProps) {
  const form = useForm<LobsterConfigValues>({
    resolver: zodResolver(lobsterConfigSchema),
    defaultValues: {
      display_name: lobster.display_name,
      description: lobster.description,
      max_tokens: lobster.config?.max_tokens ?? 2048,
      temperature: lobster.config?.temperature ?? 0.7,
      prompt_version: lobster.annotations?.['openclaw/prompt-version'] ?? 'v1',
      edge_compatible: lobster.annotations?.['openclaw/edge-compatible'] === 'true',
      max_concurrent: lobster.config?.max_concurrent ?? 3,
    },
  });
  
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSave)} className="space-y-6">
        
        {/* 显示名 */}
        <FormField
          control={form.control}
          name="display_name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>显示名称</FormLabel>
              <FormControl>
                <Input {...field} placeholder="如：墨小雅" />
              </FormControl>
              <FormDescription>在 Operations Console 中显示的名称</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* 描述 */}
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>描述</FormLabel>
              <FormControl>
                <Textarea {...field} placeholder="龙虾的主要职责和能力描述..." rows={3} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* Max Tokens */}
        <FormField
          control={form.control}
          name="max_tokens"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Max Tokens</FormLabel>
              <FormControl>
                <Input
                  type="number"
                  {...field}
                  onChange={e => field.onChange(parseInt(e.target.value))}
                />
              </FormControl>
              <FormDescription>单次 LLM 调用的最大 Token 数（100-8192）</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* Temperature */}
        <FormField
          control={form.control}
          name="temperature"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Temperature：{field.value}</FormLabel>
              <FormControl>
                <Slider
                  min={0} max={2} step={0.1}
                  value={[field.value]}
                  onValueChange={([v]) => field.onChange(v)}
                  aria-label="Temperature 创意度"
                />
              </FormControl>
              <FormDescription>
                0 = 精确稳定 | 1 = 均衡 | 2 = 极度创意
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* Prompt Version */}
        <FormField
          control={form.control}
          name="prompt_version"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Prompt 版本</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger>
                    <SelectValue placeholder="选择版本" />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="v1">v1（稳定）</SelectItem>
                  <SelectItem value="v2">v2（实验中）</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />
        
        {/* 边缘兼容 */}
        <FormField
          control={form.control}
          name="edge_compatible"
          render={({ field }) => (
            <FormItem className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <FormLabel>边缘节点兼容</FormLabel>
                <FormDescription>开启后此龙虾可在边缘节点离线执行</FormDescription>
              </div>
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} />
              </FormControl>
            </FormItem>
          )}
        />
        
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => form.reset()}>
            重置
          </Button>
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                保存中...
              </span>
            ) : '保存配置'}
          </Button>
        </div>
      </form>
    </Form>
  );
}
```

---

## 四、Feature Flag 创建/编辑表单（`FeatureFlagForm.tsx`）

```typescript
// web/src/components/feature-flags/FeatureFlagForm.tsx

const featureFlagSchema = z.object({
  flag_key: z.string()
    .min(1, '标识符不能为空')
    .regex(/^[a-z][a-z0-9_.]*$/, '只允许小写字母、数字、点和下划线，以字母开头')
    .max(100, '最多100个字符'),
  description: z.string().max(500).optional(),
  flag_type: z.enum(['boolean', 'gradual', 'user_segment']),
  rollout_percent: z.number().min(0).max(100).optional(),
  enabled: z.boolean(),
  tenant_scope: z.enum(['all', 'specific', 'plan']),
});

type FeatureFlagValues = z.infer<typeof featureFlagSchema>;

export function FeatureFlagForm({ flag, onSave, mode = 'create' }) {
  const form = useForm<FeatureFlagValues>({
    resolver: zodResolver(featureFlagSchema),
    defaultValues: flag ? {
      flag_key: flag.flag_key,
      description: flag.description,
      flag_type: flag.flag_type,
      rollout_percent: flag.rollout_percent ?? 0,
      enabled: flag.enabled,
      tenant_scope: flag.tenant_scope ?? 'all',
    } : {
      flag_key: '',
      description: '',
      flag_type: 'boolean',
      rollout_percent: 0,
      enabled: false,
      tenant_scope: 'all',
    },
  });
  
  const flagType = form.watch('flag_type');
  
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSave)} className="space-y-5">
        
        <FormField control={form.control} name="flag_key" render={({ field }) => (
          <FormItem>
            <FormLabel>标识符 <span className="text-destructive">*</span></FormLabel>
            <FormControl>
              <Input {...field} placeholder="lobster.inkwriter.prompt_v2" disabled={mode === 'edit'} />
            </FormControl>
            <FormDescription>一旦创建不可修改，格式：模块.功能.子项</FormDescription>
            <FormMessage />
          </FormItem>
        )} />
        
        <FormField control={form.control} name="flag_type" render={({ field }) => (
          <FormItem>
            <FormLabel>开关类型</FormLabel>
            <Select onValueChange={field.onChange} defaultValue={field.value}>
              <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
              <SelectContent>
                <SelectItem value="boolean">全量开关（开/关）</SelectItem>
                <SelectItem value="gradual">灰度发布（百分比）</SelectItem>
                <SelectItem value="user_segment">用户分组</SelectItem>
              </SelectContent>
            </Select>
            <FormMessage />
          </FormItem>
        )} />
        
        {/* 灰度比例（仅 gradual 类型显示）*/}
        {flagType === 'gradual' && (
          <FormField control={form.control} name="rollout_percent" render={({ field }) => (
            <FormItem>
              <FormLabel>发布比例：{field.value}%</FormLabel>
              <FormControl>
                <Slider
                  min={0} max={100} step={5}
                  value={[field.value ?? 0]}
                  onValueChange={([v]) => field.onChange(v)}
                  aria-label="灰度发布比例"
                />
              </FormControl>
              <FormDescription>当前比例的租户将看到此功能</FormDescription>
              <FormMessage />
            </FormItem>
          )} />
        )}
        
        <FormField control={form.control} name="enabled" render={({ field }) => (
          <FormItem className="flex items-center justify-between rounded-lg border p-3">
            <div>
              <FormLabel>立即启用</FormLabel>
              <FormDescription>创建后是否立即对目标用户生效</FormDescription>
            </div>
            <FormControl>
              <Switch checked={field.value} onCheckedChange={field.onChange} />
            </FormControl>
          </FormItem>
        )} />
        
        <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
          {form.formState.isSubmitting ? '保存中...' : mode === 'create' ? '创建开关' : '保存修改'}
        </Button>
      </form>
    </Form>
  );
}
```

---

## 五、代理商入驻 Step 1 表单（`OnboardingStep1Form.tsx`）

```typescript
// web/src/components/onboarding/OnboardingStep1Form.tsx

const step1Schema = z.object({
  brand_name: z.string().min(2, '品牌名至少2个字').max(50),
  contact_name: z.string().min(1, '联系人姓名不能为空'),
  contact_email: z.string().email('请输入有效的邮箱地址'),
  contact_phone: z.string().regex(/^1[3-9]\d{9}$/, '请输入有效的中国手机号').optional(),
  domain: z.string()
    .regex(/^[a-z0-9-]+\.[a-z]{2,}$/, '请输入有效的域名，如 myagency.com')
    .optional()
    .or(z.literal('')),
  business_type: z.enum(['自媒体机构', '营销服务商', '企业市场部', '个人创作者', '其他']),
  team_size: z.enum(['1-5人', '6-20人', '21-100人', '100人以上']),
  referral_code: z.string().max(20).optional(),
});

type Step1Values = z.infer<typeof step1Schema>;

export function OnboardingStep1Form({ onNext }: { onNext: (values: Step1Values) => void }) {
  const form = useForm<Step1Values>({
    resolver: zodResolver(step1Schema),
    defaultValues: {
      brand_name: '', contact_name: '', contact_email: '',
      business_type: '营销服务商', team_size: '6-20人',
    },
  });
  
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onNext)} className="space-y-4">
        
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="brand_name" render={({ field }) => (
            <FormItem>
              <FormLabel>品牌/机构名称 <span className="text-destructive">*</span></FormLabel>
              <FormControl><Input {...field} placeholder="如：星辰内容工作室" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          
          <FormField control={form.control} name="domain" render={({ field }) => (
            <FormItem>
              <FormLabel>自有域名</FormLabel>
              <FormControl><Input {...field} placeholder="myagency.com（选填）" /></FormControl>
              <FormDescription>用于白标配置</FormDescription>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="contact_name" render={({ field }) => (
            <FormItem>
              <FormLabel>负责人姓名 <span className="text-destructive">*</span></FormLabel>
              <FormControl><Input {...field} placeholder="张经理" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          
          <FormField control={form.control} name="contact_email" render={({ field }) => (
            <FormItem>
              <FormLabel>联系邮箱 <span className="text-destructive">*</span></FormLabel>
              <FormControl><Input {...field} type="email" placeholder="contact@example.com" /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        
        <div className="grid grid-cols-2 gap-4">
          <FormField control={form.control} name="business_type" render={({ field }) => (
            <FormItem>
              <FormLabel>业务类型</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  {['自媒体机构','营销服务商','企业市场部','个人创作者','其他'].map(v => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
          
          <FormField control={form.control} name="team_size" render={({ field }) => (
            <FormItem>
              <FormLabel>团队规模</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                <SelectContent>
                  {['1-5人','6-20人','21-100人','100人以上'].map(v => (
                    <SelectItem key={v} value={v}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />
        </div>
        
        <Button type="submit" disabled={form.formState.isSubmitting} className="w-full">
          下一步：选择套餐 →
        </Button>
      </form>
    </Form>
  );
}
```

---

## 六、PROJECT_CONTROL_CENTER.md 同步

完成后更新第七节"已落地借鉴清单"：
```
| shadcn/ui | Form 验证体系（zod + react-hook-form + FormMessage）| ✅ | LobsterConfigForm, FeatureFlagForm, OnboardingStep1Form |
```

---

## 验收标准

- [ ] `react-hook-form` + `zod` + `@hookform/resolvers` 安装完成
- [ ] shadcn/ui `form` 组件安装完成
- [ ] `LobsterConfigForm.tsx`：Temperature Slider + Prompt版本 Select + edge_compatible Switch
- [ ] `LobsterConfigForm` 的 zod 错误在字段下方自动展示（FormMessage）
- [ ] `FeatureFlagForm.tsx`：flag_key 格式验证 + gradual 类型时显示 rollout Slider
- [ ] `OnboardingStep1Form.tsx`：邮箱格式验证 + 手机号格式验证
- [ ] 所有表单提交中禁用提交按钮并显示 loading 状态
- [ ] 所有表单重置功能正常（`form.reset()`）
- [ ] LobsterConfigForm 集成到龙虾详情页 Config 标签
- [ ] FeatureFlagForm 集成到 Feature Flag 管理页创建/编辑 Sheet
- [ ] OnboardingStep1Form 集成到代理商入驻向导第一步

---

*Codex Task | 来源：SHADCN_UI_BORROWING_ANALYSIS.md P1-#3 | 2026-04-02*
