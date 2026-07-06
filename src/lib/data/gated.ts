// Gated wrappers around the raw data fetchers.
// Callers building LLM context / predictive model input should use THESE,
// not the raw fetchers directly. Each wrapper returns SourceResult so the
// caller can inspect confidence before deciding whether to inject the data.

import { evaluateSource, type SourceResult } from "@/lib/sandbox/quality"
import {
  getBars as rawGetBars,
  getLatestQuote as rawGetLatestQuote,
  getMultipleQuotes as rawGetMultipleQuotes,
  getPositions as rawGetPositions,
  getAccount as rawGetAccount,
  getBTCPrice as rawGetBTCPrice,
  getVIX as rawGetVIX,
  type Bar, type Quote,
} from "@/lib/data/alpaca"
import { getStockTwitsSentiment as rawGetSentiment, type TickerSentiment } from "@/lib/data/sentiment"
import { getOptionsSnapshot as rawGetOptions, type OptionsSnapshot } from "@/lib/data/options"
import { getIntermarketSnapshot as rawGetIntermarket, type IntermarketSnapshot } from "@/lib/data/intermarket"
import { getTodaysEconomicEvents as rawGetEconomics, type EconomicEvent } from "@/lib/data/economics"
import { hasRecentInsiderActivity as rawGetInsider } from "@/lib/data/insider"
import { getFuturesQuotes as rawGetFutures } from "@/lib/data/futures"
import { getIndexQuotes as rawGetIndexes } from "@/lib/data/indexes"
import type { MarketQuote } from "@/lib/data/freshness"

export const getBarsGated = (symbol: string, tf: string, limit?: number, days?: number): Promise<SourceResult<Bar[]>> =>
  evaluateSource("alpaca.bars", () => rawGetBars(symbol, tf, limit, days))

export const getLatestQuoteGated = (symbol: string): Promise<SourceResult<Quote>> =>
  evaluateSource("alpaca.quote", () => rawGetLatestQuote(symbol))

export const getMultipleQuotesGated = (symbols: string[]): Promise<SourceResult<Quote[]>> =>
  evaluateSource("alpaca.quote", () => rawGetMultipleQuotes(symbols))

export const getAccountGated = (): Promise<SourceResult<any>> =>
  evaluateSource("alpaca.account", () => rawGetAccount())

export const getPositionsGated = (): Promise<SourceResult<any>> =>
  evaluateSource("alpaca.positions", () => rawGetPositions())

export const getBTCGated = (): Promise<SourceResult<{ price: number; change24h: number } | null>> =>
  evaluateSource("alpaca.btc", () => rawGetBTCPrice())

export const getVIXGated = (): Promise<SourceResult<number | null>> =>
  evaluateSource("yahoo.vix", () => rawGetVIX())

export const getSentimentGated = (symbol: string): Promise<SourceResult<TickerSentiment | null>> =>
  evaluateSource("stocktwits.sentiment", () => rawGetSentiment(symbol))

export const getOptionsGated = (symbol: string): Promise<SourceResult<OptionsSnapshot | null>> =>
  evaluateSource("options.snapshot", () => rawGetOptions(symbol))

export const getIntermarketGated = (): Promise<SourceResult<IntermarketSnapshot>> =>
  evaluateSource("yahoo.intermarket", () => rawGetIntermarket())

export const getFuturesGated = (): Promise<SourceResult<MarketQuote[]>> =>
  evaluateSource("yahoo.futures", () => rawGetFutures())

export const getIndexesGated = (): Promise<SourceResult<MarketQuote[]>> =>
  evaluateSource("yahoo.index", () => rawGetIndexes())

export const getEconomicsGated = (): Promise<SourceResult<EconomicEvent[]>> =>
  evaluateSource("alphavantage.economic", () => rawGetEconomics())

export const getInsiderGated = (symbol: string): Promise<SourceResult<string>> =>
  evaluateSource("sec.insider", () => rawGetInsider(symbol))
