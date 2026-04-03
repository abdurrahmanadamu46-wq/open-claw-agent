import { redirect } from 'next/navigation';

/** 数据参谋 — 重定向到根数据大盘 */
export default function DashboardPage() {
  redirect('/');
}
