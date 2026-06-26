import { sendPushToAll } from '@/lib/push'

export async function POST(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { title, body, tag, url } = await req.json()
  if (!title || !body) return Response.json({ error: 'title and body required' }, { status: 400 })

  await sendPushToAll({ title, body, tag, url })
  return Response.json({ ok: true })
}
