# Randflake TypeScript Implementation Knowledge Base

## OVERVIEW
TypeScript implementation of the Randflake ID generator using BigInt for 64-bit safety.

## STRUCTURE
```
randflake/
├── src/
│   ├── index.ts          # Core generator implementation
│   ├── index.test.ts     # Vitest unit tests
│   └── index.bench.ts    # Vitest benchmarks
├── package.json          # Workspace package config (@safe/randflake)
├── tsconfig.json         # TypeScript configuration (ES2020)
├── vitest.config.ts      # Vitest configuration
└── jsr.json              # JSR publishing configuration
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Generator Logic | `src/index.ts` | Uses `BigInt` and `DataView` for ID packing |
| Unit Tests | `src/index.test.ts` | Vitest-based suite for parity and edge cases |
| Benchmarks | `src/index.bench.ts` | Performance metrics for ID generation |
| Build Config | `tsconfig.json` | ES2020 target, ESM output |
| Publishing | `jsr.json`, `package.json` | JSR (@safe/randflake) and NPM support |

## CONVENTIONS
- **BigInt Everywhere**: All 64-bit operations (timestamps, node IDs, sequences) MUST use `BigInt` to prevent precision loss.
- **Endianness**: Uses little-endian byte ordering via `DataView.setBigInt64(..., true)` for SPARX block cipher compatibility.
- **Internal Dependencies**: Depends on the `@safe/sparx64` workspace package.
- **ESM Only**: Package is `type: "module"`, strictly adhering to modern ESM standards.
- **Test Runner**: Uses `Vitest` for both unit tests (`npm test`) and benchmarks (`npm run bench`).
- **JSR Ready**: Includes `jsr.json` for publishing to jsr.io as `@safe/randflake`.

## ANTI-PATTERNS
- **NEVER** use `Number` for generated IDs; `2^64` exceeds `Number.MAX_SAFE_INTEGER` (2^53 - 1).
- **NEVER** use Node.js `Buffer` in the core implementation; use `Uint8Array` to maintain compatibility with Deno, Bun, and Browsers.
- **NEVER** use `Math.random()` for secret generation; secrets must be high-entropy 16-byte arrays.
- **NEVER** modify `rollover` or `sequence` state outside of the `newRAW` private method.
- **NEVER** ignore `BigInt` conversion costs in tight loops; reuse `BigInt` constants where possible.
