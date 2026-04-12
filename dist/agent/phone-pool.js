/**
 * ClawCommerce Agent - Phone number pool (SMS-Activate, 5SIM, TigerSMS)
 * Acquire, allocate to node, auto-renew or release (idle > 30min).
 * PM v1.3：支持查询余额、获取号码、获取验证码，并做好异常重试（见 sms-activate-adapter）。
 * @module agent/phone-pool
 */
import { v4 as uuidv4 } from 'uuid';
/** 将 ISmsActivateAdapter 转为 PhoneProviderAdapter（带重试的接码平台） */
export function smsActivateToPhoneAdapter(sms) {
    return {
        async acquire(countryCode, service) {
            const { activationId, number } = await sms.getNumber(countryCode, service ?? 'default');
            return { externalId: activationId, number };
        },
        release: (externalId) => sms.release(externalId),
        async getSms(externalId) {
            return sms.getCode(externalId, { timeoutMs: 60_000, pollIntervalMs: 3000 });
        },
    };
}
/** In-memory phone pool with optional Redis persistence (same pattern as node-pool) */
export class PhonePool {
    adapters;
    defaultExpiryMinutes;
    slots = new Map();
    constructor(options) {
        this.adapters = options.adapters ?? {};
        this.defaultExpiryMinutes = options.defaultExpiryMinutes ?? 30;
    }
    /** Acquire a number from provider and add to pool */
    async acquire(provider, countryCode, service) {
        const adapter = this.adapters[provider];
        if (!adapter)
            throw new Error(`Phone provider not configured: ${provider}`);
        const { externalId, number } = await adapter.acquire(countryCode, service);
        const id = uuidv4();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.defaultExpiryMinutes * 60 * 1000);
        const slot = {
            id,
            provider,
            number,
            countryCode,
            externalId,
            acquiredAt: now.toISOString(),
            expiresAt: expiresAt.toISOString(),
            status: 'available',
        };
        this.slots.set(id, slot);
        return slot;
    }
    /** Get available slots (not allocated, not expired) */
    getAvailable() {
        const now = new Date().toISOString();
        return Array.from(this.slots.values()).filter((s) => s.status === 'available' && s.expiresAt > now);
    }
    /** Allocate a slot to nodeId; returns slot or null */
    allocate(slotId, nodeId) {
        const slot = this.slots.get(slotId);
        if (!slot || slot.status !== 'available')
            return null;
        slot.status = 'allocated';
        slot.nodeId = nodeId;
        this.slots.set(slotId, slot);
        return slot;
    }
    /** Release slot back to available or mark released */
    release(slotId, backToAvailable = false) {
        const slot = this.slots.get(slotId);
        if (!slot)
            return null;
        slot.status = backToAvailable ? 'available' : 'released';
        slot.nodeId = undefined;
        this.slots.set(slotId, slot);
        return slot;
    }
    /** Get slot by ID */
    get(slotId) {
        return this.slots.get(slotId) ?? null;
    }
    /** Get by nodeId */
    getByNodeId(nodeId) {
        return Array.from(this.slots.values()).find((s) => s.nodeId === nodeId) ?? null;
    }
    /** Release number at provider and remove from pool */
    async releaseToProvider(slotId) {
        const slot = this.slots.get(slotId);
        if (!slot)
            return;
        const adapter = this.adapters[slot.provider];
        if (adapter)
            await adapter.release(slot.externalId).catch(() => { });
        this.slots.delete(slotId);
    }
    /** Expire old slots (call from cron); returns released count */
    expireOld() {
        const now = new Date().toISOString();
        let count = 0;
        for (const [id, slot] of this.slots) {
            if (slot.expiresAt <= now && slot.status === 'available') {
                slot.status = 'expired';
                this.slots.set(id, slot);
                count++;
            }
        }
        return count;
    }
}
//# sourceMappingURL=phone-pool.js.map