// 4.1.0: OpenAPI 3.1 规范 —— Agent / 第三方接入 FP 报销系统的唯一权威接口说明。
// 由 GET /api/openapi.json 输出；配套简版文档页 GET /api/openapi。
// 维护约定：新增或修改任何 /api 端点时，必须同步更新本文件对应条目。

export type OpenApiSpec = Record<string, unknown>

const envelope = {
  type: 'object',
  properties: {
    success: { type: 'boolean', description: '是否成功' },
    data: { description: '业务数据，失败时不存在' },
    error: { type: 'string', description: '失败时的中文错误信息' },
  },
}

const jsonBody = (props: Record<string, unknown>, required: string[] | undefined, description: string) => ({
  required: true,
  content: { 'application/json': { schema: { type: 'object', properties: props, required } } },
  description,
})

const okResponse = (description: string, dataSchema?: Record<string, unknown>) => ({
  200: {
    description,
    content: { 'application/json': { schema: dataSchema ? { ...envelope, properties: { ...envelope.properties, data: dataSchema } } : envelope } },
  },
  401: { description: '未登录 / API Key 无效' , content: { 'application/json': { schema: envelope } } },
  403: { description: '当前账号角色无权执行该操作', content: { 'application/json': { schema: envelope } } },
})

const statusEnum = ['draft', 'unfinished', 'pending_review', 'needs_revision', 'completed', 'reimbursed']
const statusDesc = [
  'draft=草稿（编辑中，未提交）',
  'unfinished=未完结报销（已提交，未送审）',
  'pending_review=待审核（已送审）',
  'needs_revision=待修改（被驳回）',
  'completed=已办结（审批通过）',
  'reimbursed=已报销（财务核销到账）',
].join('；')

const stateMachineDesc = [
  '状态机（只允许以下流转，其余一律被服务端拒绝）：',
  '1) draft → unfinished：提交（创建者/admin）',
  '2) unfinished → pending_review：送审（创建者/admin；金额不一致时必须已填 amountMismatchNote 且已选 amountStandard）',
  '3) needs_revision → pending_review：修改后重新送审（同上校验）',
  '4) pending_review → completed：审批通过（部门领导/admin）',
  '5) pending_review → needs_revision：审批驳回（领导/admin，必须填 reason）',
  '6) pending_review / needs_revision → unfinished：撤回送审（创建者/admin）',
  '7) completed → reimbursed：核销（财务/admin）',
  '8) reimbursed → completed：退回核销（仅 admin）',
  '9) unfinished / pending_review / needs_revision → draft：转回草稿（自动退回占用的备用金）',
].join('\n')

const createPayloadDesc = [
  'multipart/form-data：字段 payload（JSON 字符串）+ 附件文件字段。',
  'payload JSON 结构：{',
  '  title: string 报销标题,',
  '  categoryId?: string 报销分类ID,',
  '  status: "draft" | "unfinished" | "pending_review",',
  '  invoiceSellerName?: string 销售方名称,',
  '  invoiceSellerTaxNo?: string 销售方税号,',
  '  invoiceAmountExcludingTax?: number 不含税金额,',
  '  invoiceTaxAmount?: number 税额合计,',
  '  invoiceTaxRate?: string 税率（如 "1%"）,',
  '  invoiceTotalAmount?: number 价税合计,',
      '  invoiceNumber?: string 发票号码,',
      '  invoiceStatus?: "none" | "not_issued" | "waiting_issued" | "issued" 发票状态（枚举：none=无发票, not_issued=未开票, waiting_issued=等待开票中, issued=已开票；注意传枚举值而非中文）,',
  '  amountStandard?: "invoice" | "orders" 金额标准（发票金额与订单金额不一致时必选，无系统默认）,',
  '  amountMismatchNote?: string 金额差异说明（不一致且要送审时必填）,',
  '  orders: Array<{ sequence: number 子单序号(从1开始), platformCategory?: string 平台分类, platformName?: string 平台名称, merchantName?: string 商家名称, itemDescription?: string 商品信息, orderNumber?: string 订单号, paymentTime?: string "YYYY-MM-DD HH:mm", paymentAmount?: number 支付金额(两位小数), orderStatus?: string 订单状态(自由文本，如 已完成/待收货), note?: string 备注, purchaserId?: string 采购人用户ID, paymentMode: "personal_reimbursement"=个人垫资需报销 | "reserve_fund"=该订单使用备用金, userIds?: string[] 使用人用户ID }>',
  '}',
  '附件文件字段：invoiceImages（发票截图，可多个）；orderImages_{sequence}（第 sequence 个子单的订单截图，每单最多2张）。',
  '首个订单自动为母单（isParentOrder）。',
  '服务端校验：发票号/订单号与已有记录重复→400 拒绝；金额不一致且缺标准/说明→400。',
].join('\n')

