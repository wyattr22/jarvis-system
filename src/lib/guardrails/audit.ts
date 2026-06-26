import { db } from "@/lib/db/client"

export async function auditLog(
  actor: string,
  action: string,
  details: Record<string, unknown>
) {
  await db.execute({
    sql: "INSERT INTO audit_log (actor, action, details_json, timestamp) VALUES (?, ?, ?, ?)",
    args: [actor, action, JSON.stringify(details), Date.now()],
  })
}
