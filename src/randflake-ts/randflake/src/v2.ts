import { GeneratorCore, decodeString, type Config, type Lease, type Parts } from './core.js';

export {
  RANDFLAKE_EPOCH_OFFSET,
  RANDFLAKE_TIMESTAMP_BITS,
  RANDFLAKE_NODE_BITS,
  RANDFLAKE_SEQUENCE_BITS,
  RANDFLAKE_MAX_TIMESTAMP,
  RANDFLAKE_MAX_NODE,
  RANDFLAKE_MAX_SEQUENCE,
  RandflakeError,
  ErrRandflakeDead,
  ErrInvalidSecret,
  ErrInvalidLease,
  ErrInvalidNode,
  ErrResourceExhausted,
  ErrConsistencyViolation,
  ErrInvalidID,
  encodeString,
  decodeString,
  type Clock,
  type Config,
  type Lease,
  type Parts,
} from './core.js';

export class Generator {
  private readonly core: GeneratorCore;

  constructor(config: Config) {
    this.core = new GeneratorCore(config);
  }

  generate(): bigint {
    return this.core.generate();
  }

  generateString(): string {
    return this.core.generateString();
  }

  extendLease(next: Lease): void {
    this.core.extendLease(next);
  }

  lease(): Lease {
    return this.core.lease();
  }

  /** Decrypts any signed 64-bit value; it does not authenticate the ID. */
  inspect(id: bigint): Parts {
    return this.core.inspect(id);
  }

  inspectString(id: string): Parts {
    return this.inspect(decodeString(id));
  }
}
