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
- 🚀 **High Performance**: Optimized for low-latency ID generation
- 🔀 **Distributed-Friendly**: Suitable for distributed systems and microservices
- 📊 **Uniform Distribution**: Ensures even spread of generated IDs

## Installation

### Go
```bash
go get gosuda.org/randflake
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
    "gosuda.org/randflake"
)

func main() {
    id := randflake.New()
    fmt.Println(id)
}
```

### Python
```python
from randflake import Randflake

id_generator = Randflake()
unique_id = id_generator.generate()
print(unique_id)
```

### TypeScript/JavaScript
```typescript
import { Randflake } from 'randflake';

const idGenerator = new Randflake();
const uniqueId = idGenerator.generate();
console.log(uniqueId);
```

## Performance

Randflake ID is designed for high-performance scenarios, with minimal overhead in ID generation.

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
