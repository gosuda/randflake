[![GitHub](https://img.shields.io/github/license/gosuda/randflake?style=for-the-badge)](https://github.com/gosuda/randflake/blob/main/LICENSE)
[![GitHub tag (latest SemVer)](https://img.shields.io/github/v/tag/gosuda/randflake?label=latest&style=for-the-badge)](https://github.com/gosuda/randflake/releases/latest)
[![PYPI](https://img.shields.io/pypi/v/randflake?style=for-the-badge&logo=python
)](https://pypi.org/project/randflake/)
[![npm](https://img.shields.io/npm/v/randflake?color=cb0303&style=for-the-badge)](https://www.npmjs.com/package/randflake)
[![Go Reference](https://img.shields.io/badge/go-reference-%23007d9c?style=for-the-badge&logo=go)](https://pkg.go.dev/gosuda.org/randflake)

# Randflake ID

## Overview

Randflake ID is a distributed, uniform, unpredictable, and unique random ID generator designed to provide robust identifier generation across multiple programming languages and environments.

## Key Features

- 🌐 **Multi-Language Support**: Available in Go, Python, and TypeScript/JavaScript
- 🔒 **Cryptographically Secure**: Generates unpredictable and unique identifiers
- **Allocation**: Atomic timestamp/sequence state in Go; thread-safe allocation in Python
- **Capacity**: 131,072 IDs per node per second across 131,072 node IDs; actual throughput depends on the implementation and hardware
- 🔀 **Distributed-Friendly**: Suitable for distributed systems and microservices
- 📊 **Uniform Distribution**: Ensures even spread of generated IDs

## Installation

### Go
```bash
go get -u gosuda.org/randflake
```

The `gosuda.org/randflake/v2` package is included in this module. Go 1.23 remains supported.

### Python
```bash
pip install randflake
```

### TypeScript/JavaScript
```bash
npm install randflake
```

## Usage Examples (v2)

### Go
```go
package main

import (
	"fmt"
	"time"

	randflake "gosuda.org/randflake/v2"
)

func main() {
	now := randflake.UnixSeconds(time.Now().Unix())
	g, err := randflake.New(randflake.Config{
		Lease: randflake.Lease{NodeID: 42, Start: now, EndExclusive: now + 600},
		Secret: []byte("super-secret-key"),
	})
	if err != nil {
		panic(err)
	}
	id, err := g.Generate()
	if err != nil {
		panic(err)
	}
	fmt.Println(id, g.Inspect(id).Timestamp)
}
```

### Python
```python
import time
from randflake.v2 import Config, Generator, Lease

now = int(time.time())
generator = Generator(Config(
    lease=Lease(node_id=42, start=now, end_exclusive=now + 600),
    secret=b"super-secret-key",
))
uid = generator.generate()
print(uid, generator.inspect(uid).timestamp)
```

### TypeScript/JavaScript
```typescript
import { Generator } from 'randflake/v2';

const now = Math.floor(Date.now() / 1000);
const generator = new Generator({
  lease: { nodeID: 42, start: now, endExclusive: now + 600 },
  secret: new TextEncoder().encode('super-secret-key'),
});
const uid = generator.generate();
console.log(uid, generator.inspect(uid).timestamp);
```

## Clock and Lease Contract

- Timestamps are whole POSIX Unix seconds, not milliseconds, nanoseconds, or continuous SI time. The full 30-bit timestamp range is supported through 2058-11-05 17:10:23 UTC.
- v2 leases are half-open: `start <= now < endExclusive`. The largest exclusive end is the maximum timestamp plus one.
- A node must have only one active generator for overlapping lease seconds. A restart must obtain a non-overlapping lease; the library does not allocate node ownership or persist sequence state.
- Sequence values run from 0 through 131071 and restart at 0 in a new second. Backwards seconds are rejected on every allocation. Exhaustion returns an error without waiting or inventing a future timestamp.
- The optional constructor clock returns Unix seconds: Go `func() (UnixSeconds, error)`, Python a callable returning `int`, TypeScript `() => number`. Failures propagate without consuming a sequence. Callbacks must be read-only, non-reentrant, and safe for concurrent reads where applicable; Go may resample on a CAS retry.
- `ExtendLease` / `extend_lease` / `extendLease` requires the same node and start. It never shortens a lease; an already-satisfied valid request succeeds without changing it. `Lease()` / `lease()` returns a snapshot.
- Inspection decrypts fields but does not authenticate an ID or require an active lease. Do not use successful inspection as proof that an ID was issued by a trusted party.

gstime is not a dependency. An application-supplied clock must explicitly project its time to Unix seconds and handle provider failures; continuous GST instants are not interchangeable with POSIX timestamps.

## Migrating from the Legacy API

The original Go package, Python `randflake.Generator`, and TypeScript `randflake` entrypoint remain available as deprecated compatibility facades. Removal is reserved for a future major release. Python warns at construction, never per generated ID; Go and TypeScript use deprecation documentation.

| Legacy | v2 |
|---|---|
| Positional node/start/end/secret constructor | `Config` with `Lease`, secret, and optional clock |
| Inclusive `leaseEnd` / `lease_end` | Exclusive end: pass the old end **plus one** |
| Mutable clock assignment | Constructor-supplied clock |
| Boolean lease update | Valid idempotent extension succeeds; invalid requests return/raise a domain error |
| Inspection tuple | Named `Parts` fields |
| Case-insensitive, padding-terminated string input | Canonical lowercase, unpadded base32hex only |

Both surfaces share one generation implementation per language. Existing encrypted IDs and canonical strings remain compatible; internal counters and the old counter progression are not a persistence API. Use lease update methods instead of mutating allocation state.

Go and Python return signed 64-bit integer values; TypeScript returns signed `bigint`. For JSON interchange, use decimal strings or the base32hex representation rather than converting IDs to JavaScript `number`.

## Performance

Go allocates the timestamp and sequence in one CAS state transition; successful numeric generation has no per-ID heap allocation. A heavily shared generator can contend on this state. Independent generators require distinct leased node IDs, not copies of one generator.

Python locks only clock reading and allocation; encryption runs outside the lock. TypeScript reuses its crypto buffer and precomputes node bits. Neither implementation creates a lease snapshot on each generation.

Benchmarks must stay below per-second capacity or advance a controlled clock. Burst `ns/op` figures are not sustained IDs/second guarantees, and benchmarks using separate generators do not measure shared-generator contention.

## String Representation

v2 codecs accept signed 64-bit IDs and emit canonical lowercase base32hex:

```python
from randflake.v2 import decode_string, encode_string

assert encode_string(4594531474933654033) == "3vgoe12ccb8gh"
assert decode_string("3vgoe12ccb8gh") == 4594531474933654033
assert encode_string(-1) == "fvvvvvvvvvvvv"
assert decode_string("fvvvvvvvvvvvv") == -1
```

The strict decoder rejects empty input, leading zeros except `"0"`, uppercase, padding, invalid characters, and values exceeding 64 bits. Legacy decoders retain their permissive case/padding behavior and modulo-64 overflow handling.

## Cross-Language Test Vectors

The repository root contains `test_vectors.json`, generated by the Go test
suite and consumed by the Go, Python, and TypeScript tests. Each vector records
the secret, lease, timestamp, node ID, sequence, raw bit-packed ID, encrypted ID,
and base32hex encoded ID.

The `raw_id` and `encrypted_id` values are JSON strings, not JSON numbers, so
64-bit values round-trip safely in JavaScript/TypeScript and other IEEE
754-number environments.

Vector lease ends retain the legacy inclusive convention; v2 consumers add one to obtain the exclusive end. The corpus includes both the first timestamp setting raw bit 63 and the final supported timestamp.

To regenerate the canonical vectors after an intentional algorithm change:

```bash
go test . -run TestRandflakeTestVectors -update-test-vectors
```

## Contributing

Contributions are welcome! Please follow these steps:

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

Distributed under the MIT License. See `LICENSE` for more information.

## More Information

For detailed documentation and additional resources, visit: [https://gosuda.org/randflake](https://gosuda.org/randflake)
