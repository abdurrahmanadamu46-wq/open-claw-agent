# CODEX TASK: Refine 运营控制台 CRUD 框架
**任务ID**: CODEX-REFINE-P1-001  
**优先级**: 🟠 P1（运营后台：龙虾管理、账号管理、SOP模板管理 CRUD 页面）  
**依赖文件**: `dragon-senate-saas-v2/app.py`（FastAPI 后端）  
**参考项目**: Refine（https://github.com/refinedev/refine）— React CRUD 管理框架  
**预计工期**: 2天

---

## 一、当前痛点

**现在所有运营操作都通过 API/命令行**，没有管理后台 UI：
- 龙虾配置修改 → 手动改 YAML/JSON
- 账号管理（添加小红书/抖音账号）→ 手动写数据库
- SOP 模板管理 → 手动编辑 YAML 文件
- 租户管理 → 无 UI
- 工作流管理 → 无 UI

**Refine 优势**（vs 从零写管理后台）：
- 声明式 CRUD：定义 Resource → 自动生成 List/Create/Edit/Show 页面
- 内置 Auth/Router/Data Provider 架构
- 支持 Ant Design / MUI / Chakra 等 UI 库
- REST API / GraphQL / Custom data provider 全兼容
- 减少 70% 管理后台开发量

---

## 二、需要管理的 Resource（CRUD实体）

| Resource | 列表字段 | 操作 | 对应后端 |
|----------|---------|------|---------|
| **龙虾(Lobster)** | 名字、角色、状态、成功率 | 查看/编辑配置/重启 | lobster_pool_manager |
| **账号(Account)** | 平台、账号名、状态、绑定节点 | 增删改查 | 新建 account_manager |
| **SOP模板(SOPTemplate)** | 名称、平台、步骤数、版本 | 增删改查/测试执行 | sop_templates/ |
| **边缘节点(EdgeNode)** | 节点ID、IP、状态、任务数 | 查看/禁用/重启 | edge_registry |
| **租户(Tenant)** | 名称、套餐、龙虾数、用量 | 增删改查 | saas_billing |
| **工作流(Workflow)** | 名称、步骤数、触发方式 | 增删改查/执行 | workflow_event_log |
| **告警规则(AlertRule)** | 名称、条件、通知方式 | 增删改查 | alert_engine |

---

## 三、Refine + FastAPI 数据层

```tsx
// src/admin/App.tsx — Refine 入口

import { Refine } from "@refinedev/core";
import { ThemedLayoutV2, useNotificationProvider } from "@refinedev/antd";
import routerProvider from "@refinedev/react-router";
import dataProvider from "./providers/fastapi-data-provider";
import authProvider from "./providers/auth-provider";

// Resources
import { LobsterList, LobsterEdit, LobsterShow } from "./pages/lobsters";
import { AccountList, AccountCreate, AccountEdit } from "./pages/accounts";
import { SOPTemplateList, SOPTemplateCreate, SOPTemplateEdit } from "./pages/sop-templates";
import { EdgeNodeList, EdgeNodeShow } from "./pages/edge-nodes";
import { TenantList, TenantCreate, TenantEdit } from "./pages/tenants";

function App() {
  return (
    <Refine
      dataProvider={dataProvider("/api/admin")}
      authProvider={authProvider}
      routerProvider={routerProvider}
      notificationProvider={useNotificationProvider()}
      resources={[
        {
          name: "lobsters",
          list: "/lobsters",
          edit: "/lobsters/:id/edit",
          show: "/lobsters/:id",
          meta: { label: "🦞 龙虾管理", icon: "🦞" },
        },
        {
          name: "accounts",
          list: "/accounts",
          create: "/accounts/create",
          edit: "/accounts/:id/edit",
          meta: { label: "📱 账号管理" },
        },
        {
          name: "sop-templates",
          list: "/sop-templates",
          create: "/sop-templates/create",
          edit: "/sop-templates/:id/edit",
          meta: { label: "📋 SOP模板" },
        },
        {
          name: "edge-nodes",
          list: "/edge-nodes",
          show: "/edge-nodes/:id",
          meta: { label: "🖥️ 边缘节点" },
        },
        {
          name: "tenants",
          list: "/tenants",
          create: "/tenants/create",
          edit: "/tenants/:id/edit",
          meta: { label: "🏢 租户管理" },
        },
      ]}
    >
      <ThemedLayoutV2 Title={() => <span>OpenClaw 运营控制台</span>}>
        {/* Routes */}
      </ThemedLayoutV2>
    </Refine>
  );
}
```

---

## 四、FastAPI Data Provider

