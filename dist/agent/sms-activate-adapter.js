/**
 * ClawCommerce Agent - 手机号池与第三方接码平台 API 契约
 * SMS-Activate / 5SIM 等：查询余额、获取号码、获取验证码，带异常重试。
 * @module agent/sms-activate-adapter
 */
const DEFAULT_RETRY = 3;
const DEFAULT_BACKOFF_MS = 1000;
async function withRetry(fn, retries = DEFAULT_RETRY, backoffMs = DEFAULT_BACKOFF_MS) {
    let lastErr;
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        }
        catch (e) {
            lastErr = e instanceof Error ? e : new Error(String(e));
            if (i < retries - 1) {
                await new Promise((r) => setTimeout(r, backoffMs * (i + 1)));
            }
        }
    }
    throw lastErr;
}
/**
 * 包装任意 ISmsActivateAdapter，为 getBalance / getNumber / getCode / release 增加重试。
 */
export function withRetryAdapter(adapter, retries = DEFAULT_RETRY) {
    return {
        getBalance: () => withRetry(() => adapter.getBalance(), retries),
        getNumber: (countryCode, service) => withRetry(() => adapter.getNumber(countryCode, service), retries),
        getCode: (activationId, options) => withRetry(() => adapter.getCode(activationId, options), retries),
        release: (activationId) => withRetry(() => adapter.release(activationId), retries),
    };
}
/**
 * 占位实现：未配置 API 时返回模拟数据或抛错，便于联调。
 */
export function createSmsActivateAdapterStub(config) {
    const apiKey = config?.apiKey ?? process.env.SMS_ACTIVATE_API_KEY;
    return {
        async getBalance() {
            if (!apiKey)
                throw new Error('SMS_ACTIVATE_API_KEY not set');
            const res = await fetch(`${config?.baseUrl ?? 'https://api.sms-activate.org'}/stg/api/v2/getBalance?api_key=${apiKey}`);
            if (!res.ok)
                throw new Error(`getBalance failed: ${res.status}`);
            const data = (await res.json());
            return { balance: parseFloat(data.balance ?? '0'), currency: 'RUB' };
        },
        async getNumber(countryCode, service) {
            if (!apiKey)
                throw new Error('SMS_ACTIVATE_API_KEY not set');
            const res = await fetch(`${config?.baseUrl ?? 'https://api.sms-activate.org'}/stg/api/v2/getNumber?api_key=${apiKey}&country=${countryCode}&service=${service}`);
            if (!res.ok)
                throw new Error(`getNumber failed: ${res.status}`);
            const data = (await res.json());
            return { activationId: data.activationId, number: data.number };
        },
        async getCode(activationId, options) {
            if (!apiKey)
                throw new Error('SMS_ACTIVATE_API_KEY not set');
            const timeoutMs = options?.timeoutMs ?? 120_000;
            const pollIntervalMs = options?.pollIntervalMs ?? 5000;
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                const res = await fetch(`${config?.baseUrl ?? 'https://api.sms-activate.org'}/stg/api/v2/getStatus?api_key=${apiKey}&id=${activationId}`);
                if (!res.ok)
                    throw new Error(`getCode failed: ${res.status}`);
                const data = (await res.json());
                if (data.status === 'OK' && data.code)
                    return data.code;
                await new Promise((r) => setTimeout(r, pollIntervalMs));
            }
            return null;
        },
        async release(activationId) {
            if (!apiKey)
                throw new Error('SMS_ACTIVATE_API_KEY not set');
            const res = await fetch(`${config?.baseUrl ?? 'https://api.sms-activate.org'}/stg/api/v2/cancelActivation?api_key=${apiKey}&id=${activationId}`);
            if (!res.ok)
                throw new Error(`release failed: ${res.status}`);
        },
    };
}
//# sourceMappingURL=sms-activate-adapter.js.map