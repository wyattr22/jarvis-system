import { routeWithDiversity } from "@/lib/llm/router"
import { parseAndValidate, CriticOutputSchema, type CriticOutput, type ProposalOutput } from "./schema"

const CRITICS = [
  { id: "critic-a-groq",     modelKey: "groq-llama-8b",         systemPrompt: "You are a skeptical quantitative analyst. Score proposals 0-1 on novelty, evidence_quality, overfit_risk (lower = more risky), alignment. Output valid JSON only." },
  { id: "critic-b-cerebras", modelKey: "cerebras-qwen-32b",     systemPrompt: "You are a systematic critic focused on statistical validity. Look for survivorship bias, p-hacking, and data mining artifacts. Output valid JSON only." },
  // Critic C uses DeepSeek R1 reasoning model if available, falls back to cerebras
  { id: "critic-c-openrouter", modelKey: "openrouter-deepseek-r1", systemPrompt: "You are a logical critic. Trace the reasoning chain. Identify logical flaws, circular reasoning, and unmeasurable claims. Output valid JSON only." },
]

const SCHEMA_HINT = `Output valid JSON:
{
  "scores": { "novelty": 0-1, "evidence_quality": 0-1, "overfit_risk": 0-1, "alignment": 0-1 },
  "overall_score": 0-1,
  "critique": string,
  "concerns": string[],
  "verdict": "approve"|"approve_with_caution"|"reject"
}`

export interface CriticEnsembleResult {
  scores: CriticOutput[]
  agreement: number
  ensembleScore: number
  lowDiversity: boolean
}

export async function runCriticEnsemble(proposal: ProposalOutput): Promise<CriticEnsembleResult> {
  const proposalText = JSON.stringify(proposal, null, 2)

  const requests = CRITICS.map(c => ({
    messages: [
      { role: "system" as const, content: c.systemPrompt + "\n\n" + SCHEMA_HINT },
      { role: "user" as const, content: `Critique this proposal:\n\n${proposalText}\n\nOutput JSON only.` },
    ],
    preferredModel: c.modelKey,
    cacheable: false,
  }))

  const rawOutputs = await routeWithDiversity(requests)

  const scores: CriticOutput[] = []
  let lowDiversity = false

  for (let i = 0; i < rawOutputs.length; i++) {
    try {
      scores.push(parseAndValidate(CriticOutputSchema, rawOutputs[i]))
    } catch {
      // If one critic fails, note it but continue
      console.error(`Critic ${CRITICS[i].id} output invalid`)
      lowDiversity = true
    }
  }

  if (scores.length < 2) {
    return { scores, agreement: 0, ensembleScore: 0, lowDiversity: true }
  }

  const ensembleScore = scores.reduce((s, c) => s + c.overall_score, 0) / scores.length

  // Agreement = 1 - std of scores
  const mean = ensembleScore
  const std = Math.sqrt(scores.reduce((s, c) => s + Math.pow(c.overall_score - mean, 2), 0) / scores.length)
  const agreement = Math.max(0, 1 - std * 2) // agreement drops fast with high std

  return { scores, agreement, ensembleScore, lowDiversity }
}
