import fs from 'node:fs'
import path from 'node:path'

const storageRoot = path.join(process.cwd(), 'storage')
export const uploadsDir = path.join(storageRoot, 'uploads')
export const exportsDir = path.join(storageRoot, 'exports')

export function ensureStorageDirs() {
  for (const dir of [storageRoot, uploadsDir, exportsDir]) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
  }
}

// 将服务器绝对路径转换为前端可访问的 URL 路径
// uploadsDir 的文件 -> /uploads/<文件名>; exportsDir 的文件 -> /exports/<文件名>
// 修复:原来直接 replace(process.cwd()) 会得到 /storage/uploads/xxx，
// 但 Express 静态路由挂在 /uploads,导致保存后图片 404。
export function toPublicFilePath(filePath: string) {
  const normalized = filePath.split('\\').join('/')
  const uploadsSegment = uploadsDir.split('\\').join('/')
  const exportsSegment = exportsDir.split('\\').join('/')

  if (normalized.startsWith(uploadsSegment + '/')) {
    return '/uploads/' + normalized.slice(uploadsSegment.length + 1)
  }
  if (normalized.startsWith(exportsSegment + '/')) {
    return '/exports/' + normalized.slice(exportsSegment.length + 1)
  }
  // 兼容历史遗留的绝对路径与旧的 /storage 前缀
  if (normalized.startsWith('/storage/uploads/')) {
    return '/uploads/' + normalized.slice('/storage/uploads/'.length)
  }
  if (normalized.startsWith('/storage/exports/')) {
    return '/exports/' + normalized.slice('/storage/exports/'.length)
  }
  const cwdSegment = process.cwd().split('\\').join('/')
  return normalized.replace(cwdSegment, '') || normalized
}


// 3.1.1: 反向函数。把公开 URL (如 /uploads/xxx.png) 解析为文件系统绝对路径。
// 服务端代码需要读取附件原始文件时使用。
export function fromPublicFilePath(publicPath: string): string {
  const normalized = publicPath.split('\\\\').join('/').replace(/^\/+/, '')
  if (normalized.startsWith('uploads/')) {
    return path.join(uploadsDir, normalized.slice('uploads/'.length))
  }
  if (normalized.startsWith('exports/')) {
    return path.join(exportsDir, normalized.slice('exports/'.length))
  }
  // 兼容已经是绝对路径或相对于 cwd 的情况
  if (path.isAbsolute(normalized)) {
    return normalized
  }
  return path.join(process.cwd(), normalized)
}
