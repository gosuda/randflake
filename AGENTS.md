# PROJECT KNOWLEDGE BASE

**Generated:** 2026-01-05
**Commit:** HEAD
**Branch:** main

## OVERVIEW
Polyglot monorepo for Randflake ID: distributed, cryptographically secure 64-bit ID generator. Supports Go, Python, TypeScript.

## STRUCTURE
```
randflake/
├── randflake.go          # Go implementation (canonical, root module)
├── sparx64/              # Go SPARX-64/128 cipher package
├── src/randflake/        # Python implementation (src layout)
└── src/randflake-ts/     # TypeScript monorepo (npm workspaces)
    ├── randflake/         # TS generator implementation
    └── sparx64/          # TS cipher implementation
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| Go implementation | `randflake.go` | Canonical reference, uses sync/atomic |
| Python implementation | `src/randflake/` | Uses struct.pack, no GIL locking |
| TypeScript implementation | `src/randflake-ts/` | Uses BigInt, npm workspaces |
| SPARX cipher | `sparx64/sparx.go` | Block cipher reference |
| Tests | `randflake_test.go`, `src/randflake/test_*.py` | Cross-language parity vectors |
| CI/CD | `.github/workflows/` | Go CI on PR, PyPI/NPM on release |

## CONVENTIONS

### Bit Allocation (64-bit total)
- Timestamp: 30 bits (relative to epoch offset 1730000000)
- Node ID: 17 bits (0-131071)
- Sequence: 17 bits (0-131071)

### Generator Initialization
All implementations require: `nodeID`, `leaseStart`, `leaseEnd`, `secret` (16 bytes)

### Cross-Language Parity
Same secret + same inputs → identical encrypted ID across Go, Python, TS
Test vector: secret `dffd6021bb2bd5b0af676290809ec3a5` → ID `4594531474933654033`

## ANTI-PATTERNS (THIS PROJECT)

- **NEVER** use different base32hex alphabet than `0123456789abcdefghijklmnopqrstuv`
- **NEVER** allow backward clock movement → raises `ErrConsistencyViolation`
- **NEVER** use same nodeID concurrently without unique lease intervals
- **MUST** use exactly 16-byte secrets → raises `ErrInvalidSecret`
- **Generator expires** after 34 years (2058) → raises `ErrRandflakeDead`

## UNIQUE STYLES

- **Go-centric root**: Go files live at root alongside monorepo configs (unusual)
- **Hybrid monorepo**: Go modules + npm workspaces + Python package in one repo
- **Strict parity**: All three implementations validated against shared test vectors
- **Lease-based safety**: Generators bound to time windows to prevent collisions

## COMMANDS

```bash
# Go
go build ./...
go test -v ./...

# Python
python -m build          # Build wheels
hatch run test           # Run tests

# TypeScript
npm test                 # Run all workspace tests
npm run build -ws        # Build all packages
npm run bench            # Run benchmarks

# Root (monorepo)
npm test                 # Runs vitest for TS workspaces
```

## NOTES

- **Go implementation is canonical**: Reference for algorithm and bit-packing
- **No shared utility code**: Each language implements SPARX cipher independently
- **Bun used locally**: bun.lockb present, but CI uses standard npm
- **JSR ready**: TS packages have jsr.json but no automated JSR publishing
- **Cross-language inspect**: IDs generated in one language can be decrypted in others with same secret
