export const categories = ['交通', '住宿', '餐饮', '办公', '其他'];
export function cents(value) {
  const text = String(value ?? '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('金额须为非负数字，最多两位小数');
  const [whole, fraction = ''] = text.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result) || result > 100000000) throw new Error('金额超出范围');
  return result;
}
export function inspect(items) {
  const issues = [], seen = new Set();
  let totalCents = 0;
  for (const [index, item] of items.entries()) {
    const label = `第 ${index + 1} 笔`;
    try { const amount = cents(item.amount); totalCents += amount; if (!amount) issues.push(`${label}：金额必须大于零`); }
    catch (error) { issues.push(`${label}：${error.message}`); }
    if (!item.merchant?.trim()) issues.push(`${label}：缺少商户名称`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date ?? '') || !Number.isFinite(Date.parse(item.date)) || new Date(item.date).toISOString().slice(0, 10) !== item.date) issues.push(`${label}：日期无效`);
    if (!categories.includes(item.category)) issues.push(`${label}：费用类别无效`);
    if (!item.invoiceNumber?.trim()) issues.push(`${label}：缺少发票号码`);
    else if (seen.has(item.invoiceNumber.trim())) issues.push(`${label}：发票号码重复`);
    else seen.add(item.invoiceNumber.trim());
    if (!item.attachmentId) issues.push(`${label}：缺少票据附件`);
  }
  if (!items.length) issues.push('请至少添加一笔费用');
  return { totalCents, issues, ready: issues.length === 0 };
}
export function normalizeItems(items) {
  if (!Array.isArray(items) || items.length > 100) throw new Error('费用明细须为数组，最多 100 笔');
  return items.map(item => Object.fromEntries(['merchant', 'date', 'category', 'amount', 'invoiceNumber', 'attachmentId'].map(key => [key, String(item?.[key] ?? '').slice(0, 200)])));
}
export function reply(message, claim) {
  const result = inspect(claim.items);
  if (/审批|状态|进度/.test(message)) return claim.oa ? `模拟 OA 单号 ${claim.oa.id}，当前状态：${claim.oa.status}。可在 OA 面板刷新状态。` : '这份报销单尚未提交 OA。先检查材料并生成报销单，再点击「提交模拟 OA」。';
  if (/金额|总计|汇总/.test(message)) return `本次共 ${claim.items.length} 笔费用，合计 ¥${(result.totalCents / 100).toFixed(2)}。\n${categories.map(category => { const sum = claim.items.filter(i => i.category === category).reduce((n, i) => { try { return n + cents(i.amount); } catch { return n; } }, 0); return `${category}：¥${(sum / 100).toFixed(2)}`; }).join(' · ')}`;
  return result.ready ? '材料检查通过：商户、日期、金额、发票号码和附件均已填写。你可以生成报销单，核对后提交模拟 OA。此检查不包含发票真伪查验或企业制度审核。' : `当前有 ${result.issues.length} 项需要补充：\n${result.issues.join('\n')}\n完善后再次点击「检查并生成报销单」。`;
}
