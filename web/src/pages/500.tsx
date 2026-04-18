export default function Error500Page() {
  return (
    <main style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#020617',
      color: '#f8fafc',
      padding: 24,
      fontFamily: 'sans-serif',
    }}>
      <section style={{
        maxWidth: 560,
        border: '1px solid rgba(255,255,255,0.12)',
        borderRadius: 28,
        background: 'rgba(255,255,255,0.04)',
        padding: 32,
        textAlign: 'center',
      }}>
        <div style={{
          color: '#67e8f9',
          fontSize: 12,
          letterSpacing: '0.22em',
          textTransform: 'uppercase',
          fontWeight: 700,
        }}>
          OpenClaw Console
        </div>
        <h1 style={{ marginTop: 16, fontSize: 36, fontWeight: 700 }}>服务暂时不可用</h1>
        <p style={{ marginTop: 16, color: '#cbd5e1', lineHeight: 1.8 }}>
          控制台遇到临时异常。请回到总控台重试，或查看运行日志确认后端服务状态。
        </p>
        <a
          href="/"
          style={{
            display: 'inline-flex',
            marginTop: 24,
            border: '1px solid rgba(34,211,238,0.35)',
            borderRadius: 16,
            padding: '12px 20px',
            color: '#cffafe',
            background: 'rgba(34,211,238,0.1)',
            textDecoration: 'none',
            fontSize: 14,
            fontWeight: 600,
          }}
        >
          回到总控台
        </a>
      </section>
    </main>
  );
}
