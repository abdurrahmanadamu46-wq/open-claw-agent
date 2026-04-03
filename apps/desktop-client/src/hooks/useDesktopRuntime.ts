import { useCallback, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export type RuntimeStatus = {
  bundledRuntimePath: string;
  installRuntimePath: string;
  bundledVersion: string;
  installedVersion: string;
  updateAvailable: boolean;
  initialized: boolean;
  runtimeReady: boolean;
  markerPath: string;
  message: string;
};

export type RuntimeActionResult = {
  ok: boolean;
  action: string;
  message: string;
  log: string;
  status: RuntimeStatus;
};

export type RuntimeManifestCheckResult = {
  ok: boolean;
  manifestUrl: string;
  keyId: string;
  signatureAlg: string;
  signatureVerified: boolean;
  artifactUrl: string;
  artifactSha256: string;
  version: string;
  channel: string;
};

export type RuntimeUpdateOptions = {
  channel?: string;
  manifestUrl?: string;
  requireSignature?: boolean;
  keysJson?: string;
};

function normalizeOptions(options?: RuntimeUpdateOptions): Required<RuntimeUpdateOptions> {
  return {
    channel: (options?.channel || "stable").trim() || "stable",
    manifestUrl: (options?.manifestUrl || "").trim(),
    requireSignature: options?.requireSignature ?? true,
    keysJson: (options?.keysJson || "").trim(),
  };
}

export function useDesktopRuntime() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [manifestCheck, setManifestCheck] = useState<RuntimeManifestCheckResult | null>(null);

  const refreshStatus = useCallback(async () => {
    setError(null);
    try {
      const next = await invoke<RuntimeStatus>("desktop_runtime_status");
      setStatus(next);
      return next;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    }
  }, []);

  const runAction = useCallback(
    async (
      action: "desktop_runtime_init" | "desktop_runtime_update",
      options?: RuntimeUpdateOptions,
    ) => {
      const normalized = normalizeOptions(options);
      setBusy(true);
      setError(null);
      try {
        const result =
          action === "desktop_runtime_init"
            ? await invoke<RuntimeActionResult>(action)
            : await invoke<RuntimeActionResult>(action, {
                channel: normalized.channel,
                manifest_url: normalized.manifestUrl || null,
                require_signature: normalized.requireSignature,
                keys_json: normalized.keysJson || null,
              });
        setLog(result.log || result.message);
        setStatus(result.status);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const initRuntime = useCallback(async () => runAction("desktop_runtime_init"), [runAction]);

  const checkManifest = useCallback(async (options?: RuntimeUpdateOptions) => {
    const normalized = normalizeOptions(options);
    setBusy(true);
    setError(null);
    try {
      const result = await invoke<RuntimeManifestCheckResult>("desktop_runtime_manifest_check", {
        channel: normalized.channel,
        manifest_url: normalized.manifestUrl || null,
        require_signature: normalized.requireSignature,
        keys_json: normalized.keysJson || null,
      });
      setManifestCheck(result);
      setLog(
        [
          `manifest=${result.manifestUrl}`,
          `channel=${result.channel}`,
          `version=${result.version || "-"}`,
          `artifact=${result.artifactUrl}`,
          `sha256=${result.artifactSha256 || "-"}`,
          `keyId=${result.keyId || "-"}`,
          `alg=${result.signatureAlg || "-"}`,
          `signature_verified=${result.signatureVerified ? "true" : "false"}`,
        ].join("\n"),
      );
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      throw err;
    } finally {
      setBusy(false);
    }
  }, []);

  const updateRuntime = useCallback(
    async (options?: RuntimeUpdateOptions) => runAction("desktop_runtime_update", options),
    [runAction],
  );

  const summary = useMemo(() => {
    if (!status) return "尚未读取运行时状态";
    if (!status.runtimeReady) return "运行时核心文件缺失";
    if (!status.initialized) return "运行时未初始化";
    if (status.updateAvailable) return "发现可升级版本";
    return "运行时状态正常";
  }, [status]);

  return {
    status,
    summary,
    busy,
    log,
    error,
    manifestCheck,
    refreshStatus,
    initRuntime,
    checkManifest,
    updateRuntime,
  };
}
