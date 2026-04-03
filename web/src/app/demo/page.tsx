'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

const MOCK_TOKEN = 'mock_jwt_demo';

export default function DemoEntryPage() {
  const router = useRouter();
  const [status, setStatus] = useState('正在进入演示模式...');

  useEffect(() => {
    try {
      localStorage.setItem('clawcommerce_token', MOCK_TOKEN);
      localStorage.setItem('clawcommerce_demo_mode', '1');
      setStatus('已进入演示模式，正在跳转...');
      router.replace('/');
      router.refresh();
    } catch {
      setStatus('无法写入本地存储，请检查浏览器是否禁用 Cookie/Storage。');
    }
  }, [router]);

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center gap-4 p-6"
      style={{ backgroundColor: '#0F172A', color: '#F8FAFC' }}
    >
      <p className="text-lg">{status}</p>
      <p className="text-sm text-slate-400">
        若未自动跳转，请点击{' '}
        <a href="/" className="underline" style={{ color: '#E5A93D' }}>
          进入数据大盘
        </a>
        {' 或 '}
        <a href="/fleet" className="underline" style={{ color: '#E5A93D' }}>
          进入龙虾节点页
        </a>
      </p>
    </div>
  );
}
