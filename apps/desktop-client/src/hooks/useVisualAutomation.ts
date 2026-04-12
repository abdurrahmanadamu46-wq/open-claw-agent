/**
 * 视觉 GUI 自动化调度 Hook
 * 流程：Rust 截图 → 后端 VLM 分析 → 解析坐标/动作 → Rust enigo 执行
 * 用于 Tauri Lobster 节点，绕过 DOM 反爬
 */
import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

const DEFAULT_VLM_URL =
  (typeof import.meta !== "undefined" &&
    (import.meta as unknown as { env?: { VITE_VLM_API_URL?: string } }).env?.VITE_VLM_API_URL) ||
  "http://localhost:38789";

export interface InputActionPayload {
  action: "click" | "type";
  x?: number;
  y?: number;
  text?: string;
}

export interface VlmAnalyzeResult {
  action: "click" | "type";
  x?: number;
  y?: number;
  text?: string;
  /** 可选：VLM 返回的原始说明 */
  reason?: string;
}

export function useVisualAutomation(vlmBaseUrl: string = DEFAULT_VLM_URL) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** 仅截屏并返回 Base64（不调用 VLM） */
  const captureScreenBase64 = useCallback(async (): Promise<string | null> => {
    try {
      const base64 = await invoke<string>("capture_screen_base64");
      return base64 ?? null;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  /** 在系统底层执行 click 或 type */
  const executeInput = useCallback(async (payload: InputActionPayload): Promise<boolean> => {
    try {
      await invoke("execute_input", { payload });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    }
  }, []);

  /**
   * 一键流程：截图 → 发送 VLM 分析 → 执行返回的动作
   * 若 VLM 未配置或失败，可仅做截屏并返回 base64，由调用方自行处理
   */
  const captureAnalyzeAndAct = useCallback(
    async (options?: { skipVlm?: boolean }): Promise<VlmAnalyzeResult | null> => {
      setBusy(true);
      setError(null);
      try {
        const base64 = await captureScreenBase64();
        if (!base64) return null;

        if (options?.skipVlm) {
          setBusy(false);
          return null;
        }

        const res = await fetch(`${vlmBaseUrl.replace(/\/$/, "")}/api/v1/vlm/analyze`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageBase64: base64 }),
        });
        if (!res.ok) {
          setError(`VLM ${res.status}: ${await res.text()}`);
          setBusy(false);
          return null;
        }
        const data = (await res.json()) as VlmAnalyzeResult;
        if (data.action === "click" && data.x != null && data.y != null) {
          await executeInput({ action: "click", x: data.x, y: data.y });
        } else if (data.action === "type" && data.text) {
          await executeInput({ action: "type", text: data.text });
        }
        setBusy(false);
        return data;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setBusy(false);
        return null;
      }
    },
    [vlmBaseUrl, captureScreenBase64, executeInput]
  );

  return {
    captureScreenBase64,
    executeInput,
    captureAnalyzeAndAct,
    busy,
    error,
    clearError: () => setError(null),
  };
}
