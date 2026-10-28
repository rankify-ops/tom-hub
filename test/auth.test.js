const test = require('node:test');
const assert = require('node:assert');
process.env.TOM_JWT_SECRET = 'test-secret-' + Date.now();
process.env.ROUTINE_SECRET = 'bot-key-test';
process.env.CRON_SECRET = 'cron-key-test';
const jwt = require('jsonwebtoken');
const { authorised, cronAuthorised } = require('../lib/http-auth');

const req = (h) => ({ headers: h });

test('no credentials is refused', () => {
  assert.equal(authorised(req({})), false);
  assert.equal(cronAuthorised(req({})), false);
});
test('bot bearer key is accepted, wrong key refused', () => {
  assert.equal(authorised(req({ authorization: 'Bearer bot-key-test' })), true);
  assert.equal(authorised(req({ authorization: 'Bearer nope' })), false);
});
test('cron secret only works for cron', () => {
  assert.equal(cronAuthorised(req({ authorization: 'Bearer cron-key-test' })), true);
  assert.equal(authorised(req({ authorization: 'Bearer cron-key-test' })), false);
  assert.equal(cronAuthorised(req({ authorization: 'Bearer bot-key-test' })), false);
});
test('valid session cookie accepted; forged/expired refused', () => {
  const good = jwt.sign({ role: 'admin' }, process.env.TOM_JWT_SECRET, { expiresIn: '1h' });
  const bad = jwt.sign({ role: 'admin' }, 'other', { expiresIn: '1h' });
  const old = jwt.sign({ role: 'admin', exp: Math.floor(Date.now() / 1000) - 10 }, process.env.TOM_JWT_SECRET);
  assert.equal(authorised(req({ cookie: 'a=b; tom_session=' + good })), true);
  assert.equal(authorised(req({ cookie: 'tom_session=' + bad })), false);
  assert.equal(authorised(req({ cookie: 'tom_session=' + old })), false);
});
