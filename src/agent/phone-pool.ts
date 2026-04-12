/**
 * ClawCommerce Agent - Phone number pool (SMS-Activate, 5SIM, TigerSMS)
 * Acquire, allocate to node, auto-renew or release (idle > 30min).
 * PM v1.3：支持查询余额、获取号码、获取验证码，并做好异常重试（见 sms-activate-adapter）。
 * @module agent/phone-pool
 */

import { v4 as uuidv4 } from 'uuid';
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
  acquire(countryCode: string, service?: string): Promise<{ externalId: string; number: string }>;
  /** Release number by externalId */
  release(externalId: string): Promise<void>;
  /** Optional: get latest SMS code */
  getSms?(externalId: string): Promise<string | null>;
}

/** 将 ISmsActivateAdapter 转为 PhoneProviderAdapter（带重试的接码平台） */
export function smsActivateToPhoneAdapter(sms: ISmsActivateAdapter): PhoneProviderAdapter {
  return {
    async acquire(countryCode: string, service?: string) {
      const { activationId, number } = await sms.getNumber(countryCode, service ?? 'default');
      return { externalId: activationId, number };
    },
    release: (externalId: string) => sms.release(externalId),
    async getSms(externalId: string) {
      return sms.getCode(externalId, { timeoutMs: 60_000, pollIntervalMs: 3000 });
    },
  };
}

/** In-memory phone pool with optional Redis persistence (same pattern as node-pool) */
export class PhonePool {
  private adapters: Partial<Record<PhoneProviderId, PhoneProviderAdapter>>;
  private defaultExpiryMinutes: number;
  private slots = new Map<string, PhoneSlot>();

  constructor(options: PhonePoolOptions) {
    this.adapters = options.adapters ?? {};
    this.defaultExpiryMinutes = options.defaultExpiryMinutes ?? 30;
  }

  /** Acquire a number from provider and add to pool */
  async acquire(
    provider: PhoneProviderId,
    countryCode: string,
    service?: string
  ): Promise<PhoneSlot> {
    const adapter = this.adapters[provider];
    if (!adapter) throw new Error(`Phone provider not configured: ${provider}`);
    const { externalId, number } = await adapter.acquire(countryCode, service);
    const id = uuidv4();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.defaultExpiryMinutes * 60 * 1000);
    const slot: PhoneSlot = {
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
  getAvailable(): PhoneSlot[] {
    const now = new Date().toISOString();
    return Array.from(this.slots.values()).filter(
      (s) => s.status === 'available' && s.expiresAt > now
    );
  }

  /** Allocate a slot to nodeId; returns slot or null */
  allocate(slotId: string, nodeId: string): PhoneSlot | null {
    const slot = this.slots.get(slotId);
    if (!slot || slot.status !== 'available') return null;
    slot.status = 'allocated';
    slot.nodeId = nodeId;
    this.slots.set(slotId, slot);
    return slot;
  }

  /** Release slot back to available or mark released */
  release(slotId: string, backToAvailable = false): PhoneSlot | null {
    const slot = this.slots.get(slotId);
    if (!slot) return null;
    slot.status = backToAvailable ? 'available' : 'released';
    slot.nodeId = undefined;
    this.slots.set(slotId, slot);
    return slot;
  }

  /** Get slot by ID */
  get(slotId: string): PhoneSlot | null {
    return this.slots.get(slotId) ?? null;
  }

  /** Get by nodeId */
  getByNodeId(nodeId: string): PhoneSlot | null {
    return Array.from(this.slots.values()).find((s) => s.nodeId === nodeId) ?? null;
  }

  /** Release number at provider and remove from pool */
  async releaseToProvider(slotId: string): Promise<void> {
    const slot = this.slots.get(slotId);
    if (!slot) return;
    const adapter = this.adapters[slot.provider];
    if (adapter) await adapter.release(slot.externalId).catch(() => {});
    this.slots.delete(slotId);
  }

  /** Expire old slots (call from cron); returns released count */
  expireOld(): number {
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
