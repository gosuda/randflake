# SPARX-64/128 TypeScript Knowledge Base

## OVERVIEW
TypeScript implementation of the SPARX-64/128 block cipher, primarily used by the `@safe/randflake` package for encrypted ID generation.

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Cipher Logic | `src/index.ts` | Implementation of ARX, linear layer, and key schedule |
| Unit Tests | `src/index.test.ts` | Vitest-based suite verifying cipher parity |
| Benchmarks | `vitest.config.ts` | Benchmark configuration for cipher performance |
| Build Config | `tsconfig.json` | ES2020 target, ESM output |
| Publishing | `jsr.json`, `package.json` | JSR (@safe/sparx64) and NPM (sparx64) support |

## CONVENTIONS
- **Algorithm Parameters**: Implements SPARX-64/128 (64-bit block, 128-bit key) with 8 steps, 3 rounds per step, and 2 branches.
- **Word Size**: Internally operates on 16-bit words (`number` type in TS) using bitwise masks (`& 0xFFFF`).
- **Memory Safety**: Includes a `destroy()` method to zero out subkeys in memory after use.
- **Byte Order**: Big-endian byte order for converting `Uint8Array` to/from 16-bit words.
- **ESM Only**: Package is `type: "module"`, strictly adhering to modern ESM standards.
- **Strict Typing**: Uses `Uint8Array` for all external I/O to ensure cross-runtime compatibility.

## CROSS-LANGUAGE PARITY
- **Reference**: Must maintain identical behavior with Go (`sparx64/sparx.go`) and Python implementations.
- **Test Vectors**: Verified against a standard test vector:
  - Key: `00112233445566778899aabbccddeeff`
  - Plaintext: `0123456789abcdef`
  - Expected: `2bbef15201f55f98`

## ANTI-PATTERNS
- **NEVER** use keys other than exactly 16 bytes (128 bits); constructor throws on invalid length.
- **NEVER** use blocks other than exactly 8 bytes (64 bits) for encryption/decryption.
- **NEVER** reuse `Sparx64` instances across different secrets without calling `destroy()` and re-initializing.
- **NEVER** use Node.js `Buffer`; use `Uint8Array` for cross-runtime compatibility (Browsers, Deno, Bun).
