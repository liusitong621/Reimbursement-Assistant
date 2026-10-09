<div align="center">

# FP 报销信息整理识别系统

### Invoice & Order Screenshot OCR Reimbursement System

中国式增值税发票 + 订单截图 OCR 自动识别报销系统
A self-hosted reimbursement system with server-side invoice OCR.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node-%E2%89%A518-green.svg)](package.json)
[![React](https://img.shields.io/badge/React-18-61dafb.svg)](https://react.dev)
[![Vite](https://img.shields.io/badge/Vite-6-646cff.svg)](https://vitejs.dev)
[![Express](https://img.shields.io/badge/Express-4-000.svg)](https://expressjs.com)
[![Prisma](https://img.shields.io/badge/Prisma-6-2d3748.svg)](https://prisma.io)
[![PaddleOCR](https://img.shields.io/badge/PaddleOCR-3.7-0066b4.svg)](https://github.com/PaddlePaddle/PaddleOCR)

</div>

---

## 项目简介

FP 是一个开箱即用的**本地部署报销系统**，专注于解决中国式发票和电商订单截图的自动识别、整理与审批流程。系统由前端 React 单页应用、Express 后端、Prisma + SQLite 数据库，以及独立的 PaddleOCR 识别服务组成。整套服务可在一台 Linux 主机上完整运行，不依赖任何云服务。

### 核心特性

- **服务端 OCR 识别**（PaddleOCR 3.7）：单张 PNG 约 22 秒，PDF 约 55 秒，对中国制式增值税发票的字段抽取准确率 95%+
- **14 个发票字段自动提取**：发票号码、开票日期、购买方/销售方信息、明细行（项目/规格/单位/数量/单价/金额/税率/税额）、合计金额、合计税额、价税合计、备注、开票人
- **支持多种发票类型**：电子普票、电子专票、纸质发票
- **订单截图识别**：基于 tesseract.js，识别订单号、金额、商品信息
- **完整报销流程**：新建 → 识别 → 编辑 → 审批 → 导出 Excel
- **PDF 附件合集导出**：在导出表格的同时，合并所有相关附件为一份按编号排序的 PDF
- **审批工作流**：多级审批、备用金管理、统计面板
- **无云依赖**：所有数据本地存储，可完全离线运行

### 技术栈

| 层 | 技术 | 用途 |
|---|---|---|
| 前端 | Vite + React 18 + TypeScript | 单页应用 |
| 前端 | Tailwind CSS + Radix Icons | 样式与图标 |
| 前端 | React Router 7 + Zustand | 路由与状态 |
| 后端 | Express 4 + TypeScript + tsx | API 服务 |
| 后端 | Prisma 6 + SQLite | ORM 与数据持久化 |
| 后端 | Multer + express-session | 文件上传与会话 |
| 后端 | exceljs + pdfkit | 报表与 PDF 生成 |
| OCR | PaddleOCR 3.7 (Python, FastAPI) | 发票文字识别 |
| OCR | tesseract.js | 订单截图识别 |
| 反代 | Caddy | HTTPS 与域名 |
| 部署 | pm2 + systemd | 进程托管 |

### 项目结构

```
fp-reimbursement-system/
├── api/                    # Express 后端
│   ├── routes/             # 路由
│   │   ├── auth.ts         # 登录注册
│   │   ├── reimbursements.ts  # 报销单
│   │   ├── recognition.ts  # OCR 调用
│   │   ├── approvals.ts    # 审批
│   │   ├── exports.ts      # 导出
│   │   ├── dashboard.ts    # 统计
│   │   ├── admin.ts        # 管理员
│   │   └── reserveFunds.ts # 备用金
│   ├── services/           # 业务逻辑
│   ├── middleware/         # 中间件
│   ├── app.ts              # Express 应用
│   └── server.ts           # 启动入口
├── src/                    # React 前端
│   ├── pages/              # 页面组件
│   ├── components/         # 通用组件
│   ├── utils/              # 工具（含 invoiceOcr 客户端封装）
│   ├── store/              # Zustand 状态
│   └── lib/                # API 客户端
├── prisma/
│   ├── schema.prisma       # 数据模型
│   └── seed.ts             # 初始数据
├── public/                 # 静态资源（含中文字体）
├── 升级包/                  # 版本升级包
├── 部署说明.md              # 部署文档
├── 升级说明.md              # 升级文档
├── 更新内容公告.md          # 版本说明
└── package.json
```

### 架构图

```
┌─────────────────────────────────────────┐
│  浏览器 (React SPA)                     │
│  - 上传发票 PDF/图片                    │
│  - 显示识别结果,人工校对                 │
│  - 提交报销 / 审批 / 导出               │
└─────────────────┬───────────────────────┘
                  │ HTTPS (Caddy)
                  ▼
┌─────────────────────────────────────────┐
│  Express API (端口 3101)                │
│  - /api/auth  /api/reimbursements      │
│  - /api/recognition  /api/exports       │
│  - 静态托管 dist/                       │
└────┬────────────────────────┬───────────┘
     │                        │
     │                        │ HTTP (127.0.0.1)
     ▼                        ▼
┌──────────────┐      ┌──────────────────┐
│ SQLite       │      │ PaddleOCR 服务   │
│ (prisma)     │      │ 端口 8001        │
│ - User       │      │ FastAPI          │
│ - Reimburse  │      │ 14 字段抽取       │
│ - Approval   │      │ chineseocr 启发  │
└──────────────┘      └──────────────────┘
```

---

## 快速开始

> 推荐环境：Ubuntu 24.04 LTS，Node 20+，Python 3.10+。

### 1. 克隆仓库

```bash
git clone https://github.com/<YOUR_GITHUB_USERNAME>/fp-reimbursement-system.git
cd fp-reimbursement-system
```

### 2. 安装前端依赖

```bash
npm install
```

### 3. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，至少设置 SESSION_SECRET
```

`.env` 关键字段：

```bash
DATABASE_URL="file:./dev.db"
SESSION_SECRET="<生成一段随机字符串>"
PORT=3101
VITE_BASE_PATH=/FP
OCR_SERVICE_URL=http://127.0.0.1:8001  # OCR 服务地址
OCR_TIMEOUT_MS=90000                    # 单张识别超时（毫秒）
```

### 4. 初始化数据库

```bash
npx prisma db push
npm run db:seed    # 创建默认账号（admin / admin）
```

### 5. 启动 OCR 服务

OCR 服务是独立 Python 项目，请参考 [chineseocr](https://github.com/chineseocr/chineseocr) 与 [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) 自行部署。本仓库的 `api/services/recognition.ts` 实现了对它的 HTTP 客户端封装，协议如下：

- `GET  /api/v1/health` → `{ status, models_loaded }`
- `POST /api/v1/ocr/invoice` (multipart: `file`) → 14 个字段的 JSON

> 如果暂时不接入 OCR 服务，前端仍可手动录入。

### 6. 启动开发环境

```bash
# 同时启动前端 (5173) 与后端 (3101)
npm run dev
```

访问 http://localhost:5173/FP/

### 7. 生产构建

```bash
npm run build
pm2 start "npx tsx api/server.ts" --name fp-release
```

访问 http://localhost:3101/FP/

---

## 部署到服务器

完整部署文档见 [部署说明.md](部署说明.md)。

**核心步骤**：
1. 服务器安装 Node 20+、Caddy、Python 3.10+、pm2
2. 克隆仓库到 `/opt/fp-release/`
3. `npm ci --omit=dev && npx prisma db push && npm run build`
4. 部署 OCR 服务到 `/opt/invoice_ocr/`（systemd 托管）
5. Caddy 反向代理 `/FP` → `127.0.0.1:3101`，`/api` → `127.0.0.1:3101`
6. pm2 托管 Express 进程

**最低硬件要求**（不含 OCR 服务）：
- 1 vCPU
- 1 GB RAM
- 5 GB 磁盘

**OCR 服务最低硬件要求**：
- 2 vCPU
- 4 GB RAM（PaddleOCR 模型常驻约 1.2 GB）
- 5 GB 磁盘

---

## API 端点

| 端点 | 方法 | 说明 |
|---|---|---|
| `/api/health` | GET | 健康检查 |
| `/api/auth/login` | POST | 登录 |
| `/api/auth/logout` | POST | 登出 |
| `/api/auth/me` | GET | 当前用户信息 |
| `/api/reimbursements` | GET/POST | 报销单列表/创建 |
| `/api/reimbursements/:id` | GET/PATCH/DELETE | 单个报销单 |
| `/api/recognition/health` | GET | OCR 服务可达性 |
| `/api/recognition/invoice-ocr` | POST | 一站式识别（上传+识别） |
| `/api/recognition/invoice-ocr/upload` | POST | 仅上传，返回 file_id |
| `/api/recognition/invoice-ocr/extract` | POST | 触发识别（传 file_id） |
| `/api/approvals` | GET/POST | 审批 |
| `/api/exports/reimbursement-excel` | GET | 导出 Excel |
| `/api/exports/attachments-pdf` | GET | 导出附件合集 PDF |
| `/api/dashboard/stats` | GET | 统计面板 |
| `/api/reserve-funds` | GET/POST | 备用金 |

---

## 开发约定

- 前端：函数组件 + Hooks，TypeScript 严格模式，状态使用 Zustand
- 后端：Express 路由 + 业务服务分层，TypeScript 严格模式
- 数据库：Prisma schema 是唯一事实源，迁移使用 `prisma db push`（MVP 阶段）
- OCR：客户端只发 HTTP，由独立 Python 服务承担重型推理
- 安全：所有 API 走 session 中间件；管理员接口额外校验角色
- 编码：UTF-8（无 BOM），中文文件路径需 PowerShell 显式指定

---

## 致谢

本项目基于以下开源项目构建：

- [PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR) - 百度飞桨 OCR 工具库
- [chineseocr](https://github.com/chineseocr/chineseocr) - 中文 OCR 参考实现（本项目字段抽取逻辑的启发来源）
- [Tesseract.js](https://github.com/naptha/tesseract.js) - 浏览器端 OCR
- [Vite](https://github.com/vitejs/vite) - 前端构建
- [Prisma](https://github.com/prisma/prisma) - ORM
- [Express](https://github.com/expressjs/express) - Web 框架

---

## 许可证

本项目使用 [MIT 许可证](LICENSE)。您可以自由使用、修改、分发，但需保留版权声明。

---

## Project Introduction (English)

FP is a self-hosted reimbursement system focused on Chinese-style VAT invoice recognition and e-commerce order screenshot OCR. It is composed of a React SPA, an Express backend, Prisma + SQLite, and a standalone PaddleOCR service. The whole stack can run on a single Linux host with no cloud dependency.

**Highlights**
- Server-side PaddleOCR 3.7 (≈22s for a PNG, ≈55s for a PDF, 95%+ field accuracy)
- 14 invoice fields extracted automatically (number, date, parties, line items, totals, etc.)
- Full reimbursement workflow: create → OCR → review → approve → export
- Excel + merged PDF export with all attachments in one file
- No cloud dependency, fully offline capable

**Tech Stack**: Vite + React 18 + TypeScript, Express 4, Prisma 6 + SQLite, PaddleOCR 3.7, tesseract.js, Caddy, pm2.

See [部署说明.md](部署说明.md) for the full deployment guide (Chinese) and the API table above for endpoint details.
