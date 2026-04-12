/**
 * ClawCommerce Agent - Phone number pool (SMS-Activate, 5SIM, TigerSMS)
 * Acquire, allocate to node, auto-renew or release (idle > 30min).
 * PM v1.3：支持查询余额、获取号码、获取验证码，并做好异常重试（见 sms-activate-adapter）。
 * @module agent/phone-pool
 */
import type { PhoneSlot, PhoneProviderId } from './types.js';
import type { ISmsActivateAdapter } from './sms-activate-adapter.js';
export interface PhonePoolOptions {
    /** Provider adapters: get number, release number, get sms */
    adapters: Partial<Record<PhoneProviderId, PhoneProviderAdapter>>;
    /** Default expiry minutes for new acquisitions */
    defaultExpiryMinutes?: number;
}
export interface PhoneProviderAdapter {
    /** Acquire a number for country; returns externalId and number */
    acquire(countryCode: string, service?: string): Promise<{
        externalId: string;
        number: string;
    }>;
    /** Release number by externalId */
    release(externalId: string): Promise<void>;
    /** Optional: get latest SMS code */
    getSms?(externalId: string): Promise<string | null>;
}
/** 将 ISmsActivateAdapter 转为 PhoneProviderAdapter（带重试的接码平台） */
export declare function smsActivateToPhoneAdapter(sms: ISmsActivateAdapter): PhoneProviderAdapter;
/** In-memory phone pool with optional Redis persistence (same pattern as node-pool) */
export declare class PhonePool {
    private adapters;
    private defaultExpiryMinutes;
    private slots;
    constructor(options: PhonePoolOptions);
    /** Acquire a number from provider and add to pool */
    acquire(provider: PhoneProviderId, countryCode: string, service?: string): Promise<PhoneSlot>;
    /** Get available slots (not allocated, not expired) */
    getAvailable(): PhoneSlot[];
    /** Allocate a slot to nodeId; returns slot or null */
    allocate(slotId: string, nodeId: string): PhoneSlot | null;
    /** Release slot back to available or mark released */
    release(slotId: string, backToAvailable?: boolean): PhoneSlot | null;
    /** Get slot by ID */
    get(slotId: string): PhoneSlot | null;
    /** Get by nodeId */
    getByNodeId(nodeId: string): PhoneSlot | null;
    /** Release number at provider and remove from pool */
    releaseToProvider(slotId: string): Promise<void>;
    /** Expire old slots (call from cron); returns released count */
    expireOld(): number;
}
//# sourceMappingURL=phone-pool.d.ts.map