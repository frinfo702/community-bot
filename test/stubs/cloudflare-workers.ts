/**
 * Vitest runs on node, which has no workerd DurableObject, so vitest.config.ts
 * aliases `cloudflare:workers` to this stub. It only keeps ctx / env.
 */
export class DurableObject<E = unknown> {
  constructor(
    readonly ctx: DurableObjectState,
    readonly env: E,
  ) {}
}
