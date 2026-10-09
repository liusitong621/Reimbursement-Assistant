import bcrypt from 'bcryptjs'
import { PrismaClient, Role } from '@prisma/client'

const prisma = new PrismaClient()
const releaseUsers = [
  { username: 'admin', displayName: '系统管理员', role: Role.admin, password: 'BX@2026', reserveFundBalance: 0 },
  { username: 'leader', displayName: '部门领导', role: Role.leader, password: '00001', reserveFundBalance: 0 },
  { username: 'finance', displayName: '财务专员', role: Role.finance, password: '00001', reserveFundBalance: 0 },
  { username: 'worker01', displayName: '员工01', role: Role.employee, password: '00001', reserveFundBalance: 0 },
  { username: 'worker02', displayName: '员工02', role: Role.employee, password: '00002', reserveFundBalance: 0 },
  { username: 'worker03', displayName: '员工03', role: Role.employee, password: '00003', reserveFundBalance: 0 },
  { username: 'worker04', displayName: '员工04', role: Role.employee, password: '00004', reserveFundBalance: 0 },
  { username: 'worker05', displayName: '员工05', role: Role.employee, password: '00005', reserveFundBalance: 0 },
] as const

async function recreateUser(username: string, displayName: string, role: Role, password: string, reserveFundBalance = 0) {
  const passwordHash = await bcrypt.hash(password, 10)

  return prisma.user.create({
    data: {
      username,
      displayName,
      role,
      reserveFundBalance,
      reserveFundNotice: '',
      passwordHash,
    },
  })
}

async function main() {
  await prisma.orderItemUser.deleteMany()
  await prisma.attachment.deleteMany()
  await prisma.reviewLog.deleteMany()
  await prisma.orderItem.deleteMany()
  await prisma.reimbursement.deleteMany()
  await prisma.reserveFundLog.deleteMany()
  await prisma.exportBatch.deleteMany()
  await prisma.user.deleteMany()

  for (const account of releaseUsers) {
    await recreateUser(
      account.username,
      account.displayName,
      account.role,
      account.password,
      account.reserveFundBalance,
    )
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