```tsx
// src/admin/providers/fastapi-data-provider.ts
/**
 * Refine DataProvider 对接 FastAPI 后端
 * 
 * Refine CRUD 操作 → FastAPI REST API 映射：
 * getList   → GET    /api/admin/{resource}?page=1&pageSize=10
 * getOne    → GET    /api/admin/{resource}/{id}
 * create    → POST   /api/admin/{resource}
 * update    → PUT    /api/admin/{resource}/{id}
 * deleteOne → DELETE /api/admin/{resource}/{id}
 */

import { DataProvider } from "@refinedev/core";

const fastApiDataProvider = (apiUrl: string): DataProvider => ({
  getList: async ({ resource, pagination, filters, sorters }) => {
    const params = new URLSearchParams();
    if (pagination) {
      params.set("page", String(pagination.current || 1));
      params.set("page_size", String(pagination.pageSize || 10));
    }
    if (sorters?.length) {
      params.set("sort_by", sorters[0].field);
      params.set("sort_order", sorters[0].order);
    }
    
    const response = await fetch(`${apiUrl}/${resource}?${params}`);
    const data = await response.json();
    
    return {
      data: data.items,
      total: data.total,
    };
  },

  getOne: async ({ resource, id }) => {
    const response = await fetch(`${apiUrl}/${resource}/${id}`);
    const data = await response.json();
    return { data };
  },

  create: async ({ resource, variables }) => {
    const response = await fetch(`${apiUrl}/${resource}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(variables),
    });
    const data = await response.json();
    return { data };
  },

  update: async ({ resource, id, variables }) => {
    const response = await fetch(`${apiUrl}/${resource}/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(variables),
    });
    const data = await response.json();
    return { data };
  },

  deleteOne: async ({ resource, id }) => {
    const response = await fetch(`${apiUrl}/${resource}/${id}`, {
      method: "DELETE",
    });
    const data = await response.json();
    return { data };
  },
});

export default fastApiDataProvider;
```

---

## 五、后端 Admin API

```python
# dragon-senate-saas-v2/api_admin_crud.py（新建）
"""
运营控制台 CRUD API
对接 Refine DataProvider，标准化分页/筛选/排序
"""

from fastapi import APIRouter, Query
from typing import Optional

admin_router = APIRouter(prefix="/api/admin")


@admin_router.get("/lobsters")
async def list_lobsters(
    page: int = Query(1),
    page_size: int = Query(10),
):
    """龙虾列表"""
    all_lobsters = await lobster_pool_manager.all_status()
    return {
        "items": all_lobsters[(page-1)*page_size : page*page_size],
        "total": len(all_lobsters),
    }


@admin_router.get("/lobsters/{lobster_id}")
async def get_lobster(lobster_id: str):
    """龙虾详情"""
    return await lobster_pool_manager.get_status(lobster_id)


@admin_router.put("/lobsters/{lobster_id}")
async def update_lobster(lobster_id: str, body: dict):
    """更新龙虾配置"""
    return await lobster_pool_manager.update_config(lobster_id, body)


@admin_router.get("/accounts")
async def list_accounts(page: int = 1, page_size: int = 10):
    """账号列表"""
    # 对接 account_manager
    pass


@admin_router.post("/accounts")
async def create_account(body: dict):
    """新建账号"""
    pass


@admin_router.get("/sop-templates")
async def list_sop_templates(page: int = 1, page_size: int = 10):
    """SOP模板列表"""
    # 读取 sop_templates/ 目录下所有 YAML
    pass


@admin_router.get("/edge-nodes")
async def list_edge_nodes(page: int = 1, page_size: int = 10):
    """边缘节点列表（对接 EdgeRegistry）"""
    from edge_registry import get_edge_registry
    registry = await get_edge_registry()
    nodes = await registry.list_online_nodes()
    return {"items": nodes, "total": len(nodes)}
```

---

## 六、验收标准

- [ ] Refine App 启动，侧边栏显示所有 Resource 菜单
- [ ] 龙虾管理：List 页展示10只龙虾状态；Edit 页可修改提示词/配置
- [ ] 账号管理：CRUD 全流程（添加小红书账号→编辑→删除）
- [ ] SOP模板管理：列表展示 + 创建新 SOP（YAML 编辑器）
- [ ] 边缘节点：只读列表（对接 Valkey EdgeRegistry）
- [ ] 租户管理：CRUD + 套餐选择（对接 saas_billing）
- [ ] FastAPI DataProvider 正确处理分页/排序
- [ ] Auth：登录态校验（对接 Keycloak/JWT）
