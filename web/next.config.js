/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  async redirects() {
    // 龙虾优先导航 3.0：新路径 -> 现有页面，保证不 404
    return [
      { source: '/fleet/dashboard', destination: '/fleet', permanent: false },
      { source: '/fleet/accounts', destination: '/fleet/fingerprints', permanent: false },
      { source: '/missions/orchestrator', destination: '/operations/orchestrator', permanent: false },
      { source: '/missions/autopilot', destination: '/operations/autopilot', permanent: false },
      { source: '/missions/calendar', destination: '/operations/calendar', permanent: false },
      { source: '/missions/patrol', destination: '/operations/patrol', permanent: false },
      { source: '/arsenal/radar', destination: '/ai-brain/radar', permanent: false },
      { source: '/arsenal/content', destination: '/ai-brain/content', permanent: false },
      { source: '/arsenal/prompts', destination: '/ai-brain/prompt-lab', permanent: false },
      { source: '/results/leads', destination: '/operations/leads', permanent: false },
      { source: '/results/analytics', destination: '/dashboard', permanent: false },
    ];
  },
};

module.exports = nextConfig;
