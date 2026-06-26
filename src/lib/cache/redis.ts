import { Redis } from "@upstash/redis"

export const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
})

export async function cached<T>(
  key: string,
  ttlSeconds: number,
  fn: () => Promise<T>
): Promise<T> {
  const hit = await redis.get<T>(key)
  if (hit !== null) return hit
  const value = await fn()
  await redis.setex(key, ttlSeconds, value as string)
  return value
}
