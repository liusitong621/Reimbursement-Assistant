import app from './app.js'
import { bootstrapApp } from './services/bootstrap.js'

const PORT = Number(process.env.PORT ?? 3001)

async function startServer() {
  await bootstrapApp()

  // 4.0.9: 仅监听回环地址，公网入口一律走 Caddy 反代（UFW 之外的纵深防御）
  const HOST = process.env.HOST ?? '127.0.0.1'
  const server = app.listen(PORT, HOST, () => {
    console.log(`Server ready on port ${PORT}`)
  })

  const shutdown = () => {
    server.close(() => {
      process.exit(0)
    })
  }

  process.on('SIGTERM', shutdown)
  process.on('SIGINT', shutdown)
}

startServer().catch((error) => {
  console.error('Server bootstrap failed:', error)
  process.exit(1)
})
