/**
 * ClawCommerce Agent - PhonePool unit tests
 */

import { PhonePool } from './phone-pool.js';
import type { PhoneProviderId, PhoneSlot } from './types.js';

const mockAdapter = {
  acquire: async (countryCode: string) => ({
    externalId: `ext-${countryCode}-1`,
    number: `+${countryCode}1234567890`,
  }),
  release: async () => {},
};

describe('PhonePool', () => {
  let pool: PhonePool;

  beforeEach(() => {
    pool = new PhonePool({
      adapters: { 'sms-activate': mockAdapter } as Record<PhoneProviderId, typeof mockAdapter>,
      defaultExpiryMinutes: 30,
    });
  });

  it('acquire adds slot and getAvailable returns it', async () => {
    const slot = await pool.acquire('sms-activate', '86');
    expect(slot.id).toBeDefined();
    expect(slot.number).toBeDefined();
    expect(slot.status).toBe('available');
    expect(slot.provider).toBe('sms-activate');
    const available = pool.getAvailable();
    expect(available.some((s) => s.id === slot.id)).toBe(true);
  });

  it('allocate binds slot to nodeId', () => {
    const slot: PhoneSlot = {
      id: 's1',
      provider: 'sms-activate',
      number: '+861234',
      countryCode: '86',
      externalId: 'e1',
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      status: 'available',
    };
    (pool as unknown as { slots: Map<string, PhoneSlot> }).slots.set('s1', slot);
    const out = pool.allocate('s1', 'node-1');
    expect(out).not.toBeNull();
    expect(out!.nodeId).toBe('node-1');
    expect(out!.status).toBe('allocated');
    expect(pool.getByNodeId('node-1')?.id).toBe('s1');
  });

  it('release clears nodeId', () => {
    const slot: PhoneSlot = {
      id: 's2',
      provider: 'sms-activate',
      number: '+861234',
      countryCode: '86',
      externalId: 'e2',
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
      status: 'allocated',
      nodeId: 'n1',
    };
    (pool as unknown as { slots: Map<string, PhoneSlot> }).slots.set('s2', slot);
    pool.release('s2', true);
    const s = pool.get('s2');
    expect(s?.status).toBe('available');
    expect(s?.nodeId).toBeUndefined();
  });

  it('expireOld marks old available slots expired', () => {
    const slot: PhoneSlot = {
      id: 's3',
      provider: 'sms-activate',
      number: '+86',
      countryCode: '86',
      externalId: 'e3',
      acquiredAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() - 1000).toISOString(),
      status: 'available',
    };
    (pool as unknown as { slots: Map<string, PhoneSlot> }).slots.set('s3', slot);
    const count = pool.expireOld();
    expect(count).toBe(1);
    expect(pool.get('s3')?.status).toBe('expired');
  });
});
