/**
 * ClawCommerce Agent - 手机号池与第三方接码平台 API 契约
 * SMS-Activate / 5SIM 等：查询余额、获取号码、获取验证码，带异常重试。
 * @module agent/sms-activate-adapter
 */
export interface ISmsActivateAdapter {
    /** 查询余额（元或美元等） */
    getBalance(): Promise<{
        balance: number;
        currency: string;
    }>;
    /** 获取号码：countryCode 如 "cn"，service 如 "wechat"；返回 activationId 与 number */
    getNumber(countryCode: string, service: string): Promise<{
        activationId: string;
        number: string;
    }>;
    /** 获取验证码；若未到则轮询，超时返回 null */
    getCode(activationId: string, options?: {
        timeoutMs?: number;
        pollIntervalMs?: number;
    }): Promise<string | null>;
    /** 释放/取消号码 */
    release(activationId: string): Promise<void>;
}
/**
 * 包装任意 ISmsActivateAdapter，为 getBalance / getNumber / getCode / release 增加重试。
 */
export declare function withRetryAdapter(adapter: ISmsActivateAdapter, retries?: number): ISmsActivateAdapter;
/**
 * SMS-Activate 官方 API 契约（文档：https://sms-activate.org/api2）
 * 实现时需配置 API Key（环境变量 SMS_ACTIVATE_API_KEY）。
 */
export interface SmsActivateApiConfig {
    apiKey: string;
    baseUrl?: string;
}
/**
 * 占位实现：未配置 API 时返回模拟数据或抛错，便于联调。
 */
export declare function createSmsActivateAdapterStub(config?: SmsActivateApiConfig): ISmsActivateAdapter;
//# sourceMappingURL=sms-activate-adapter.d.ts.map