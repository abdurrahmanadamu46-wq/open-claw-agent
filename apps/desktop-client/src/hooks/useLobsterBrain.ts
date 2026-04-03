import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { io, Socket } from "socket.io-client";

const CODE_STORAGE_KEY = "lobster_activation_code";
const SERVER_STORAGE_KEY = "lobster_server_url";

const DEFAULT_SERVER =
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: { VITE_LOBSTER_SERVER?: string } }).env?.VITE_LOBSTER_SERVER) ||
  "http://localhost:38789";

const BACKOFF = { initialMs: 1000, maxMs: 30_000, factor: 2 };

export type LobsterStatus = "idle" | "connecting" | "connected" | "disconnected" | "error";

function normalizeServerUrl(raw: string): string {
  const value = (raw || "").trim();
  if (!value) return DEFAULT_SERVER;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return `http://${value}`;
}

export function getStoredActivationCode(): string {
  try {
    return localStorage.getItem(CODE_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

export function getStoredServerUrl(): string {
  try {
    return normalizeServerUrl(localStorage.getItem(SERVER_STORAGE_KEY) || DEFAULT_SERVER);
  } catch {
    return DEFAULT_SERVER;
  }
}

export function useLobsterBrain() {
  const [activationCode, setActivationCodeState] = useState(getStoredActivationCode);
  const [serverUrl, setServerUrlState] = useState(getStoredServerUrl);
  const [status, setStatus] = useState<LobsterStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const backoffMsRef = useRef(BACKOFF.initialMs);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const persistCode = useCallback((code: string) => {
    try {
      if (code) localStorage.setItem(CODE_STORAGE_KEY, code);
      else localStorage.removeItem(CODE_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, []);

  const persistServerUrl = useCallback((url: string) => {
    try {
      localStorage.setItem(SERVER_STORAGE_KEY, normalizeServerUrl(url));
    } catch {
      // ignore
    }
  }, []);

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

  const scheduleReconnect = useCallback(
    (code: string, targetServer: string) => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const delay = backoffMsRef.current;
      backoffMsRef.current = Math.min(BACKOFF.maxMs, backoffMsRef.current * BACKOFF.factor);
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        if (!mountedRef.current || !socketRef.current?.disconnected) return;
        connect(code, targetServer);
      }, delay);
    },
    [], // connect is function-declared below
  );

  function connect(code: string, server?: string) {
    const trimmed = code.trim();
    const normalizedServer = normalizeServerUrl(server || serverUrl);
    if (!trimmed) {
      setErrorMessage("请输入激活码");
      return;
    }

    setActivationCodeState(trimmed);
    setServerUrlState(normalizedServer);
    persistCode(trimmed);
    persistServerUrl(normalizedServer);
    setErrorMessage(null);
    setStatus("connecting");

    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    const socket = io(normalizedServer, {
      path: "/lobster",
      auth: { activationCode: trimmed },
      transports: ["websocket", "polling"],
      reconnection: false,
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
      scheduleReconnect(trimmed, normalizedServer);
    });

    socket.on("disconnect", (reason) => {
      if (!mountedRef.current) return;
      setStatus("disconnected");
      if (reason !== "io server disconnect" && reason !== "io client disconnect") {
        scheduleReconnect(trimmed, normalizedServer);
      }
    });

    socket.on("server.kicked", () => {
      if (!mountedRef.current) return;
      setStatus("error");
      setErrorMessage("该激活码已在其他设备登录，你已被挤下线");
    });

    socket.on(
      "mcp_call",
      async (payload: {
        jsonrpc?: string;
        id?: string | number;
        method?: string;
        params?: { name?: string; arguments?: Record<string, unknown> };
      }) => {
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
            return;
          }
          if (method === "tools/call" && toolName === "read_screen_context") {
            const base64 = await invoke<string>("capture_screen_base64").catch(() => null);
            const result = await invoke("mcp_tool_read_screen_context", {
              args: { ...params.arguments, base64_image: base64 ?? undefined },
            });
            sendResult(result);
            return;
          }
          sendError(`未知工具调用: ${method}/${toolName}`);
        } catch (e) {
          sendError(e instanceof Error ? e.message : String(e));
        }
      },
    );
  }

  useEffect(() => {
    mountedRef.current = true;
    const savedCode = getStoredActivationCode();
    const savedServer = getStoredServerUrl();
    if (savedCode) {
      connect(savedCode, savedServer);
    }
    return () => {
      mountedRef.current = false;
      disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    activationCode,
    setActivationCode: setActivationCodeState,
    serverUrl,
    setServerUrl: (next: string) => {
      const normalized = normalizeServerUrl(next);
      setServerUrlState(normalized);
      persistServerUrl(normalized);
    },
    status,
    errorMessage,
    connect,
    disconnect,
  };
}

