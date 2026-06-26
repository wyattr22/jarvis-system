import { createClient } from "@libsql/client"
import { readFileSync } from "fs"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dir = dirname(fileURLToPath(import.meta.url))
const db = createClient({ url: "file:./jarvis.db" })

const schema = readFileSync(join(__dir, "../src/lib/db/schema.sql"), "utf8")

// Remove comment lines and split on semicolons
const stmts = schema
  .split("\n")
  .filter(line => !line.trimStart().startsWith("--"))
  .join("\n")
  .split(";")
  .map(s => s.trim())
  .filter(s => s.length > 0)

let ok = 0, fail = 0
for (const stmt of stmts) {
  try {
    await db.execute(stmt)
    ok++
  } catch (e) {
    console.error(`FAIL: ${stmt.slice(0, 80)}\n  → ${e.message}\n`)
    fail++
  }
}

const tables = await db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
console.log(`\nSchema init: ${ok} ok, ${fail} failed`)
console.log("Tables:", tables.rows.map(r => r.name).join(", "))
db.close()
