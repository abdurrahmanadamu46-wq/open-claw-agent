import { FormEvent, useEffect, useMemo, useState } from "react";
import { useDesktopRuntime } from "./hooks/useDesktopRuntime";
import {
  getStoredActivationCode,
  getStoredServerUrl,
  useLobsterBrain,
  type LobsterStatus,
} from "./hooks/useLobsterBrain";
import "./App.css";

type RewardWallet = {
  points: number;
  free_runs_credit: number;
  free_tokens_credit: number;
  online_seconds_total: number;
  recent_edge_seconds: number;
  tier: string;
};

type OtpRequest = {
  request_id: string;
  platform: string;
  account_id: string | null;
  masked_target: string | null;
  purpose: string;
  status: string;
  expires_at: string | null;
  created_at: string;
};

const STATUS_LABEL: Record<LobsterStatus, string> = {
  idle: "未连接",
  connecting: "连接中",
  connected: "已连接元老院",
  disconnected: "已断开",
  error: "连接异常",
};

const DEFAULT_WALLET: RewardWallet = {
  points: 0,
  free_runs_credit: 0,
  free_tokens_credit: 0,
  online_seconds_total: 0,
  recent_edge_seconds: 0,
  tier: "seed",
};

const MOCK_OTP: OtpRequest[] = [
  {
    request_id: "otp_demo_001",
    platform: "douyin",
    account_id: "douyin_beauty_a",
    masked_target: "138****2026",
    purpose: "login",
    status: "pending",
    expires_at: null,
    created_at: new Date().toISOString(),
  },
];

const MOCK_LEADS = [
  { id: "L-101", source: "抖音评论", score: "Hot", content: "多少钱？可以私信吗？", at: "刚刚" },
  { id: "L-099", source: "小红书私信", score: "Warm", content: "有没有体验装，怎么买？", at: "5 分钟前" },
  { id: "L-094", source: "抖音私信", score: "Warm", content: "发一下详细参数和优惠", at: "14 分钟前" },
];

const ACCOUNT_ROWS = [
  { id: "acc-a", platform: "抖音", nickname: "美妆号A", status: "在线", tasks: "自动发布 + 评论监控" },
  { id: "acc-b", platform: "小红书", nickname: "种草号B", status: "在线", tasks: "私信监控 + 线索回传" },
  { id: "acc-c", platform: "抖音", nickname: "本地号C", status: "暂停", tasks: "仅保留登录态" },
];

