import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inspect, normalizeItems, reply } from './agent.mjs';
import { MockOAAdapter } from './oa.mjs';
import { searchPolicies, effective, validDay } from './policy.mjs';

const root = process.cwd(), dataDir = process.env.DATA_DIR || path.join(root, 'data');
await fs.mkdir(path.join(dataDir, 'attachments'), { recursive: true });
let state;
try { state = JSON.parse(await fs.readFile(path.join(dataDir, 'state.json'), 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; state = { claims: [], attachments: [] }; }
const oa = new MockOAAdapter();
state.policies ??= [];
state.audit ??= [];
const sessions = new Map();
const accounts = { employee: { id: 'employee-demo', name: '演示员工', role: 'employee' }, other: { id: 'employee-other', name: '另一位演示员工', role: 'employee' }, qiao: { id: 'qiao', name: '乔姐', role: 'policy_owner' }, zhou: { id: 'zhou', name: '周敏', role: 'fact_reviewer' } };
function sessionFor(req, res) {
  let token = req.headers.cookie?.match(/(?:^|;\s*)lst_session=([\w-]+)/)?.[1];
  if (!sessions.has(token)) { token = randomUUID(); sessions.set(token, { account: accounts.employee, consent: false }); res.setHeader('Set-Cookie', `lst_session=${token}; HttpOnly; SameSite=Strict; Path=/`); }
  return sessions.get(token);
}
function viewClaim(claim, session) {
  if (session.account.role === 'fact_reviewer') return claim;
  const result = { ...claim, events: claim.events.filter(e => e.text === '生成报销单' || e.text === '提交模拟 OA') };
  result.submitted = Boolean(claim.oa);
  result.oa = session.consent && claim.factCheckedAt ? claim.oa : undefined;
  result.statusNote = !session.consent ? '本人单据状态查询尚未授权' : !claim.factCheckedAt ? '业务事实待周敏核对' : '周敏已核对 · 模拟 OA 数据';
  return result;
}
const save = async () => { await fs.writeFile(path.join(dataDir, 'state.tmp'), JSON.stringify(state, null, 2)); await fs.rename(path.join(dataDir, 'state.tmp'), path.join(dataDir, 'state.json')); };
function send(res, code, data) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); }
async function body(req) {
  let size = 0, chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > 12 * 1024 * 1024) throw new Error('上传大小超过限制'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString() || '{}');
}
// Serialize requests so persistence and submission remain atomic in this local demo.
let queue = Promise.resolve();
async function handle(req, res) {
  try {
    const url = new URL(req.url, 'http://localhost');
    const session = sessionFor(req, res), account = session.account;
    if (req.method === 'GET' && url.pathname === '/api/session') return send(res, 200, { ...session, demo: true });
    if (req.method === 'POST' && url.pathname === '/api/session') { const input = await body(req); if (!accounts[input.account]) throw new Error('演示身份不存在'); session.account = accounts[input.account]; session.consent = false; return send(res, 200, { ...session, demo: true }); }
    if (req.method === 'POST' && url.pathname === '/api/consent') { if (account.role !== 'employee') return send(res, 403, { error: '仅员工可授权本人查询' }); const input = await body(req); if (typeof input.authorized !== 'boolean') throw new Error('须明确授权或撤回'); session.consent = input.authorized; state.audit.push({ actor: account.id, action: input.authorized ? '授权本人状态查询' : '撤回本人状态查询', at: new Date().toISOString() }); await save(); return send(res, 200, session); }
    if (req.method === 'GET' && url.pathname === '/api/policies') { const policies = account.role === 'policy_owner' ? state.policies.map(p => ({ ...p, effective: effective(p) })) : searchPolicies(state.policies, url.searchParams.get('q') || ''); return send(res, 200, { policies, owner: '乔姐' }); }
    if (req.method === 'POST' && url.pathname === '/api/policies') {
      if (account.role !== 'policy_owner') return send(res, 403, { error: '制度仅由乔姐维护' });
      const input = await body(req);
      for (const key of ['title', 'content', 'version', 'source', 'startsOn']) if (!String(input[key] ?? '').trim()) throw new Error(`请填写 ${key}`);
      if (!validDay(input.startsOn) || (input.endsOn && (!validDay(input.endsOn) || input.endsOn < input.startsOn))) throw new Error('生效日期或失效日期无效');
      const policy = { id: randomUUID(), title: String(input.title).slice(0, 200), content: String(input.content).slice(0, 20000), version: String(input.version).slice(0, 100), source: String(input.source).slice(0, 1000), startsOn: input.startsOn, endsOn: input.endsOn || '', tags: String(input.tags || '').slice(0, 300), status: 'draft', owner: '乔姐', demo: input.demo === true, updatedAt: new Date().toISOString() };
      state.policies.push(policy); state.audit.push({ actor: account.id, action: '新增制度草稿', policyId: policy.id, at: policy.updatedAt }); await save(); return send(res, 201, policy);
    }
    const policyAction = url.pathname.match(/^\/api\/policies\/([^/]+)\/(publish|withdraw)$/);
    if (policyAction && req.method === 'POST') {
      if (account.role !== 'policy_owner') return send(res, 403, { error: '制度仅由乔姐维护' });
      const policy = state.policies.find(p => p.id === policyAction[1]); if (!policy) return send(res, 404, { error: '制度不存在' });
      if (policyAction[2] === 'publish' && state.policies.some(p => p.id !== policy.id && p.title === policy.title && p.status === 'published' && p.startsOn <= (policy.endsOn || '9999-12-31') && policy.startsOn <= (p.endsOn || '9999-12-31'))) throw new Error('同名制度版本有效期重叠，请先撤回旧版');
      policy.status = policyAction[2] === 'publish' ? 'published' : 'withdrawn'; policy.updatedAt = new Date().toISOString(); state.audit.push({ actor: account.id, action: policyAction[2], policyId: policy.id, at: policy.updatedAt }); await save(); return send(res, 200, policy);
    }
    if (req.method === 'POST' && url.pathname === '/api/policy-query') {
      const input = await body(req), found = searchPolicies(state.policies, input.query || '');
      return send(res, 200, { results: found, answer: found.length ? '以下为当前有效版本原文，请结合适用范围阅读。每条引用均附来源、版本及生效日期。' : '未找到可引用的有效制度。请联系乔姐补充或确认，不依据过期、未发布制度推断报销标准。' });
    }
    if (req.method === 'GET' && url.pathname === '/api/facts') { if (account.role !== 'fact_reviewer') return send(res, 403, { error: '业务事实仅由周敏核对' }); return send(res, 200, { claims: state.claims.filter(c => c.oa) }); }
    const verify = url.pathname.match(/^\/api\/facts\/([^/]+)\/verify$/);
    if (verify && req.method === 'POST') { if (account.role !== 'fact_reviewer') return send(res, 403, { error: '业务事实仅由周敏核对' }); const claim = state.claims.find(c => c.id === verify[1]); if (!claim?.oa) return send(res, 404, { error: '单据不存在' }); claim.factCheckedAt = new Date().toISOString(); claim.factCheckedBy = '周敏'; state.audit.push({ actor: account.id, action: '核对模拟业务事实', claimId: claim.id, at: claim.factCheckedAt }); await save(); return send(res, 200, claim); }
    if (req.method === 'GET' && url.pathname === '/api/state') return send(res, 200, { claims: state.claims.filter(c => c.ownerId === account.id).map(c => viewClaim(c, session)), attachments: state.attachments.filter(a => a.ownerId === account.id) });
    if (req.method === 'GET' && url.pathname === '/api/health') return send(res, 200, { ok: true, oa: 'mock', agent: 'rules' });
    if (req.method === 'POST' && url.pathname === '/api/attachments') {
      if (account.role !== 'employee') return send(res, 403, { error: '请使用员工身份' });
      const input = await body(req);
      const allowed = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf', 'text/plain', 'application/json'];
      if (!allowed.includes(input.type)) throw new Error('支持 PNG、JPG、WebP、PDF、TXT 和 JSON');
      const bytes = Buffer.from(String(input.content ?? ''), 'base64');
      if (!bytes.length || bytes.length > 8 * 1024 * 1024) throw new Error('文件须非空且小于 8 MB');
      const id = randomUUID();
      await fs.writeFile(path.join(dataDir, 'attachments', id), bytes);
      const attachment = { id, ownerId: account.id, name: path.basename(String(input.name)).slice(0, 200), type: input.type, size: bytes.length };
      state.attachments.push(attachment); await save(); return send(res, 201, attachment);
    }
    if (req.method === 'GET' && url.pathname.startsWith('/api/attachments/')) {
      const id = url.pathname.split('/').pop(), file = state.attachments.find(a => a.id === id);
      if (!file || file.ownerId !== account.id) return send(res, 404, { error: '附件不存在' });
      res.writeHead(200, { 'Content-Type': file.type, 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`, 'X-Content-Type-Options': 'nosniff' });
      return res.end(await fs.readFile(path.join(dataDir, 'attachments', id)));
    }
    if (req.method === 'POST' && url.pathname === '/api/claims') {
      if (account.role !== 'employee') return send(res, 403, { error: '请使用员工身份' });
      const input = await body(req), items = normalizeItems(input.items);
      if (items.some(i => i.attachmentId && !state.attachments.some(a => a.id === i.attachmentId && a.ownerId === account.id))) throw new Error('附件不存在，请重新上传');
      if (!String(input.title ?? '').trim() || !String(input.employee ?? '').trim()) throw new Error('请填写报销事由和申请人');
      const report = inspect(items);
      if (!report.ready) return send(res, 422, { error: '材料尚未完整', report });
      const duplicates = items.filter(i => state.claims.some(c => c.items.some(old => old.invoiceNumber === i.invoiceNumber)));
      if (duplicates.length) throw new Error('发票号码已存在于其他报销单，不能重复生成');
      const claim = { id: randomUUID(), ownerId: account.id, title: String(input.title).slice(0, 200), employee: account.name, items, totalCents: report.totalCents, createdAt: new Date().toISOString(), events: [{ text: '生成报销单', at: new Date().toISOString() }] };
      state.claims.unshift(claim); await save(); return send(res, 201, claim);
    }
    const match = url.pathname.match(/^\/api\/claims\/([^/]+)\/(submit|status|advance|chat)$/);
    if (match && req.method === 'POST') {
      const claim = state.claims.find(c => c.id === match[1]);
      if (!claim || claim.ownerId !== account.id) return send(res, 404, { error: '报销单不存在' });
      const action = match[2];
      if (action === 'status' && !session.consent) return send(res, 403, { error: '请先在制度工作台授权查询本人单据状态' });
      if (action === 'status' && !claim.factCheckedAt) return send(res, 409, { error: '业务事实待周敏核对，暂不提供确定状态' });
      if (action === 'chat') { const input = await body(req); const message = String(input.message ?? ''); if (/审批|状态|进度/.test(message) && (!session.consent || !claim.factCheckedAt)) return send(res, 200, { reply: !session.consent ? '请先授权查询本人单据状态。' : '业务事实待周敏核对，暂不提供确定状态。' }); return send(res, 200, { reply: reply(message, claim) }); }
      if (action === 'submit' && !claim.oa) { claim.oa = await oa.submit(claim); claim.events.push({ text: '提交模拟 OA', at: new Date().toISOString() }); }
      if (action !== 'submit' && !claim.oa) throw new Error('请先提交模拟 OA');
      if (action === 'status') claim.oa = await oa.query(claim.oa);
      if (action === 'advance') return send(res, 403, { error: '员工不能变更审批结果' });
      await save(); return send(res, 200, viewClaim(claim, session));
    }
    if (req.method === 'POST' && url.pathname === '/api/agent') { const input = await body(req); return send(res, 200, { reply: reply(String(input.message ?? ''), { items: normalizeItems(input.items ?? []) }) }); }
    if (req.method === 'GET' && ['/', '/app.js', '/policy-ui.js', '/style.css', '/expenses', '/expense.html'].includes(url.pathname)) {
      const name = url.pathname === '/' ? 'index.html' : url.pathname === '/expenses' ? 'expense.html' : url.pathname.slice(1);
      res.writeHead(200, { 'Content-Type': name.endsWith('.js') ? 'text/javascript; charset=utf-8' : name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8' });
      return res.end(await fs.readFile(path.join(root, 'public', name)));
    }
    send(res, 404, { error: '接口不存在' });
  } catch (error) { send(res, 400, { error: error.message }); }
}
http.createServer((req, res) => {
  if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) return send(res, 403, { error: '不允许跨站请求' });
  queue = queue.then(() => handle(req, res)).catch(error => console.error(error));
}).listen(Number(process.env.PORT ?? 3080), '127.0.0.1', () => console.log('报销助手_lst：http://127.0.0.1:3080（本地 Demo）'));
