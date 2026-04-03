const assert = require('node:assert/strict');
const { SessionAuthController } = require('../dist/auth/session-auth.controller.js');

async function main() {
  const controller = new SessionAuthController(
    {
      login(username, password) {
        if (username !== 'admin' || password !== 'change_me') {
          throw new Error('invalid local');
        }
        return {
          token: 'local-token',
          expiresIn: 3600,
          user: {
            id: 'admin',
            name: 'admin',
            tenantId: 'tenant_demo',
            role: 'admin',
            roles: ['admin'],
          },
        };
      },
      issueLoginResult(user) {
        return {
          token: `proxy-${user.id}`,
          expiresIn: 3600,
          user: {
            id: user.id,
            name: user.name,
            tenantId: user.tenantId,
            role: user.roles[0],
            roles: user.roles,
          },
        };
      },
      listUsers() {
        return [];
      },
    },
    {
      async publicPasswordLogin() {
        return { access_token: 'ai-token', expires_in: 3600 };
      },
      async publicAuthMe() {
        return { username: 'user_a', tenant_id: 'tenant_demo', roles: ['member'] };
      },
      async publicRegister(body) {
        return { ok: true, body };
      },
      async publicForgotPassword(email) {
        return { ok: true, email };
      },
      async publicResetPassword(body) {
        return { ok: true, body };
      },
    },
    {
      async ensureTenant(tenantId, seed) {
        return { id: tenantId, name: seed?.name ?? tenantId };
      },
    },
  );

  const local = await controller.login({ username: 'admin', password: 'change_me' });
  assert.equal(local.token, 'local-token');

  const proxied = await controller.login({ username: 'user_a', password: 'secret' });
  assert.equal(proxied.token, 'proxy-user_a');
  assert.equal(proxied.user.tenantId, 'tenant_demo');

  const register = await controller.register({
    email: 'u@example.com',
    password: 'Passw0rd!2026',
    username: 'u',
  });
  assert.equal(register.ok, true);

  const forgot = await controller.forgotPassword({ email: 'u@example.com' });
  assert.equal(forgot.ok, true);

  const reset = await controller.resetPassword({ token: 'tok_123', password: 'new' });
  assert.equal(reset.ok, true);

  console.log('auth-proxy-tests: all tests passed');
}

main().catch((err) => {
  console.error('auth-proxy-tests: failed');
  console.error(err);
  process.exit(1);
});
