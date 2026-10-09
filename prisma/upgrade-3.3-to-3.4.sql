-- 正式版 3.3 → 3.4：新增报销分类表与报销单分类外键
-- 适用数据库：SQLite
-- 如果正常环境可运行 `npx prisma db push`，则无需手动执行本文件。

-- 1) 创建报销分类表
CREATE TABLE IF NOT EXISTS "ReimbursementCategory" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "isActive" BOOLEAN NOT NULL DEFAULT 1,
  "createdById" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);

-- 2) 分类名全局唯一
CREATE UNIQUE INDEX IF NOT EXISTS "ReimbursementCategory_name_key" ON "ReimbursementCategory"("name");

-- 3) 列表查询常用排序索引
CREATE INDEX IF NOT EXISTS "ReimbursementCategory_isActive_sortOrder_idx" ON "ReimbursementCategory"("isActive", "sortOrder");

-- 4) 报销单表增加分类外键（需脚本判断列是否存在后执行 ALTER TABLE）
-- ALTER TABLE "Reimbursement" ADD COLUMN "categoryId" TEXT;

-- 5) 报销单按分类筛选索引
-- CREATE INDEX IF NOT EXISTS "Reimbursement_categoryId_idx" ON "Reimbursement"("categoryId");
