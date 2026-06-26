import { SMC_ICT_KNOWLEDGE, SMC_ICT_COMPACT } from './smc-ict'
import { TRADING_LIBRARY, TRADING_LIBRARY_COMPACT } from './trading-library'

// Full knowledge — used by Researcher and brainstorm mode (large context)
export const FULL_KNOWLEDGE = `${SMC_ICT_KNOWLEDGE}\n\n${TRADING_LIBRARY}`

// Compact version — injected into every voice/council call (~600 tokens)
export const COMPACT_KNOWLEDGE = `
TRADING KNOWLEDGE SUMMARY:
${SMC_ICT_COMPACT}
${TRADING_LIBRARY_COMPACT}
`.trim()

// Just the current strategy — injected into Researcher for improvement proposals
export const CURRENT_STRATEGY_KNOWLEDGE = SMC_ICT_KNOWLEDGE

export { SMC_ICT_KNOWLEDGE, SMC_ICT_COMPACT, TRADING_LIBRARY, TRADING_LIBRARY_COMPACT }
