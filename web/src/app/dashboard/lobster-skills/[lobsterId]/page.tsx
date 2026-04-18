import { redirect } from 'next/navigation';

export default function DashboardLobsterSkillDetailRedirectPage({
  params,
}: {
  params: { lobsterId: string };
}) {
  redirect(`/lobsters/${encodeURIComponent(params.lobsterId)}/capabilities`);
}
