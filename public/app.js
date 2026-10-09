const $ = id => document.getElementById(id);
let items = [], state = { claims: [], attachments: [] }, current = null, busy = false;
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = value => `¥${(value / 100).toFixed(2)}`;
function toast(message) { $('toast').textContent = message; $('toast').style.display = 'block'; setTimeout(() => $('toast').style.display = 'none', 5000); }
async function api(url, data) {
  const response = await fetch(url, data === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.report?.issues?.join('\n') || result.error || '请求失败');
  return result;
}
async function run(action) {
  if (busy) return;
  busy = true; document.querySelectorAll('button').forEach(b => b.disabled = true);
  try { await action(); } catch (error) { toast(error.message); }
  finally { busy = false; document.querySelectorAll('button').forEach(b => b.disabled = false); }
}
function bubble(text, user = false) { const element = document.createElement('div'); element.className = `bubble${user ? ' user' : ''}`; element.textContent = text; $('messages').append(element); $('messages').scrollTop = $('messages').scrollHeight; }
function renderItems() {
  $('items').innerHTML = items.length ? items.map((i, index) => `<div class="item"><div class="item-head"><span>费用 ${String(index + 1).padStart(2, '0')}</span><button class="remove" data-remove="${index}">移除</button></div><div class="item-grid">${[['merchant','商户名称','text'],['date','费用日期','date'],['amount','金额（元）','text'],['invoiceNumber','发票号码','text']].map(([key,label,type]) => `<label>${label}<input data-index="${index}" data-key="${key}" type="${type}" value="${escape(i[key])}" ${key === 'amount' ? 'inputmode="decimal"' : ''}></label>`).join('')}<label>费用类别<select data-index="${index}" data-key="category">${['交通','住宿','餐饮','办公','其他'].map(c => `<option ${i.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label><label>票据附件<select data-index="${index}" data-key="attachmentId"><option value="">请选择附件</option>${state.attachments.map(a => `<option value="${a.id}" ${a.id === i.attachmentId ? 'selected' : ''}>${escape(a.name)}</option>`).join('')}</select></label></div></div>`).join('') : '<div class="empty">上传第一张票据，开始本次报销</div>';
  total();
}
function total() { const sum = items.reduce((n, i) => { if (!/^\d+(\.\d{1,2})?$/.test(i.amount ?? '')) return n; const [whole, fraction = ''] = i.amount.split('.'); return n + Number(whole) * 100 + Number(fraction.padEnd(2, '0')); }, 0); $('total').textContent = money(sum); }
function invalidate() { current = null; $('issues').textContent = ''; renderOA(); }
$('items').addEventListener('input', event => { const { index, key } = event.target.dataset; if (key) { items[Number(index)][key] = event.target.value; invalidate(); total(); } });
$('items').addEventListener('click', event => { if (event.target.dataset.remove !== undefined) { items.splice(Number(event.target.dataset.remove), 1); invalidate(); renderItems(); } });
['employee','title'].forEach(id => $(id).addEventListener('input', invalidate));
function blank(attachmentId = '') { return { merchant: '', date: '', category: '其他', amount: '', invoiceNumber: '', attachmentId }; }
$('add').onclick = () => { items.push(blank()); invalidate(); renderItems(); };
async function upload(file) {
  const content = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]); reader.onerror = reject; reader.readAsDataURL(file); });
  const fallback = file.name.endsWith('.json') ? 'application/json' : file.name.endsWith('.txt') ? 'text/plain' : '';
  const result = await api('/api/attachments', { name: file.name, type: file.type || fallback, content }); state.attachments.push(result); return result;
}
$('files').onchange = () => run(async () => {
  const files = [...$('files').files]; invalidate();
  for (const file of files) {
    if (file.size > 8 * 1024 * 1024) throw new Error(`${file.name} 超过 8 MB`);
    $('upload-status').textContent = `正在保存 ${file.name}…`;
    const attachment = await upload(file);
    let entry = blank(attachment.id);
    if (file.name.endsWith('.json')) {
      try { const parsed = JSON.parse(await file.text()); entry = { ...entry, ...Object.fromEntries(['merchant','date','category','amount','invoiceNumber'].map(key => [key, String(parsed[key] ?? entry[key])])), attachmentId: attachment.id }; }
      catch { toast('JSON 解析失败，附件已保存，请手动录入'); }
    }
    items.push(entry); renderItems();
  }
  $('upload-status').textContent = '附件已保存在本机。请核对并补全费用字段。'; $('files').value = '';
});
$('sample').onclick = () => run(async () => {
  if (items.length && !confirm('载入演示数据会替换当前未保存明细，是否继续？')) return;
  const token = Date.now();
  const examples = [{ merchant: '演示高铁票（非真实票据）', date: '2026-10-08', category: '交通', amount: '553.00', invoiceNumber: `DEMO-${token}-01` }, { merchant: '演示酒店（非真实票据）', date: '2026-10-08', category: '住宿', amount: '420.00', invoiceNumber: `DEMO-${token}-02` }];
  const loaded = [];
  for (const example of examples) { const attachment = await upload(new File([JSON.stringify(example, null, 2)], `${example.invoiceNumber}.json`, { type: 'application/json' })); loaded.push({ ...example, attachmentId: attachment.id }); }
  items = loaded; $('employee').value = '演示用户'; $('title').value = '上海客户拜访差旅（演示）'; invalidate(); renderItems(); bubble('已载入两份合成演示票据，共 ¥973.00。你可以核对明细，然后生成报销单。');
});
$('generate').onclick = () => run(async () => {
  if (current) { toast('当前报销单已生成，可直接提交 OA 或导出'); return; }
  const check = await api('/api/agent', { message: '检查缺失材料', items }); bubble(check.reply);
  try { current = await api('/api/claims', { employee: $('employee').value, title: $('title').value, items }); }
  catch (error) { $('issues').textContent = error.message; throw error; }
  $('issues').textContent = '✓ 报销单已生成，请核对后提交。'; await refresh(); renderOA();
});
function renderOA() {
  if (!current) { $('oa').innerHTML = '<p class="muted">生成报销单后，在此提交并跟踪审批。</p>'; return; }
  $('oa').innerHTML = `<div class="oa-status"><span class="muted">${escape(current.oa?.id || (current.submitted ? '已提交模拟 OA' : '报销单已生成 · 尚未提交'))}</span><strong>${escape(current.oa?.status || (current.submitted ? current.statusNote : '待提交模拟 OA'))}</strong><span>${escape(current.title)} · ${money(current.totalCents)}</span></div><div class="actions">${current.submitted || current.oa ? '<button class="secondary" data-action="status">刷新审批状态</button><a href="/">返回制度台授权 / 核对</a>' : '<button class="primary" data-action="submit">确认并提交模拟 OA</button>'}<button class="secondary" data-action="export">导出报销单 JSON</button><button class="secondary" data-action="print">打印报销单</button></div><ul class="timeline">${current.events.map(e => `<li>${escape(e.text)} <span class="muted">${new Date(e.at).toLocaleString('zh-CN')}</span></li>`).join('')}</ul>`;
}
$('oa').onclick = event => run(async () => {
  const action = event.target.dataset.action; if (!action || !current) return;
  if (action === 'export') { const link = document.createElement('a'); link.href = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: 'application/json' })); link.download = `报销单-${current.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000); return; }
  if (action === 'print') { const win = window.open('', '_blank'); if (!win) throw new Error('请允许弹窗以打印报销单'); win.document.write(`<html><meta charset="UTF-8"><title>报销单</title><style>body{font-family:system-ui;padding:40px}table{width:100%;border-collapse:collapse}td,th{padding:12px;border:1px solid #ccc}p{line-height:2}</style><h1>报销单 · 报销助手_lst</h1><p>申请人：${escape(current.employee)}<br>事由：${escape(current.title)}<br>单号：${escape(current.id)}<br>环境：本地 Demo，非真实 OA 提交</p><table><tr><th>日期</th><th>商户</th><th>类别</th><th>发票号码</th><th>金额</th></tr>${current.items.map(i => `<tr><td>${escape(i.date)}</td><td>${escape(i.merchant)}</td><td>${escape(i.category)}</td><td>${escape(i.invoiceNumber)}</td><td>${escape(i.amount)}</td></tr>`).join('')}</table><h2>合计：${money(current.totalCents)}</h2><p>申请人签字：_______________　　审批人：_______________</p></html>`); win.document.close(); win.print(); return; }
  current = await api(`/api/claims/${current.id}/${action}`, {}); await refresh(); renderOA(); bubble(current.oa ? `模拟 OA：${current.oa.status}。` : `已提交模拟 OA。${current.statusNote}`);
});
async function ask(message) { bubble(message, true); const result = await api(current ? `/api/claims/${current.id}/chat` : '/api/agent', { message, items }); bubble(result.reply); }
$('chat').onsubmit = event => { event.preventDefault(); const text = $('message').value.trim(); if (!text) return; $('message').value = ''; run(() => ask(text)); };
document.querySelectorAll('[data-ask]').forEach(button => button.onclick = () => run(() => ask(button.dataset.ask)));
async function refresh() { state = await api('/api/state'); $('history').innerHTML = state.claims.length ? state.claims.map(c => `<div class="history-row"><div>${escape(c.title)}<small>${escape(c.employee)} · ${escape(c.oa?.status || '待提交')} · ${money(c.totalCents)}</small></div><button data-open="${c.id}">查看</button></div>`).join('') : '<p class="muted">还没有报销记录</p>'; }
$('history').onclick = event => { const claim = state.claims.find(c => c.id === event.target.dataset.open); if (!claim) return; current = claim; items = claim.items.map(i => ({ ...i })); $('employee').value = claim.employee; $('title').value = claim.title; renderItems(); renderOA(); };
$('new').onclick = () => { if (items.length && !confirm('清空当前工作台？已生成记录将保留。')) return; items = []; current = null; $('employee').value = ''; $('title').value = ''; $('issues').textContent = ''; renderItems(); renderOA(); };
await run(async () => { await refresh(); renderItems(); bubble('你好，我是报销助手_lst。上传票据后，我会检查字段与附件、汇总费用，并帮助你跟踪模拟 OA 审批。点击「载入演示票据」可以先体验完整流程。'); });
