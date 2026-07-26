import { getGraph } from "@/lib/knowledge-graph/store"

export async function GET() {
  const graph = await getGraph()
  return Response.json(graph)
}
