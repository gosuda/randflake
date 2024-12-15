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
- 🚀 **High-Performance ID Generation**: Optimized for lock-free operation to minimize latency and maximize throughput
- 📈 **Scalable**: Engineered to handle high-throughput systems with a maximum ID generation rate of 17,179,869,184 ID/s
- 🔀 **Distributed-Friendly**: Suitable for distributed systems and microservices
- 📊 **Uniform Distribution**: Ensures even spread of generated IDs

## Installation

### Go
```bash
go get -u gosuda.org/randflake
```

### Python
```bash
pip install randflake
```

### TypeScript/JavaScript
```bash
npm install randflake
```

## Usage Examples

### Go
```go
package main

import (
    "fmt"
    "time"

    "gosuda.org/randflake"
)

func main() {
    now := time.Now().Unix()

    nodeid := int64(42)
    lease_start := int64(now)
    lease_end := int64(now + 600)
    secret := []byte("super-secret-key")

    g, err := randflake.NewGenerator(nodeid, lease_start, lease_end, secret)
    if err != nil {
        panic(err)
    }

    id, err := g.Generate()
    if err != nil {
        panic(err)
    }
    fmt.Println(id)
}
```

### Python
```python
import time
from randflake import Generator

now = int(time.time())

nodeid = 42
lease_start = now
lease_end = now + 600
secret = b'super-secret-key'

g = Generator(nodeid, lease_start, lease_end, secret)

uid = g.generate()
print(uid)
```

### TypeScript/JavaScript
```typescript
import { Generator } from 'randflake';

const now = Math.floor(Date.now() / 1000);

const nodeid = 42;
const lease_start = now;
const lease_end = now + 600;
const secret = new TextEncoder().encode('super-secret-key');

const generator = new Generator(nodeid, lease_start, lease_end, secret);
const uid = generator.generate();
console.log(uid);
```

## Performance

Randflake ID is designed for high-performance scenarios, with minimal overhead in ID generation.

## String Representation

Randflake ID is encoded as a base32hex string.

```python
base32hexchars = "0123456789abcdefghijklmnopqrstuv"

original = 4594531474933654033
encoded = "3vgoe12ccb8gh"

def decode(s):
    return int(s, 32)

def encode(n):
    if n < 0:
        n += 1 << 64
    
    if n == 0:
        return "0"
    
    result = ""
    while n > 0:
        result = base32hexchars[n&0x1f] + result
        n = n // 32
    return result

assert original == decode(encode(original))
assert encode(original) == "3vgoe12ccb8gh"
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
