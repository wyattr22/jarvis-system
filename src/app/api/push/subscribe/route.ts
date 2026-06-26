import { db } from '@/lib/db/client'

export async function POST(req: Request) {
  try {
    const sub = await req.json()
    if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth) {
      return Response.json({ error: 'invalid subscription' }, { status: 400 })
    }

    await db.execute({
      sql: `CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )`,
      args: [],
    })

    await db.execute({
      sql: `INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth`,
      args: [sub.endpoint, sub.keys.p256dh, sub.keys.auth, Date.now()],
    })

    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 500 })
  }
}
