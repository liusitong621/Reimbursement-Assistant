export function shanghaiDay(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
export function effective(policy, day = shanghaiDay()) {
  return policy.status === 'published' && policy.startsOn <= day && (!policy.endsOn || policy.endsOn >= day);
}
export function searchPolicies(policies, query, day = shanghaiDay()) {
  const text = String(query).trim().toLowerCase();
  const terms = text.match(/[a-z0-9]+|[\u4e00-\u9fff]{2}/g) || [text];
  return policies.filter(p => effective(p, day)).map(p => {
    const haystack = `${p.title} ${p.content} ${p.tags}`.toLowerCase();
    const score = !text ? 1 : (haystack.includes(text) ? 100 : terms.reduce((n, t) => n + (haystack.includes(t) ? 1 : 0), 0));
    return { ...p, score };
  }).filter(p => p.score > 0).sort((a, b) => b.score - a.score);
}
export function validDay(value) { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value; }
