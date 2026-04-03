/* eslint-disable no-console */
const assert = require('assert');

function run() {
  const { redactLogRecord, redactText } = require('../dist/common/redaction.js');

  // 1) key-based redaction: token / apiKey / secret / phone
  const obj = {
    token: 'abc1234567890token',
    apiKey: 'sk_live_1234567890ABCDEFG',
    nested: {
      secret: 'super-secret-value',
      phone: '13812345678',
    },
    safe: 'hello',
  };
  const redactedObj = redactLogRecord(obj);
  assert.notStrictEqual(redactedObj.token, obj.token, 'token should be redacted');
  assert.notStrictEqual(redactedObj.apiKey, obj.apiKey, 'apiKey should be redacted');
  assert.notStrictEqual(redactedObj.nested.secret, obj.nested.secret, 'secret should be redacted');
  assert.strictEqual(redactedObj.nested.phone, '138****5678', 'phone should be masked');
  assert.strictEqual(redactedObj.safe, 'hello', 'non-sensitive field should be kept');

  // 2) bearer redaction in free text
  const bearerText = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature';
  const bearerOut = redactText(bearerText);
  assert.ok(
    bearerOut.includes('[REDACTED]'),
    'bearer token marker should appear',
  );
  assert.ok(!bearerOut.includes('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature'), 'raw bearer token should not remain');

  // 3) phone redaction in free text
  const phoneText = 'customer phone=13812345678, callback later';
  const phoneOut = redactText(phoneText);
  assert.ok(phoneOut.includes('138****5678'), 'phone number should be masked');
  assert.ok(!phoneOut.includes('13812345678'), 'raw phone number should not remain');

  console.log('redaction-tests: all tests passed');
}

run();
