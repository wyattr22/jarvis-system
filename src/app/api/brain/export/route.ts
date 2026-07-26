// Obsidian-compatible markdown vault export (Phase 21). Built entirely in
// memory and streamed as a download -- explicitly a one-shot snapshot, not
// a live-synced vault. Vercel has no persistent filesystem to keep a
// continuously-synced vault on the server side even if we wanted one.

import JSZip from "jszip"
import { getGraph } from "@/lib/knowledge-graph/store"

function slugify(label: string): string {
  return label.replace(/[\\/:*?"<>|]/g, "-").slice(0, 100).trim() || "untitled"
}

export async function GET() {
  const { nodes, edges } = await getGraph()
  const zip = new JSZip()

  const labelById = new Map(nodes.map(n => [n.id, n.label]))
  const edgesByNode = new Map<string, typeof edges>()
  for (const e of edges) {
    if (!edgesByNode.has(e.source_id)) edgesByNode.set(e.source_id, [])
    edgesByNode.get(e.source_id)!.push(e)
  }

  const usedFilenames = new Set<string>()
  for (const node of nodes) {
    let filename = `${slugify(node.label)}.md`
    let n = 2
    while (usedFilenames.has(filename)) filename = `${slugify(node.label)}-${n++}.md`
    usedFilenames.add(filename)

    const frontmatter = [
      "---",
      `type: ${node.node_type}`,
      `created: ${new Date(node.created_at).toISOString()}`,
      node.ref_table ? `source: ${node.ref_table}/${node.ref_id}` : null,
      "---",
    ].filter(Boolean).join("\n")

    const links = (edgesByNode.get(node.id) ?? [])
      .map(e => labelById.get(e.target_id))
      .filter((l): l is string => Boolean(l))
      .map(l => `- [[${l}]]`)

    const body = [
      frontmatter,
      "",
      `# ${node.label}`,
      "",
      node.summary ?? "",
      links.length ? "\n## Links\n" + links.join("\n") : "",
    ].join("\n")

    zip.file(filename, body)
  }

  const buffer = await zip.generateAsync({ type: "uint8array" })
  // Slice to a plain ArrayBuffer (not SharedArrayBuffer-typed) -- newer
  // TS DOM lib types are stricter about Uint8Array's generic buffer type
  // than what BodyInit/BlobPart accept directly.
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer
  const date = new Date().toISOString().slice(0, 10)
  return new Response(arrayBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="jarvis-brain-${date}.zip"`,
    },
  })
}
