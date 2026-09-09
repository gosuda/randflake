import {
  GeneratorCore,
  ErrInvalidLease,
  ErrRandflakeDead,
  RANDFLAKE_MAX_TIMESTAMP,
  decodeBase32,
  systemClock,
  type Clock,
} from './core.js';

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
} from './core.js';

/** @deprecated Use the signed-64-bit validating codec from randflake/v2. */
export function encodeString(id: bigint): string {
  return BigInt.asUintN(64, id).toString(32);
}

/** @deprecated Use the canonical lowercase codec from randflake/v2. */
export function decodeString(id: string): bigint {
  return BigInt.asIntN(64, decodeBase32(id));
}

/** @deprecated Use Lease from randflake/v2, whose endExclusive is half-open. */
export interface LeaseInfo {
  nodeID: number;
  leaseStart: number;
  leaseEnd: number;
}

/** @deprecated Use Generator from randflake/v2 with a Config and half-open lease. */
export class Generator {
  private readonly core: GeneratorCore;

  /** @deprecated Supply Config.clock to randflake/v2 instead. */
  timeSource?: Clock;

  constructor(nodeID: number, leaseStart: number, leaseEnd: number, secret: Uint8Array) {
    if (!Number.isInteger(leaseStart) || !Number.isInteger(leaseEnd) || leaseEnd < leaseStart) {
      throw new ErrInvalidLease();
    }
    if (leaseEnd > RANDFLAKE_MAX_TIMESTAMP) {
      throw new ErrRandflakeDead();
    }
    this.core = new GeneratorCore({
      lease: { nodeID, start: leaseStart, endExclusive: leaseEnd + 1 },
      secret,
      clock: () => this.timeSource ? this.timeSource() : systemClock(),
    });
  }

  updateLease(leaseStart: number, leaseEnd: number): boolean {
    const current = this.core.lease();
    if (!Number.isInteger(leaseStart) || !Number.isInteger(leaseEnd) ||
        leaseStart !== current.start || leaseEnd < leaseStart ||
        leaseEnd > RANDFLAKE_MAX_TIMESTAMP || leaseEnd + 1 <= current.endExclusive) {
      return false;
    }
    this.core.extendLease({ nodeID: current.nodeID, start: leaseStart, endExclusive: leaseEnd + 1 });
    return true;
  }

  getLeaseInfo(): LeaseInfo {
    const { nodeID, start, endExclusive } = this.core.lease();
    return { nodeID, leaseStart: start, leaseEnd: endExclusive - 1 };
  }

  generate(): bigint {
    return this.core.generate();
  }

  generateString(): string {
    return this.core.generateString();
  }

  inspect(id: bigint): [number, number, number] {
    const { timestamp, nodeID, sequence } = this.core.inspect(BigInt.asIntN(64, id));
    return [timestamp, nodeID, sequence];
  }

  inspectString(id: string): [number, number, number] {
    return this.inspect(decodeString(id));
  }
}
