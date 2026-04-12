# ClawCommerce 基础设施与 DevOps 交付库

- **目标**：企业级生产就绪、一键部署、监控零死角、支持水平扩展
- **范围**：Docker / Docker Compose / K8s / GitHub Actions / Prometheus / Grafana / 成本脚本

## 目录

| 目录 | 说明 |
|------|------|
| `docker/` | 各服务 Dockerfile（Agent、Web、后端由对应仓库提供） |
| `docker-compose.yml` | 本地/联调一键启动（Redis + Agent + Web；后端独立仓库） |
| `k8s/` | Kubernetes 生产清单（多可用区、HPA） |
| `github-actions/` | CI/CD 工作流 |
| `monitoring/` | Prometheus + Grafana 配置与 Dashboard JSON |
| `scripts/` | 部署、健康检查、成本优化、备份 |
| `terraform/` | 可选 IaC（阿里云/火山云 中国大陆区，可自由选择） |

## 使用方式

1. **本地 Demo（老板先看再买服务器）**：先配 hosts（见 `hosts.example`），再执行  
   `docker compose -f textinfra/docker-compose.local.yml up -d`  
   详见 **[LOCAL_DEMO.md](./LOCAL_DEMO.md)**。
2. 本地联调（端口直连）：`docker compose -f textinfra/docker-compose.yml up -d`
3. 生产部署：见 `textinfra/k8s/README.md` 与 `scripts/deploy.sh`
4. 健康检查：`./scripts/health-check.sh`
