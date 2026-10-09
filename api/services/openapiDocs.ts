// 4.1.0: /api/openapi 文档页 —— 自包含 HTML，无外部 CDN 依赖。
// 从 /api/openapi.json 拉取规范并按分组渲染，供人与 Agent 查阅。

export function renderOpenApiDocsHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>FP 系统 API 文档</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: "Microsoft YaHei", system-ui, sans-serif; margin: 0; background: #f1f5f9; color: #0f172a; }
  header { background: #0f172a; color: #fff; padding: 20px 28px; }
  header h1 { margin: 0 0 6px; font-size: 20px; }
  header p { margin: 0; color: #94a3b8; font-size: 13px; }
  main { max-width: 960px; margin: 24px auto; padding: 0 16px; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px 20px; margin-bottom: 16px; }
  .tag { display: inline-block; background: #e0e7ff; color: #3730a3; border-radius: 6px; padding: 2px 10px; font-size: 13px; font-weight: 600; margin-bottom: 10px; }
  .ep { border-top: 1px dashed #e2e8f0; padding: 10px 0 4px; }
  .ep:first-of-type { border-top: none; }
  .method { display: inline-block; min-width: 58px; text-align: center; border-radius: 6px; padding: 2px 8px; font-size: 12px; font-weight: 700; color: #fff; margin-right: 8px; }
  .m-get { background: #2563eb; } .m-post { background: #16a34a; } .m-patch { background: #d97706; } .m-delete { background: #dc2626; }
  .path { font-family: Consolas, monospace; font-weight: 600; word-break: break-all; }
  .desc { color: #475569; font-size: 13px; margin-top: 4px; white-space: pre-wrap; }
  pre { background: #0f172a; color: #e2e8f0; border-radius: 8px; padding: 12px 14px; overflow-x: auto; font-size: 12px; }
  code.inline { background: #e2e8f0; border-radius: 4px; padding: 1px 6px; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1 id="title">FP 系统 API 文档</h1>
  <p>Agent 接入说明 · 鉴权方式 · 全部接口清单（数据源：<code class="inline">/api/openapi.json</code>）</p>
</header>
<main>
  <div class="card" id="intro">正在加载规范…</div>
  <div id="groups"></div>
</main>
<script>
fetch('/api/openapi.json').then(r => r.json()).then(spec => {
  document.getElementById('title').textContent = spec.info.title + ' ' + spec.info.version;
  const intro = document.getElementById('intro');
  intro.innerHTML = '<div style="font-weight:700;margin-bottom:8px">使用方法</div><div class="desc">' +
    '全部接口支持两种鉴权：① 网页 session；② API Key 请求头 <code class="inline">Authorization: Bearer fpak_xxx</code> 或 <code class="inline">X-API-Key: fpak_xxx</code>。<br>' +
    'API Key 在「我的 → API 接入」创建，<b>权限与账号完全相等</b>，每分钟限 120 次，全程审计。</div>' +
    '<pre style="margin-top:10px">curl -H "Authorization: Bearer fpak_你的Key" ' + location.origin + '/api/reimbursements</pre>' +
    '<div class="desc" style="margin-top:8px;white-space:pre-wrap">' + (spec.info.description || '') + '</div>';

  const groups = {};
  for (const [p, methods] of Object.entries(spec.paths || {})) {
    for (const [m, op] of Object.entries(methods)) {
      const tag = (op.tags && op.tags[0]) || '其他';
      (groups[tag] = groups[tag] || []).push({ p, m: m.toUpperCase(), op });
    }
  }
  const order = spec.tags.map(t => t.name).filter(n => groups[n]);
  for (const name of order.concat(Object.keys(groups).filter(n => !order.includes(n)))) {
    const div = document.createElement('div');
    div.className = 'card';
    let html = '<div class="tag">' + name + '</div>';
    for (const { p, m, op } of groups[name]) {
      html += '<div class="ep"><span class="method m-' + m.toLowerCase() + '">' + m + '</span>' +
        '<span class="path">' + p + '</span>' +
        '<div class="desc"><b>' + (op.summary || '') + '</b>' + (op.description ? '\\n' + op.description : '') + '</div></div>';
    }
    div.innerHTML = html;
    document.getElementById('groups').appendChild(div);
  }
}).catch(e => {
  document.getElementById('intro').textContent = '加载失败: ' + e;
});
</script>
</body>
</html>`
}