function formatSeconds(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${h}h ${m}m ${s}s`;
}

function StatusDot({ status }: { status: LobsterStatus }) {
  const state =
    status === "connected"
      ? "on"
      : status === "connecting"
        ? "pending"
        : status === "error"
          ? "off"
          : "idle";
  return <span className="status-dot" data-state={state} title={STATUS_LABEL[status]} />;
}

function App() {
  const { status, errorMessage, connect, disconnect, serverUrl, setServerUrl } = useLobsterBrain();
  const runtime = useDesktopRuntime();

  const [activationCodeInput, setActivationCodeInput] = useState(() => getStoredActivationCode());
  const [serverUrlInput, setServerUrlInput] = useState(() => getStoredServerUrl());
  const [apiBaseUrl, setApiBaseUrl] = useState(() => getStoredServerUrl().replace(":38789", ":8000"));
  const [apiToken, setApiToken] = useState("");
  const [wallet, setWallet] = useState<RewardWallet>(DEFAULT_WALLET);
  const [walletError, setWalletError] = useState<string | null>(null);
  const [otpRequests, setOtpRequests] = useState<OtpRequest[]>(MOCK_OTP);
  const [otpMessage, setOtpMessage] = useState<string>("");
  const [otpSubmitId, setOtpSubmitId] = useState("");
  const [otpSubmitCode, setOtpSubmitCode] = useState("");
  const [claiming, setClaiming] = useState(false);
  const [submittingOtp, setSubmittingOtp] = useState(false);
  const [refreshingRemote, setRefreshingRemote] = useState(false);

  const onlineProgress = useMemo(() => {
    const hours = wallet.recent_edge_seconds / 3600;
    const percent = Math.min(100, Math.round((hours / 4) * 100));
    return { hours, percent };
  }, [wallet.recent_edge_seconds]);

  async function fetchJson<T>(path: string, method = "GET", body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (apiToken.trim()) {
      headers.Authorization = `Bearer ${apiToken.trim()}`;
    }

    const res = await fetch(`${apiBaseUrl.replace(/\/$/, "")}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${res.status} ${res.statusText}: ${text || "request failed"}`);
    }
    return (await res.json()) as T;
  }

  async function refreshRemoteData() {
    setRefreshingRemote(true);
    setWalletError(null);
    setOtpMessage("");
    try {
      const walletResp = await fetchJson<{ wallet?: RewardWallet; detail?: string }>("/rewards/wallet");
      if (walletResp.wallet) {
        setWallet(walletResp.wallet);
      } else {
        throw new Error(walletResp.detail || "wallet unavailable");
      }

      const otpResp = await fetchJson<{ items?: OtpRequest[]; detail?: string }>("/otp/pending?include_consumed=false");
      if (Array.isArray(otpResp.items)) {
        setOtpRequests(otpResp.items);
      } else {
        setOtpRequests(MOCK_OTP);
      }
    } catch (err) {
      setWalletError(err instanceof Error ? err.message : String(err));
      // 保底演示：不阻塞界面验证流程
      setWallet((prev) => ({
        ...prev,
        recent_edge_seconds: Math.max(prev.recent_edge_seconds, 5400),
        points: Math.max(prev.points, 120),
      }));
      setOtpRequests(MOCK_OTP);
    } finally {
      setRefreshingRemote(false);
    }
  }

  async function handleClaimFreePack() {
    setClaiming(true);
    try {
      const resp = await fetchJson<{
        ok: boolean;
        claim?: { points_delta: number; free_runs_delta: number; free_tokens_delta: number };
      }>("/rewards/claim/free-pack", "POST", { claim_type: "free_pack" });
      await refreshRemoteData();
      if (resp.ok) {
        setOtpMessage("领取成功：本次在线奖励已到账。");
      }
    } catch (err) {
      setOtpMessage(`领取失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setClaiming(false);
    }
  }

  async function handleSubmitOtp(e: FormEvent) {
    e.preventDefault();
    if (!otpSubmitId.trim() || !otpSubmitCode.trim()) {
      setOtpMessage("请填写 request_id 和验证码");
      return;
    }
    setSubmittingOtp(true);
    try {
      await fetchJson("/otp/submit", "POST", {
        request_id: otpSubmitId.trim(),
        code: otpSubmitCode.trim(),
      });
      setOtpMessage("验证码已提交到中央元老院，将由边缘节点继续完成登录。");
      setOtpSubmitCode("");
      await refreshRemoteData();
    } catch (err) {
      setOtpMessage(`验证码提交失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSubmittingOtp(false);
    }
  }

  useEffect(() => {
    runtime.refreshStatus().catch(() => undefined);
    refreshRemoteData().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="desktop-shell">
      <header className="topbar">
        <div>
          <h1>龙虾虾盘客户端</h1>
          <p>客户只需保持在线；云端 9 只龙虾负责策略、创作、分发与线索转化。</p>
        </div>
        <div className="status-pill">
          <StatusDot status={status} />
          <span>{STATUS_LABEL[status]}</span>
        </div>
      </header>

      <section className="grid two-col">
        <article className="card">
          <h2>连接与授权</h2>
          <p className="muted">安装后仅需绑定激活码并保持电脑在线，支持无 GPU 客户模式。</p>
          <label>
            边缘连接地址
            <input
              value={serverUrlInput}
              onChange={(e) => setServerUrlInput(e.target.value)}
              placeholder="http://127.0.0.1:38789"
            />
          </label>
          <label>
            节点激活码
            <input
              value={activationCodeInput}
              onChange={(e) => setActivationCodeInput(e.target.value)}
              placeholder="CLAW-XXXX-XXXX-XXXX"
            />
          </label>
          <div className="row">
            <button
              type="button"
              onClick={() => {
                setServerUrl(serverUrlInput);
                connect(activationCodeInput, serverUrlInput);
              }}
              disabled={status === "connecting"}
            >
              连接中央元老院
            </button>
            <button type="button" className="ghost" onClick={disconnect}>
              断开连接
            </button>
          </div>
          {errorMessage ? <p className="error">{errorMessage}</p> : null}
        </article>

        <article className="card">
          <h2>养虾奖励中心</h2>
          <p className="muted">保持在线可积累“虾粮积分”，免费版可兑换部分运行额度，提升传播与留存。</p>
          <div className="metrics-grid">
            <div>
              <div className="metric-label">当前等级</div>
              <div className="metric-value">{wallet.tier}</div>
            </div>
            <div>
              <div className="metric-label">积分</div>
              <div className="metric-value">{wallet.points}</div>
            </div>
            <div>
              <div className="metric-label">免费任务额度</div>
              <div className="metric-value">{wallet.free_runs_credit}</div>
            </div>
            <div>
              <div className="metric-label">免费 Token 额度</div>
              <div className="metric-value">{wallet.free_tokens_credit}</div>
            </div>
          </div>
          <div className="progress-wrap">
            <div className="progress-head">
              <span>今日在线进度</span>
              <strong>{onlineProgress.hours.toFixed(2)} / 4.00 小时</strong>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${onlineProgress.percent}%` }} />
            </div>
            <div className="muted tiny">累计在线：{formatSeconds(wallet.online_seconds_total)}</div>
          </div>
          <div className="row">
            <button type="button" onClick={handleClaimFreePack} disabled={claiming}>
              {claiming ? "领取中..." : "领取在线奖励"}
            </button>
            <button type="button" className="ghost" onClick={() => refreshRemoteData()} disabled={refreshingRemote}>
              {refreshingRemote ? "刷新中..." : "刷新数据"}
            </button>
          </div>
          {walletError ? <p className="warn">远端未就绪，当前为本地演示数据：{walletError}</p> : null}
        </article>
      </section>

      <section className="grid two-col">
        <article className="card">
          <h2>账号执行面板（只执行，不做策略）</h2>
          <p className="muted">边缘端仅负责执行云端下发动作，不承担策略推理，保障稳定与合规。</p>
          <ul className="list">
            {ACCOUNT_ROWS.map((item) => (
              <li key={item.id} className="list-row">
                <div>
                  <strong>[{item.platform}] {item.nickname}</strong>
                  <p>{item.tasks}</p>
                </div>
                <span className={`badge ${item.status === "在线" ? "ok" : "pause"}`}>{item.status}</span>
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>验证码中继（客户随时收码）</h2>
          <p className="muted">你在手机收到抖音/小红书验证码后，在这里提交，系统会中继给对应边缘节点继续登录。</p>
          <div className="otp-table">
            {otpRequests.length === 0 ? (
              <p className="muted tiny">当前没有待处理验证码请求</p>
            ) : (
              otpRequests.slice(0, 6).map((item) => (
                <div key={item.request_id} className="otp-row">
                  <div>
                    <strong>{item.request_id}</strong>
                    <p>
                      {item.platform} · {item.account_id || "未指定账号"} · {item.masked_target || "未知目标"}
                    </p>
                  </div>
                  <span className={`badge ${item.status === "pending" ? "pending" : "ok"}`}>{item.status}</span>
                </div>
              ))
            )}
          </div>
          <form className="row form-inline" onSubmit={handleSubmitOtp}>
            <input value={otpSubmitId} onChange={(e) => setOtpSubmitId(e.target.value)} placeholder="request_id" />
            <input
              value={otpSubmitCode}
              onChange={(e) => setOtpSubmitCode(e.target.value)}
              placeholder="验证码"
              maxLength={12}
            />
            <button type="submit" disabled={submittingOtp}>
              {submittingOtp ? "提交中..." : "提交验证码"}
            </button>
          </form>
          {otpMessage ? <p className="info">{otpMessage}</p> : null}
        </article>
      </section>

      <section className="grid two-col">
        <article className="card">
          <h2>线索回传快照</h2>
          <p className="muted">只看结果：云端持续运营，你在客户端实时看到可转化线索。</p>
          <ul className="list">
            {MOCK_LEADS.map((lead) => (
              <li key={lead.id} className="list-row">
                <div>
                  <strong>{lead.id} · {lead.source}</strong>
                  <p>{lead.content}</p>
                </div>
                <div className="right-meta">
                  <span className={`badge ${lead.score === "Hot" ? "hot" : "warm"}`}>{lead.score}</span>
                  <small>{lead.at}</small>
                </div>
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <h2>运行时与升级链路</h2>
          <p className="muted">内置运行时 + 签名升级；适配无 GPU 客户：云端优先，本地仅执行与回传。</p>
          <div className="metrics-grid">
            <div>
              <div className="metric-label">本地版本</div>
              <div className="metric-value">{runtime.status?.installedVersion || "-"}</div>
            </div>
            <div>
              <div className="metric-label">内置版本</div>
              <div className="metric-value">{runtime.status?.bundledVersion || "-"}</div>
            </div>
            <div>
              <div className="metric-label">状态</div>
              <div className="metric-value">{runtime.summary}</div>
            </div>
            <div>
              <div className="metric-label">升级可用</div>
              <div className="metric-value">{runtime.status?.updateAvailable ? "是" : "否"}</div>
            </div>
          </div>
          <details>
            <summary>高级配置（API 同步）</summary>
            <label>
              API Base URL
              <input value={apiBaseUrl} onChange={(e) => setApiBaseUrl(e.target.value)} />
            </label>
            <label>
              API Token（可选）
              <input
                value={apiToken}
                onChange={(e) => setApiToken(e.target.value)}
                placeholder="Bearer token（用于受保护接口）"
              />
            </label>
          </details>
          <div className="row">
            <button type="button" onClick={() => runtime.refreshStatus()} disabled={runtime.busy}>
              刷新状态
            </button>
            <button type="button" className="ghost" onClick={() => runtime.checkManifest()} disabled={runtime.busy}>
              校验签名 Manifest
            </button>
            <button type="button" className="ghost" onClick={() => runtime.updateRuntime()} disabled={runtime.busy}>
              一键升级
            </button>
          </div>
          {runtime.error ? <p className="error">{runtime.error}</p> : null}
          {runtime.log ? <pre className="log-view">{runtime.log}</pre> : null}
        </article>
      </section>

      <footer className="footer-note">
        <span>连接地址：{serverUrl}</span>
        <span>模式：边缘执行器（无策略脑）</span>
        <span>灰度策略：高风险动作默认 HITL 审批</span>
      </footer>
    </main>
  );
}

export default App;
