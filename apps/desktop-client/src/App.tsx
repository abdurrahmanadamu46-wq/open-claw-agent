import { useState } from "react";
import { useLobsterBrain, getStoredActivationCode, type LobsterStatus } from "./hooks/useLobsterBrain";
import "./App.css";

const STATUS_LABEL: Record<LobsterStatus, string> = {
  idle: "未连接",
  connecting: "连接中…",
  connected: "已连接大脑",
  disconnected: "已断开",
  error: "连接异常",
};

function StatusDot({ status }: { status: LobsterStatus }) {
  const isGreen = status === "connected";
  const isRed = status === "disconnected" || status === "error";
  const isYellow = status === "connecting";
  return (
    <span
      className="status-dot"
      data-state={isGreen ? "on" : isRed ? "off" : isYellow ? "pending" : "idle"}
      title={STATUS_LABEL[status]}
    />
  );
}

function App() {
  const {
    activationCode,
    setActivationCode,
    status,
    errorMessage,
    connect,
    disconnect,
  } = useLobsterBrain();
  const [inputCode, setInputCode] = useState(() => getStoredActivationCode());

  const handleConnect = () => {
    connect(inputCode);
  };

  return (
    <main className="container lobster-container">
      <h1>Lobster 龙虾节点</h1>
      <p className="subtitle">连接 C&C 大脑，静默驻留于托盘</p>

      <div className="row connection-row">
        <StatusDot status={status} />
        <span className="status-text">{STATUS_LABEL[status]}</span>
      </div>
      {errorMessage && <p className="error-msg">{errorMessage}</p>}

      <div className="row input-row">
        <input
          id="activation-code"
          type="text"
          value={inputCode}
          onChange={(e) => setInputCode(e.target.value)}
          placeholder="CLAW-XXXX-XXXX-XXXX"
          maxLength={19}
        />
        <button type="button" onClick={handleConnect} disabled={status === "connecting"}>
          连接大脑
        </button>
      </div>
      {status !== "idle" && status !== "connecting" && (
        <button type="button" className="disconnect-btn" onClick={disconnect}>
          断开连接
        </button>
      )}
    </main>
  );
}

export default App;