export const openapiSpec: OpenApiSpec = {
  openapi: '3.1.0',
  info: {
    title: 'FP 报销信息整理识别系统 API',
    version: '4.1.0',
    description: [
      '中国式增值税发票 + 订单截图 OCR 自动识别报销系统。',
      '',
      '## 鉴权（API Key，权限与账号完全相等）',
      '1. 网页登录后进入「我的 → API 接入」创建 API Key（明文只显示一次，格式 fpak_ 开头）。',
      '2. 调用时携带请求头：`Authorization: Bearer fpak_xxx` 或 `X-API-Key: fpak_xxx`。',
      '3. Key 即账号化身：Key 的权限与所属账号在网页端完全一致（员工/部门领导/财务/管理员同一套角色检查），不做任何放大或收窄。',
      '4. 角色：employee=员工 < leader=部门领导 < finance=财务(仅查看) < admin=管理员。',
      '5. 默认限速每 Key 每分钟 120 次，超限返回 429；所有 API Key 调用都会写入审计日志（管理员可在 API 接入页查看）。',
      '6. 登录接口 POST /api/auth/login 不接受 API Key；Key 不要放 URL 参数里。',
      '',
      '## 通用约定',
      '- 响应统一为 `{ success: boolean, data?: ..., error?: string }`，error 为中文可直接展示。',
      '- 本规范即完整功能清单：网页端每个功能都有对应接口。',
      '',
      `## 报销单状态机\n${stateMachineDesc}`,
      '',
      '## 常用业务规则',
      '- 发票金额与订单金额之和不一致时：必须显式传 amountStandard（invoice=以发票金额为准，母单显示发票金额、子单显示0；orders=以订单支付金额为准），不允许默认值；送审还必须填 amountMismatchNote。',
      '- 新建/编辑时发票号、订单号与库中已有记录重复会被 400 拒绝（同一单自身编号除外）。',
      '- 财务(finance)角色不能新建/编辑报销单，仅查看与核销。',
      '- 备用金：paymentMode=reserve_fund 的订单占用备用金额度，personal_reimbursement 不占用。',
      '- 所有列表筛选均支持时间段（范围/节点前/节点后）。',
    ].join('\n'),
  },
  servers: [{ url: '/', description: '当前站点' }],
  components: {
    securitySchemes: {
      ApiKeyAuth: { type: 'http', scheme: 'bearer', description: 'API Key：fpak_ 开头，权限与账号完全相等' },
      SessionCookie: { type: 'apiKey', in: 'cookie', name: 'fp.sid', description: '网页端会话' },
    },
  },
  security: [{ ApiKeyAuth: [] }, { SessionCookie: [] }],
  tags: [
    { name: '认证', description: '登录态与个人资料' },
    { name: '报销单', description: '核心业务：创建/查询/状态流转/批量操作' },
    { name: '审批', description: '部门领导/管理员审批' },
    { name: '识别(OCR)', description: '发票/订单截图识别' },
    { name: '导出', description: 'xlsx 与附件合集 PDF 导出' },
    { name: '备用金', description: '备用金余额与调整流水' },
    { name: '分类', description: '报销分类管理' },
    { name: '用户管理', description: '管理员用户管理' },
    { name: '工作台', description: '统计与通知' },
    { name: 'API Key', description: 'Agent 接入凭证管理' },
    { name: '系统', description: '健康检查等' },
  ],
  paths: {
    '/api/auth/login': {
      post: {
        tags: ['认证'], summary: '账号密码登录（获取 session cookie；API Key 不能用于此接口）',
        requestBody: jsonBody({ username: { type: 'string' }, password: { type: 'string' } }, ['username', 'password'], '账号密码'),
        responses: okResponse('返回用户信息，并 Set-Cookie fp.sid（90天有效）'),
      },
    },
    '/api/auth/me': {
      get: { tags: ['认证'], summary: '当前登录用户信息（API Key 请求返回 Key 所属账号）', responses: okResponse('用户信息；未登录时 data=null') },
    },
    '/api/auth/logout': {
      post: { tags: ['认证'], summary: '退出登录（销毁 session；API Key 请求直接返回成功）', responses: okResponse('退出成功') },
    },
    '/api/auth/acknowledge-reserve-notice': {
      post: { tags: ['认证'], summary: '确认已读备用金变动通知', responses: okResponse('确认成功') },
    },
    '/api/auth/profile': {
      patch: {
        tags: ['认证'], summary: '修改显示名称 / 密码',
        requestBody: jsonBody({ displayName: { type: 'string', description: '新显示名称(≤30字)' }, currentPassword: { type: 'string', description: '改密码时必填' }, newPassword: { type: 'string', description: '新密码(≥4字符)' } }, undefined, '至少传一项'),
        responses: okResponse('更新后的用户信息'),
      },
    },
    '/api/dashboard/': {
      get: { tags: ['工作台'], summary: '工作台统计（六项统计卡、备用金概览、最近编辑、审核信息、提醒）', responses: okResponse('统计数据') },
    },
    '/api/dashboard/notifications': {
      get: { tags: ['工作台'], summary: '待办通知（待审批/被驳回等需要当前用户处理的事项）', responses: okResponse('通知列表') },
    },
    '/api/reimbursements/meta': {
      get: { tags: ['报销单'], summary: '元数据：用户列表（采购人/使用人可选值）、分类列表、编号规则等新建单所需基础数据', responses: okResponse('元数据') },
    },
    '/api/reimbursements': {
      get: {
        tags: ['报销单'], summary: '报销单列表（当前用户可见范围按角色过滤）',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string', enum: statusEnum }, description: statusDesc },
          { name: 'keyword', in: 'query', schema: { type: 'string' }, description: '关键词模糊搜索' },
          { name: 'categoryId', in: 'query', schema: { type: 'string' }, description: '报销分类' },
        ],
        responses: okResponse('报销单数组（含订单、附件、审核记录）'),
      },
      post: {
        tags: ['报销单'], summary: '新建报销单（支持草稿/提交/直接送审三种状态）',
        description: createPayloadDesc,
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: {
                  payload: { type: 'string', description: '报销单 JSON（结构见 description）' },
                  invoiceImages: { type: 'array', items: { type: 'string', format: 'binary' }, description: '发票截图（可多张）' },
                  'orderImages_1': { type: 'array', items: { type: 'string', format: 'binary' }, description: '第1个子单的订单截图（orderImages_{sequence} 依序类推，每单最多2张）' },
                },
                required: ['payload'],
              },
            },
          },
        },
        responses: { ...okResponse('创建成功的报销单'), 400: { description: '编号重复 / 金额不一致缺标准或说明等业务校验失败', content: { 'application/json': { schema: envelope } } } },
      },
    },
    '/api/reimbursements/records': {
      get: {
        tags: ['报销单'], summary: '查看与导出用的扁平记录行（每订单一行，含全部列字段）',
        parameters: [
          { name: 'status', in: 'query', schema: { type: 'string' }, description: '状态筛选' },
          { name: 'dateFrom', in: 'query', schema: { type: 'string' }, description: '创建/支付时间筛选起点' },
          { name: 'dateTo', in: 'query', schema: { type: 'string' }, description: '筛选终点' },
        ],
        responses: okResponse('扁平记录行数组'),
      },
    },
    '/api/reimbursements/numbers': {
      get: { tags: ['报销单'], summary: '全部已有发票号与订单号（前端查重用）', responses: okResponse('{ invoice: string[], orders: string[] }') },
    },
    '/api/reimbursements/{id}': {
      get: { tags: ['报销单'], summary: '报销单详情', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: okResponse('报销单详情') },
      patch: {
        tags: ['报销单'], summary: '编辑报销单（仅创建者/admin，且状态可编辑）',
        description: '请求体与新建相同（multipart：payload + 附件字段）。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: okResponse('更新后的报销单'),
      },
      delete: {
        tags: ['报销单'], summary: '删除报销单（仅创建者/admin，且仅 draft/unfinished 状态）',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: okResponse('删除成功'),
      },
    },
    '/api/reimbursements/{id}/review': {
      post: {
        tags: ['报销单'], summary: '审批单条（领导/admin）',
        description: stateMachineDesc,
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: jsonBody({ action: { type: 'string', enum: ['approve', 'reject'] }, reason: { type: 'string', description: '驳回时必填原因' } }, ['action'], '审批动作'),
        responses: okResponse('审批完成'),
      },
    },
    '/api/reimbursements/{id}/withdraw': {
      post: { tags: ['报销单'], summary: '撤回送审（pending_review/needs_revision → unfinished，创建者/admin）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: okResponse('撤回成功') },
    },
    '/api/reimbursements/{id}/reimburse': {
      post: { tags: ['报销单'], summary: '核销（completed → reimbursed，财务/admin）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: okResponse('核销成功') },
    },
    '/api/reimbursements/{id}/undo-reimburse': {
      post: { tags: ['报销单'], summary: '退回核销（reimbursed → completed，仅 admin）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: okResponse('退回成功') },
    },
    '/api/reimbursements/batch-reimburse': {
      post: { tags: ['报销单'], summary: '批量核销（财务/admin；自动跳过非 completed 的单）', requestBody: jsonBody({ ids: { type: 'array', items: { type: 'string' } } }, ['ids'], '报销单ID数组'), responses: okResponse('批量核销结果') },
    },
    '/api/reimbursements/batch-status': {
      post: {
        tags: ['报销单'], summary: '批量改状态（逐单校验状态机合法性，合法执行、非法跳过并汇报）',
        description: stateMachineDesc,
        requestBody: jsonBody({ ids: { type: 'array', items: { type: 'string' } }, status: { type: 'string', enum: statusEnum, description: statusDesc }, reason: { type: 'string', description: '改为 needs_revision 时必填原因' } }, ['ids', 'status'], '批量目标状态'),
        responses: okResponse('成功 N 张、跳过 M 张及原因'),
      },
    },
    '/api/reimbursements/batch-delete': {
      post: { tags: ['报销单'], summary: '批量删除（仅创建者/admin 且 draft/unfinished；其余跳过）', requestBody: jsonBody({ ids: { type: 'array', items: { type: 'string' } } }, ['ids'], '报销单ID数组'), responses: okResponse('删除结果') },
    },
    '/api/reimbursements/attachments/{id}': {
      delete: { tags: ['报销单'], summary: '删除单个附件（重新上传前先删旧图）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: okResponse('删除成功') },
    },
    '/api/approvals/': {
      get: { tags: ['审批'], summary: '待审批列表（领导/admin）', responses: okResponse('待审批报销单数组（含完整明细）') },
    },
    '/api/approvals/batch-review': {
      post: { tags: ['审批'], summary: '批量审批（领导/admin；reject 必填 reason）', requestBody: jsonBody({ ids: { type: 'array', items: { type: 'string' } }, action: { type: 'string', enum: ['approve', 'reject'] }, reason: { type: 'string' } }, ['ids', 'action'], '批量审批'), responses: okResponse('批量审批结果') },
    },
    '/api/recognition/health': {
      get: { tags: ['识别(OCR)'], summary: 'OCR 服务健康检查', responses: okResponse('FP 与 OCR 服务状态') },
    },
    '/api/recognition/invoice-ocr': {
      post: {
        tags: ['识别(OCR)'], summary: '发票识别（一步式：上传+识别）',
        requestBody: { required: true, content: { 'multipart/form-data': { schema: { type: 'object', properties: { file: { type: 'string', format: 'binary', description: '发票图片或 PDF（≤10MB）' } }, required: ['file'] } } } },
        responses: okResponse('fields 数组：发票号码/开票日期/购销方名称与税号/明细/合计/价税合计/开票人等；PDF 每页一个 field'),
      },
    },
    '/api/recognition/invoice-ocr/upload': {
      post: { tags: ['识别(OCR)'], summary: '发票仅上传（返回 file_id 供 extract 分步识别）', responses: okResponse('file_id') },
    },
    '/api/recognition/invoice-ocr/extract': {
      post: { tags: ['识别(OCR)'], summary: '按 file_id 触发发票识别', requestBody: jsonBody({ file_id: { type: 'string' } }, ['file_id'], '上传返回的 file_id'), responses: okResponse('识别结果') },
    },
    '/api/recognition/order-ocr': {
      post: {
        tags: ['识别(OCR)'], summary: '4.1 新增：订单截图识别（Agent 可用；需登录/API Key）',
        description: '上传购物平台/支付订单截图，返回结构化字段。platform 传平台名（如 闲鱼/微信）可启用针对性识别；OCR 服务需支持 /api/v1/order-ocr（本地 FpLocalOcr 与升级后的服务器 OCR 支持）。',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: { type: 'object', properties: { file: { type: 'string', format: 'binary', description: '订单截图（≤10MB）' }, platform: { type: 'string', description: '平台名（可选，如 闲鱼、微信）' } }, required: ['file'] },
            },
          },
        },
        responses: okResponse('fields：platformName/merchantName/itemDescription/orderNumber/paymentTime/paymentAmount'),
      },
    },
    '/api/exports': {
      post: {
        tags: ['导出'], summary: '导出 xlsx + 附件合集 PDF',
        description: '按筛选与排序生成导出文件；响应含 fileUrl（xlsx）与 attachmentPdfUrl（PDF），均为相对路径可直接 GET 下载。导出顺序与传入排序一致。',
        requestBody: jsonBody({ filters: { type: 'object', description: '与 records 列表相同的筛选条件' }, columns: { type: 'array', items: { type: 'string' }, description: '导出列 key 顺序' }, sort: { type: 'object', properties: { column: { type: 'string' }, direction: { type: 'string', enum: ['asc', 'desc'] } } } }, undefined, '导出配置'),
        responses: okResponse('{ id, recordCount, fileUrl, attachmentPdfUrl }'),
      },
    },
    '/api/reserve-funds/': {
      get: { tags: ['备用金'], summary: '备用金概览与流水（领导/admin）', responses: okResponse('用户备用金与变动流水') },
    },
    '/api/reserve-funds/adjust': {
      post: { tags: ['备用金'], summary: '调整备用金（领导/admin；admin 可调所有人，领导仅员工）', requestBody: jsonBody({ targetUserId: { type: 'string' }, deltaAmount: { type: 'number', description: '正数增加、负数扣减，两位小数' }, note: { type: 'string' } }, ['targetUserId', 'deltaAmount'], '调整参数'), responses: okResponse('调整结果与新余额') },
    },
    '/api/categories/': {
      get: { tags: ['分类'], summary: '报销分类列表（含排序/单据数/总金额）', responses: okResponse('分类数组') },
      post: { tags: ['分类'], summary: '新建分类（员工/领导/admin；名称全局唯一、≤30字）', requestBody: jsonBody({ name: { type: 'string' }, description: { type: 'string' } }, ['name'], '分类信息'), responses: okResponse('新分类') },
    },
    '/api/categories/{id}': {
      patch: { tags: ['分类'], summary: '修改分类（仅 admin）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: jsonBody({ name: { type: 'string' }, description: { type: 'string' }, sortOrder: { type: 'number' } }, undefined, '修改字段'), responses: okResponse('更新后分类') },
      delete: {
        tags: ['分类'], summary: '删除分类（仅 admin；“默认类型”不可删）',
        description: '删除非默认分类时必须传 migrateToCategoryId，该分类下的报销单将迁移过去。',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        requestBody: jsonBody({ migrateToCategoryId: { type: 'string', description: '迁移目标分类ID（删除非默认分类时必填）' } }, undefined, '迁移目标'),
        responses: okResponse('删除并迁移完成'),
      },
    },
    '/api/admin/users': {
      get: { tags: ['用户管理'], summary: '用户列表（仅 admin）', responses: okResponse('用户数组') },
      post: { tags: ['用户管理'], summary: '新建用户（仅 admin）', requestBody: jsonBody({ username: { type: 'string' }, displayName: { type: 'string' }, password: { type: 'string' }, role: { type: 'string', enum: ['employee', 'leader', 'finance', 'admin'] } }, ['username', 'displayName', 'password', 'role'], '用户信息'), responses: okResponse('新用户') },
    },
    '/api/admin/users/{id}': {
      patch: { tags: ['用户管理'], summary: '修改用户（仅 admin）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: jsonBody({ displayName: { type: 'string' }, role: { type: 'string', enum: ['employee', 'leader', 'finance', 'admin'] } }, undefined, '修改字段'), responses: okResponse('更新后用户') },
      delete: { tags: ['用户管理'], summary: '删除用户（仅 admin）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: okResponse('删除成功') },
    },
    '/api/admin/users/{id}/reset-password': {
      post: { tags: ['用户管理'], summary: '重置用户密码（仅 admin）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], requestBody: jsonBody({ newPassword: { type: 'string' } }, ['newPassword'], '新密码'), responses: okResponse('重置成功') },
    },
    '/api/admin/overview': {
      get: { tags: ['用户管理'], summary: '全局总览（仅 admin：用户与最近报销单）', responses: okResponse('总览数据') },
    },
    '/api/api-keys': {
      get: { tags: ['API Key'], summary: '我的 API Key 列表（不含哈希）', responses: okResponse('Key 数组：id/name/prefix/lastUsedAt/expiresAt/revokedAt') },
      post: {
        tags: ['API Key'], summary: '创建 API Key（权限与当前账号完全相等）',
        description: '明文 Key 只在本次响应出现一次。调用方式：Authorization: Bearer fpak_xxx 或 X-API-Key: fpak_xxx。每账号最多 10 个有效 Key。',
        requestBody: jsonBody({ name: { type: 'string', description: '用途名称（≤50字）' }, expiresInDays: { type: 'number', description: '有效期天数（可选，不传=永久）' } }, ['name'], 'Key 信息'),
        responses: { ...okResponse('{ ..., apiKey: 明文Key, notice }'), 400: { description: '超数量限制等', content: { 'application/json': { schema: envelope } } } },
      },
    },
    '/api/api-keys/all': {
      get: { tags: ['API Key'], summary: '全部用户的 Key（仅 admin）', responses: okResponse('Key 数组（含所属用户）') },
    },
    '/api/api-keys/audit': {
      get: { tags: ['API Key'], summary: 'API 调用审计日志（仅 admin；可按 keyId 过滤）', parameters: [{ name: 'keyId', in: 'query', schema: { type: 'string' } }, { name: 'take', in: 'query', schema: { type: 'number', description: '条数，默认50，最大200' } }], responses: okResponse('审计日志数组') },
    },
    '/api/api-keys/{id}': {
      delete: { tags: ['API Key'], summary: '吊销 Key（本人或 admin）', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }], responses: okResponse('吊销成功') },
    },
    '/api/system/ocr-download-info': {
      get: { tags: ['系统'], summary: '本地 OCR 安装包下载信息', responses: okResponse('下载地址/版本/MD5') },
    },
    '/api/health': {
      get: { tags: ['系统'], summary: '健康检查（无需鉴权）', responses: okResponse('ok') },
    },
    '/api/openapi.json': {
      get: { tags: ['系统'], summary: '本 OpenAPI 规范（Agent 自描述入口）', responses: okResponse('OpenAPI 3.1 文档') },
    },
  },
}
