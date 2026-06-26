import { runMetaEnforcer } from "@/lib/learning/meta-enforcer"

export const maxDuration = 60

export async function GET(req: Request) {
  const auth = req.headers.get("authorization") ?? ""
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 })
  }
  const result = await runMetaEnforcer()
  return Response.json({ ok: true, ...result })
}
