'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  Sparkles,
  UserCircle,
  Cpu,
  FileText,
  Settings,
  Plug,
} from 'lucide-react';
import { LEARNING_LOOP_ROUTES } from '@/lib/learning-loop-routes';

const NAV_ITEMS = [
  { href: '/agents/cabinet', label: '岗位总览', icon: LayoutDashboard },
  { href: '/operations/strategy', label: '策略工作台', icon: Sparkles },
  { href: '/ai-brain/prompt-lab', label: '云端大脑', icon: UserCircle },
  { href: '/operations/skills-pool', label: '技能池', icon: Cpu },
  { href: LEARNING_LOOP_ROUTES.skillsImprovements.href, label: LEARNING_LOOP_ROUTES.skillsImprovements.title, icon: Cpu },
  { href: '/operations/mcp', label: 'MCP Gateway', icon: Plug },
  { href: '/operations/log-audit', label: '日志审核', icon: FileText },
  { href: '/settings/model-providers', label: '模型设置', icon: Settings },
];

export function CommanderSidebar() {
  const pathname = usePathname() ?? '';

  return (
    <aside
      className="relative z-10 w-44 shrink-0 border-r py-4"
      style={{
        background: 'var(--commander-header-sidebar-bg)',
        borderColor: 'rgba(255,255,255,0.08)',
        backdropFilter: 'blur(12px)',
      }}
    >
      <nav>
        <ul className="space-y-0.5 px-2">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href || (href !== '/agents/cabinet' && pathname.startsWith(href));
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
                    isActive ? 'bg-white/10' : 'hover:bg-white/5'
                  }`}
                  style={{
                    color: isActive ? 'var(--commander-brain)' : 'var(--commander-log-text)',
                  }}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.5} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </aside>
  );
}
