import webpush from 'web-push'
import { db } from '@/lib/db/client'

let _vapidInitialized = false
function ensureVapid() {
  if (_vapidInitialized) return
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  if (!pub || !priv) return
  webpush.setVapidDetails(
    `mailto:${process.env.VAPID_EMAIL ?? 'admin@jarvis.local'}`,
    pub,
    priv,
  )
  _vapidInitialized = true
}

export interface PushPayload {
  title: string
  body: string
  tag?: string
  url?: string
}

export async function sendPushToAll(payload: PushPayload): Promise<void> {
  ensureVapid()
  if (!_vapidInitialized) return
  try {
    const rows = await db.execute('SELECT endpoint, p256dh, auth FROM push_subscriptions')
    await Promise.allSettled(
      rows.rows.map(row =>
        webpush.sendNotification(
          {
            endpoint: String(row.endpoint),
            keys: { p256dh: String(row.p256dh), auth: String(row.auth) },
          },
          JSON.stringify(payload)
        ).catch(() => {})
      )
    )
  } catch { /* ignore — never block the caller */ }
}
