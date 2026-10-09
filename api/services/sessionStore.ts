import session from 'express-session'
import { prisma } from '../db.js'

type Callback<T> = (error?: Error | null, result?: T) => void

export const SESSION_TTL_MS = Number(
  process.env.SESSION_MAX_AGE_MS ?? 1000 * 60 * 60 * 24 * 90,
)

// SQLite-backed session store so logins survive server restarts.
export class PrismaSessionStore extends session.Store {
  async get(sid: string, callback: Callback<session.SessionData | null | undefined>) {
    try {
      const row = await prisma.session.findUnique({ where: { sid } })
      if (!row) {
        callback(null, undefined)
        return
      }
      if (row.expiresAt.getTime() < Date.now()) {
        await prisma.session.delete({ where: { sid } }).catch(() => undefined)
        callback(null, undefined)
        return
      }
      callback(null, JSON.parse(row.data) as session.SessionData)
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)))
    }
  }

  async set(sid: string, sess: session.SessionData, callback: Callback<void>) {
    try {
      const cookieExpires = sess.cookie?.expires
      const expiresAt =
        cookieExpires instanceof Date && cookieExpires.getTime() > Date.now()
          ? cookieExpires
          : new Date(Date.now() + SESSION_TTL_MS)
      const data = JSON.stringify(sess)
      await prisma.session.upsert({
        where: { sid },
        update: { data, expiresAt },
        create: { sid, data, expiresAt },
      })
      callback(null)
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)))
    }
  }

  async destroy(sid: string, callback: Callback<void>) {
    try {
      await prisma.session.delete({ where: { sid } }).catch(() => undefined)
      callback(null)
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)))
    }
  }

  async touch(sid: string, sess: session.SessionData, callback: Callback<void>) {
    try {
      const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
      const data = JSON.stringify(sess)
      await prisma.session.update({
        where: { sid },
        data: { data, expiresAt },
      })
      callback(null)
    } catch (error) {
      callback(error instanceof Error ? error : new Error(String(error)))
    }
  }
}
