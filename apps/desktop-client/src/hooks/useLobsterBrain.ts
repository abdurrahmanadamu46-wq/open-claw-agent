import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { io, Socket } from "socket.io-client";

const STORAGE_KEY = "lobster_activation_code";
const DEFAULT_SERVER =
  (typeof import.meta !== "undefined" && (import.meta as unknown as { env?: { VITE_LOBSTER_SERVER?: string } }).env?.VITE_LOBSTER_SERVER) ||
  "http://localhost:38789";

/** 指数退避重连：初始 1s，最大 30s，避免重连风暴 */
const BACKOFF = { initialMs: 1000, maxMs: 30_000, factor: 2 };

export type LobsterStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

export function useLobsterBrain(serverUrl: string = DEFAULT_SERVER) {
  const [activationCode, setActivationCodeState] = useState("");
  const [status, setStatus] = useState<LobsterStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const backoffMsRef = useRef(BACKOFF.initialMs);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const persistCode = useCallback((code: string) => {
    try {
      if (code) localStorage.setItem(STORAGE_KEY, code);
      else localStorage.removeItem(STORAGE_KEY);
    } catch (_) {}
  }, []);

  const connect = useCallback(
    (code: string) => {
      const trimmed = code.trim();
      if (!trimmed) {
        setErrorMessage("请输入 16 位激活码");
        return;
      }
      setActivationCodeState(trimmed);
      persistCode(trimmed);
      setErrorMessage(null);
      setStatus("connecting");

      // 先断开已有连接
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }

      const socket = io(serverUrl, {
        path: "/lobster",
        auth: { activationCode: trimmed },
        transports: ["websocket", "polling"],
        reconnection: false, // 我们自己做指数退避
      });

      socketRef.current = socket;

      socket.on("connect", () => {
        if (!mountedRef.current) return;
        setStatus("connected");
        setErrorMessage(null);
        backoffMsRef.current = BACKOFF.initialMs;
      });

      socket.on("connect_error", (err) => {
        if (!mountedRef.current) return;
        setStatus("error");
        setErrorMessage(err.message || "连接失败");
        scheduleReconnect(trimmed);
      });

      socket.on("disconnect", (reason) => {
        if (!mountedRef.current) return;
        if (reason === "io server disconnect" || reason === "io client disconnect") {
          setStatus("disconnected");
        } else {
          setStatus("disconnected");
          scheduleReconnect(trimmed);
        }
      });

      socket.on("server.kicked", () => {
        if (!mountedRef.current) return;
        setStatus("error");
        setErrorMessage("该激活码已在其他设备登录，你已被顶号");
      });

      // MCP over WebSocket：接收中心 JSON-RPC 请求，执行本地 Tool 并回传结果
      socket.on("mcp_call", async (payload: { jsonrpc?: string; id?: string | number; method?: string; params?: { name?: string; arguments?: Record<string, unknown> } }) => {
        const id = payload?.id;
        const method = payload?.method;
        const params = payload?.params ?? {};
        const toolName = params.name;
        if (payload?.jsonrpc !== "2.0" || id === undefined) return;
        const sendResult = (result: unknown) => {
          socket.emit("mcp_response", { jsonrpc: "2.0", id, result });
        };
        const sendError = (message: string) => {
          socket.emit("mcp_response", { jsonrpc: "2.0", id, error: { code: -32603, message } });
        };
        try {
          if (method === "tools/call" && toolName === "publish_video") {
            const result = await invoke("mcp_tool_publish_video", { args: params.arguments ?? null });
            sendResult(result);
          } else if (method === "tools/call" && toolName === "read_screen_context") {
            const base64 = await invoke<string>("capture_screen_base64").catch(() => null);
            const result = await invoke("mcp_tool_read_screen_context", { args: { ...params.arguments, base64_image: base64 ?? undefined } });
            sendResult(result);
          } else {
            sendError(`Unknown tool or method: ${method}/${toolName}`);
          }
        } catch (e) {
          sendError(e instanceof Error ? e.message : String(e));
        }
      });
    },
    [serverUrl, persistCode]
  );

  function scheduleReconnect(code: string) {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    const delay = backoffMsRef.current;
    backoffMsRef.current = Math.min(BACKOFF.maxMs, backoffMsRef.current * BACKOFF.factor);
    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (mountedRef.current && socketRef.current?.disconnected) {
        connect(code);
      }
    }, delay);
  }

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    backoffMsRef.current = BACKOFF.initialMs;
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setStatus("idle");
    setErrorMessage(null);
  }, []);

  // 启动时从 localStorage 恢复并自动连接
  useEffect(() => {
    mountedRef.current = true;
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved?.trim()) {
        setActivationCodeState(saved.trim());
        connect(saved.trim());
      }
    } catch (_) {}
    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (socketRef.current) {
        socketRef.current.removeAllListeners();
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- only on mount

  return {
    activationCode,
    setActivationCode: setActivationCodeState,
    status,
    errorMessage,
    connect,
    disconnect,
    persistCode,
  };
}

export function getStoredActivationCode(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) || "";
  } catch {
    return "";
  }
}
