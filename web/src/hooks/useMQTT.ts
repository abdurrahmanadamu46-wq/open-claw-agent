'use client';

/**
 * 全局 MQTT 通信管道（云边协同 / 龙虾池）
 * - 边缘节点主动连 Broker，SaaS 前端通过 WebSocket 订阅/发布
 * - 单例连接，避免每页重复 connect
 *
 * 安装：cd web && npm install mqtt
 *
 * 环境变量：NEXT_PUBLIC_MQTT_URL
 * 示例：wss://broker.example.com:8084/mqtt
 */

import { useCallback, useEffect, useRef, useState } from 'react';

/** 与后端约定的心跳/状态 Payload，便于类型提示；实际解析可用 Record 宽化 */
export type MqttPayload = Record<string, unknown>;

type MqttClient = {
  subscribe(topic: string, opts?: object, cb?: (err?: Error) => void): MqttClient;
  unsubscribe(topic: string, cb?: (err?: Error) => void): void;
  publish(topic: string, message: string | Buffer, opts?: object, cb?: (err?: Error) => void): void;
  on(event: 'message', cb: (topic: string, payload: Buffer) => void): MqttClient;
  on(event: 'connect' | 'error' | 'close' | 'offline', cb: (...args: unknown[]) => void): MqttClient;
  removeListener(event: string, cb: (...args: unknown[]) => void): MqttClient;
  end(force?: boolean, cb?: () => void): MqttClient;
  connected: boolean;
};

const DEFAULT_URL = '';

let sharedClient: MqttClient | null = null;
let connectPromise: Promise<MqttClient | null> | null = null;

/** 消息订阅：topic -> Set<callback> */
const topicCallbacks = new Map<string, Set<(topic: string, payload: MqttPayload) => void>>();
let messageHandlerAttached = false;

function attachMessageHandler(client: MqttClient) {
  if (messageHandlerAttached) return;
  messageHandlerAttached = true;
  client.on('message', (topic, buf) => {
    let parsed: MqttPayload = {};
    try {
      parsed = JSON.parse(buf.toString()) as MqttPayload;
    } catch {
      parsed = { _raw: buf.toString() } as MqttPayload;
    }
    topicCallbacks.forEach((set, subscribedTopic) => {
      if (!topicMatches(subscribedTopic, topic)) return;
      set.forEach((cb) => {
        try {
          cb(topic, parsed);
        } catch {
          /* 单条回调异常不影响其它 */
        }
      });
    });
  });
}

/** 简单通配：subscribed 可为 clawcommerce/nodes/+/status，topic 为 clawcommerce/nodes/node-1/status */
function topicMatches(subscribed: string, actual: string): boolean {
  if (subscribed === actual) return true;
  const subParts = subscribed.split('/');
  const actParts = actual.split('/');
  if (subParts.length !== actParts.length) return false;
  for (let i = 0; i < subParts.length; i++) {
    if (subParts[i] === '+' || subParts[i] === '#') continue;
    if (subParts[i] !== actParts[i]) return false;
  }
  return true;
}

async function getOrCreateClient(): Promise<MqttClient | null> {
  const url = process.env.NEXT_PUBLIC_MQTT_URL ?? DEFAULT_URL;
  if (!url || typeof window === 'undefined') return null;

  if (sharedClient?.connected) return sharedClient;
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      const mqtt = (await import('mqtt')).default;
      const client = mqtt.connect(url, {
        protocolVersion: 4,
        reconnectPeriod: 5000,
        connectTimeout: 10_000,
        clientId: `clawcommerce-web-${Math.random().toString(36).slice(2, 10)}`,
      }) as unknown as MqttClient;
      sharedClient = client;
      attachMessageHandler(client);
      return client;
    } catch (e) {
      console.warn('[useMQTT] connect failed', e);
      return null;
    } finally {
      connectPromise = null;
    }
  })();

  return connectPromise;
}

export interface UseMQTTReturn {
  client: MqttClient | null;
  isConnected: boolean;
  error: Error | null;
  /** 订阅主题；callback 收到 (topic, payload)。返回取消订阅函数 */
  subscribe: (topic: string, callback: (topic: string, payload: MqttPayload) => void) => () => void;
  /** 发布 JSON；payload 使用 Record 宽类型以适配各类指令 */
  publish: (topic: string, payload: MqttPayload) => void;
}

export function useMQTT(): UseMQTTReturn {
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const clientRef = useRef<MqttClient | null>(null);
  const unsubscribesRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    let cancelled = false;
    getOrCreateClient().then((c) => {
      if (cancelled || !c) return;
      clientRef.current = c;
      const onConnect = () => setIsConnected(true);
      const onError = (e: unknown) => setError(e instanceof Error ? e : new Error(String(e)));
      const onClose = () => setIsConnected(false);
      c.on('connect', onConnect);
      c.on('error', onError);
      c.on('close', onClose);
      c.on('offline', onClose);
      if (c.connected) setIsConnected(true);
    });
    return () => {
      cancelled = true;
      unsubscribesRef.current.forEach((u) => u());
      unsubscribesRef.current = [];
    };
  }, []);

  const subscribe = useCallback((topic: string, callback: (topic: string, payload: MqttPayload) => void) => {
    if (!topicCallbacks.has(topic)) topicCallbacks.set(topic, new Set());
    topicCallbacks.get(topic)!.add(callback);

    const client = clientRef.current ?? sharedClient;
    if (client) {
      client.subscribe(topic, (err?: Error) => {
        if (err) console.warn('[useMQTT] subscribe error', topic, err);
      });
    } else {
      getOrCreateClient().then((c) => {
        if (c) c.subscribe(topic);
      });
    }

    const unsubscribe = () => {
      const set = topicCallbacks.get(topic);
      if (set) {
        set.delete(callback);
        if (set.size === 0) {
          topicCallbacks.delete(topic);
          clientRef.current?.unsubscribe(topic);
          sharedClient?.unsubscribe(topic);
        }
      }
    };
    unsubscribesRef.current.push(unsubscribe);
    return unsubscribe;
  }, []);

  const publish = useCallback((topic: string, payload: MqttPayload) => {
    const body = JSON.stringify(payload);
    const client = clientRef.current ?? sharedClient;
    if (client && client.connected) {
      client.publish(topic, body, { qos: 0 });
      return;
    }
    getOrCreateClient().then((c) => {
      if (c && c.connected) c.publish(topic, body, { qos: 0 });
    });
  }, []);

  return {
    client: clientRef.current ?? sharedClient,
    isConnected,
    error,
    subscribe,
    publish,
  };
}
