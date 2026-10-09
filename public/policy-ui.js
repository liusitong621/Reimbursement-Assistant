const $ = id => document.getElementById(id);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let session;
async function api(url, input) { const response = await fetch(url, input === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }); const result = await response.json(); if (!response.ok) throw new Error(result.error || '请求失败'); return result; }
function toast(text) { $('toast').textContent = text; $('toast').style.display = 'block'; setTimeout(() => $('toast').style.display = 'none', 5000); }
async function run(action) { try { await action(); } catch (error) { toast(error.message); } }
function card(p) { return `<article class="policy-result"><div class="section-title"><h3>${esc(p.title)}</h3><span class="badge">${p.demo ? '合成演示制度' : '维护者录入制度'}</span></div><div class="policy-meta">版本 ${esc(p.version)} · ${esc(p.startsOn)} 起生效${p.endsOn ? `，至 ${esc(p.endsOn)}` : ''}<br>来源：${esc(p.source)} · 维护：${esc(p.owner)}</div><div class="policy-text">${esc(p.content)}</div></article>`; }
async function search(query = '') { const result = await api('/api/policy-query', { query }); $('answer').textContent = result.answer; $('policies').innerHTML = result.results.map(card).join(''); }
$('search').onsubmit = event => { event.preventDefault(); run(() => search($('query').value)); };
document.querySelectorAll('[data-query]').forEach(button => button.onclick = () => { $('query').value = button.dataset.query; run(() => search(button.dataset.query)); });
async function loadIdentity() {
  session = await api('/api/session'); $('identity').value = { 'employee-demo': 'employee', 'employee-other': 'other', qiao: 'qiao', zhou: 'zhou' }[session.account.id];
  $('identity-note').textContent = '演示身份切换仅用于验证分工，真实部署需企业 SSO。';
  $('maintenance').hidden = session.account.role !== 'policy_owner'; $('fact-review').hidden = session.account.role !== 'fact_reviewer'; $('self-status').hidden = session.account.role !== 'employee'; $('consent').checked = session.consent;
  $('my-claims').innerHTML = ''; await search();
  if (session.account.role === 'policy_owner') await versions();
  if (session.account.role === 'fact_reviewer') await facts();
}
$('identity').onchange = () => run(async () => { await api('/api/session', { account: $('identity').value }); await loadIdentity(); });
async function versions() { const result = await api('/api/policies'); $('versions').innerHTML = '<h3 style="margin-top:24px">制度版本记录</h3>' + result.policies.map(p => `<div class="version-entry">${card(p)}<div class="actions"><span class="muted">${esc({draft:'草稿',published:'已发布',withdrawn:'已撤回'}[p.status])} · ${p.effective ? '当前有效' : '非当前有效'}</span><button class="secondary" data-publish="${p.id}">发布此版本</button><button class="secondary" data-withdraw="${p.id}">撤回此版本</button></div></div>`).join(''); }
$('policy-form').onsubmit = event => { event.preventDefault(); run(async () => { const data = Object.fromEntries(new FormData(event.target)); data.demo = data.demo === 'on'; await api('/api/policies', data); event.target.reset(); await versions(); toast('制度草稿已保存，确认后发布'); }); };
$('example').onclick = () => { const form = $('policy-form'); const values = { title: '差旅报销材料要求（合成样例）', version: 'DEMO-v1', startsOn: '2026-10-01', endsOn: '2027-12-31', source: 'DEMO-POLICY-001 / 合成样例，非真实企业制度', tags: '差旅 住宿 发票 交通', content: '【仅用于演示，不代表公司真实规定】\n适用范围：演示员工的国内差旅。\n条款 1：提交差旅报销时，应提供费用明细及对应发票。\n条款 2：住宿费用需附住宿发票；交通费用需附交通票据。\n条款 3：缺失材料的处理方式须由财务确认，本样例不设定报销额度。' }; for (const [key, value] of Object.entries(values)) form.elements[key].value = value; form.elements.demo.checked = true; };
$('versions').onclick = event => run(async () => { const id = event.target.dataset.publish || event.target.dataset.withdraw; if (!id) return; const action = event.target.dataset.publish ? 'publish' : 'withdraw'; if (!confirm(action === 'publish' ? '确认发布此版本？请核对来源和有效期。' : '确认撤回此版本？')) return; await api(`/api/policies/${id}/${action}`, {}); await versions(); await search($('query').value); });
$('consent').onchange = () => run(async () => { try { session = await api('/api/consent', { authorized: $('consent').checked }); $('my-claims').innerHTML = ''; toast(session.consent ? '已授权查询本人单据状态' : '授权已撤回'); } catch (error) { $('consent').checked = session.consent; throw error; } });
$('query-status').onclick = () => run(async () => {
  session = await api('/api/session'); if (!session.consent) throw new Error('请先明确授权查询本人单据状态');
  const data = await api('/api/state'); $('my-claims').innerHTML = data.claims.length ? data.claims.map(c => `<div class="policy-result"><h3>${esc(c.title)}</h3><p class="muted">${esc(c.statusNote)}</p>${c.factCheckedAt ? `<p>模拟 OA：${esc(c.oa?.status || '尚未提交')}<br><small>核对人：周敏 · ${esc(c.factCheckedAt)}</small></p>` : '<p>待周敏核对，不推断审批进度。</p>'}</div>`).join('') : '<p class="muted">当前身份没有单据。可从「票据流程演示」创建模拟单据。</p>';
});
async function facts() { const data = await api('/api/facts'); $('facts').innerHTML = data.claims.length ? data.claims.map(c => `<div class="policy-result"><h3>${esc(c.title)}</h3><p>${esc(c.employee)} · 模拟 OA：${esc(c.oa.status)}</p><p class="muted">${esc(c.oa.id)}<br>${c.factCheckedAt ? `周敏已核对：${esc(c.factCheckedAt)}` : '尚未核对'}</p><button class="secondary" data-verify="${c.id}">确认已核对模拟业务事实</button></div>`).join('') : '<p class="muted">暂无已提交模拟 OA 的单据。</p>'; }
$('refresh-facts').onclick = () => run(facts);
$('facts').onclick = event => run(async () => { const id = event.target.dataset.verify; if (!id || !confirm('确认核对这笔模拟单据的业务事实？')) return; await api(`/api/facts/${id}/verify`, {}); await facts(); toast('核对记录已保存'); });
await run(loadIdentity);
