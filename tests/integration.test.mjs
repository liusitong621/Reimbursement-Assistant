import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
test('制度发布、人员分工、本人授权、事实核对及跨用户隔离', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lst-test-'));
  const port = 33000 + Math.floor(Math.random() * 1000);
  const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port), DATA_DIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((resolve, reject) => { child.stdout.once('data', resolve); child.once('error', reject); child.once('exit', code => reject(new Error(`server exited ${code}`))); });
    let cookie = '';
    async function request(url, input) { const response = await fetch(`http://127.0.0.1:${port}${url}`, { headers: { Cookie: cookie, 'Content-Type': 'application/json' }, ...(input === undefined ? {} : { method: 'POST', body: JSON.stringify(input) }) }); cookie = response.headers.get('set-cookie')?.split(';')[0] || cookie; return { code: response.status, data: await response.json() }; }
    await request('/api/session');
    const draft = { title: '差旅制度', version: 'DEMO', startsOn: '2020-01-01', content: '住宿需发票', source: '合成测试', demo: true };
    assert.equal((await request('/api/policies', draft)).code, 403);
    await request('/api/session', { account: 'qiao' });
    const policy = (await request('/api/policies', draft)).data;
    assert.equal((await request('/api/policy-query', { query: '住宿' })).data.results.length, 0);
    assert.equal((await request(`/api/policies/${policy.id}/publish`, {})).code, 200);
    assert.equal((await request('/api/policy-query', { query: '住宿' })).data.results.length, 1);
    await request('/api/session', { account: 'employee' });
    const attachment = (await request('/api/attachments', { name: 'demo.txt', type: 'text/plain', content: Buffer.from('demo').toString('base64') })).data;
    const claim = (await request('/api/claims', { title: '演示报销', employee: '伪造身份', items: [{ merchant: '酒店', date: '2026-10-08', category: '住宿', amount: '420.00', invoiceNumber: 'DEMO-123', attachmentId: attachment.id }] })).data;
    assert.equal(claim.employee, '演示员工');
    const submitted = (await request(`/api/claims/${claim.id}/submit`, {})).data;
    assert.equal(submitted.submitted, true); assert.equal(submitted.oa, undefined);
    assert.equal((await request(`/api/claims/${claim.id}/status`, {})).code, 403);
    await request('/api/consent', { authorized: true });
    assert.equal((await request(`/api/claims/${claim.id}/status`, {})).code, 409);
    assert.equal((await request(`/api/facts/${claim.id}/verify`, {})).code, 403);
    await request('/api/session', { account: 'zhou' });
    assert.equal((await request(`/api/facts/${claim.id}/verify`, {})).code, 200);
    await request('/api/session', { account: 'employee' }); await request('/api/consent', { authorized: true });
    assert.equal((await request(`/api/claims/${claim.id}/status`, {})).data.oa.status, '部门审批中');
    await request('/api/consent', { authorized: false });
    assert.equal((await request('/api/state')).data.claims[0].oa, undefined);
    await request('/api/session', { account: 'other' }); await request('/api/consent', { authorized: true });
    assert.equal((await request('/api/state')).data.claims.length, 0);
    assert.equal((await request(`/api/claims/${claim.id}/status`, {})).code, 404);
    assert.equal((await request(`/api/attachments/${attachment.id}`)).code, 404);
  } finally { child.kill(); await new Promise(resolve => child.exitCode !== null ? resolve() : child.once('exit', resolve)); await rm(directory, { recursive: true, force: true }); }
});
