# 龙虾虾盘客户端设计（Desktop + Mobile）

## 1. 设计目标
- 客户侧最小操作：安装、授权、保持在线、提交验证码、查看线索与奖励。
- 云端集中智能：9 只龙虾负责策略、内容、调度、转化；边缘端不下放策略脑。
- 商业化友好：支持免费版传播（在线奖励兑换部分额度）+ 订阅版稳定运营。

## 2. 角色边界
### 客户端（Desktop/Mobile）
- 执行器与展示端
- 账号登录态维护（验证码中继）
- 心跳与在线时长上报
- 线索结果与奖励展示

### 云端（Senate + Backend）
- 任务策略与内容生成
- 行业知识池调用
- 风险控制与审批（HITL）
- 审计与回滚

## 3. 电脑端信息架构
1. 连接与授权
   - 激活码输入
   - 连接地址输入
   - 在线状态（connected/disconnected/error）
2. 养虾奖励中心
   - 在线时长（今日/累计）
   - 虾粮积分
   - 免费任务额度、免费 token 额度
   - 领取奖励按钮
3. 账号执行面板
   - 账号列表（抖音/小红书）
   - 当前执行动作（发布/监控/回传）
   - 一键暂停（高风险动作走审批）
4. 验证码中继
   - 待处理验证码请求队列
   - request_id + code 提交
   - 提交状态反馈
5. 线索回传快照
   - Hot/Warm 线索摘要
   - 来源与时间
6. 运行时与升级链路
   - 本地运行时版本
   - 签名 manifest 校验
   - 一键升级

## 4. 手机端信息架构（飞书优先）
1. 在线状态与告警
2. 验证码快速提交
3. HITL 审批（可批可拒）
4. 日报（线索、在线奖励、收益）

> 手机端主通道：飞书 Bot；网页轻面板作为补充。

## 5. 核心接口契约（客户端最小集）
- `POST /edge/register`
- `POST /edge/heartbeat`
- `GET /rewards/wallet`
- `POST /rewards/claim/free-pack`
- `GET /otp/pending`
- `POST /otp/submit`
- `POST /receive_dm_from_edge`

## 6. 无 GPU 客户模式
- 默认云端内容工厂（ComfyUI/libtv/WanVideo 在云端或算力池）
- 本地仅运行轻量执行器 + 审批/收码/回传
- 低配置电脑可稳定接入

## 7. 红线约束
- 高风险动作默认 HITL 审批，不走全自动
- 边缘节点只执行，不拥有策略脑
- 验证码仅中继，不持久化明文
- 所有关键动作可审计、可回滚、可复盘

## 8. 已落地文件
- 桌面端原型：`/apps/desktop-client/src/App.tsx`
- 网页端设计中心：`/web/src/app/client-center/page.tsx`
- 网页端手机原型：`/web/src/app/client-mobile/page.tsx`
- 侧边栏入口：`/web/src/components/layout/Sidebar.tsx`
