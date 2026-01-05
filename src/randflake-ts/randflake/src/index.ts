import { Sparx64 } from 'sparx64';

// Constants
export const RANDFLAKE_EPOCH_OFFSET = 1730000000; // Sunday, October 27, 2024 3:33:20 AM UTC

// Bits allocation
export const RANDFLAKE_TIMESTAMP_BITS = 30; // 30 bits for timestamp (lifetime of 34 years)
export const RANDFLAKE_NODE_BITS = 17; // 17 bits for node id (max 131072 nodes)
export const RANDFLAKE_SEQUENCE_BITS = 17; // 17 bits for sequence (max 131072 sequences)

// Derived constants
export const RANDFLAKE_MAX_TIMESTAMP = RANDFLAKE_EPOCH_OFFSET + (1 << RANDFLAKE_TIMESTAMP_BITS) - 1;
export const RANDFLAKE_MAX_NODE = (1 << RANDFLAKE_NODE_BITS) - 1;
export const RANDFLAKE_MAX_SEQUENCE = (1 << RANDFLAKE_SEQUENCE_BITS) - 1;

// Custom error classes
export class RandflakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RandflakeError';
  }
}

export class ErrRandflakeDead extends RandflakeError {
  constructor() {
    super('randflake: the randflake id is dead after 34 years of lifetime');
  }
}

export class ErrInvalidSecret extends RandflakeError {
  constructor() {
    super('randflake: invalid secret, secret must be 16 bytes long');
  }
}

export class ErrInvalidLease extends RandflakeError {
  constructor() {
    super('randflake: invalid lease, lease expired or not started yet');
  }
}

export class ErrInvalidNode extends RandflakeError {
  constructor() {
    super('randflake: invalid node id, node id must be between 0 and 131071');
  }
}

export class ErrResourceExhausted extends RandflakeError {
  constructor() {
    super('randflake: resource exhausted (generator can\'t handle current throughput, try using multiple randflake instances)');
  }
}

export class ErrConsistencyViolation extends RandflakeError {
  constructor() {
    super('randflake: timestamp consistency violation, the current time is less than the last time');
  }
}

export interface LeaseInfo {
  nodeID: number;
  leaseStart: number;
  leaseEnd: number;
}

export class Generator {
  private leaseStart: number;
  private leaseEnd: number;
  private nodeID: number;
  private sequence: number;
  private rollover: number;
  private sbox: Sparx64;
  private timeSource?: () => number;

  constructor(nodeID: number, leaseStart: number, leaseEnd: number, secret: Uint8Array) {
    if (leaseEnd < leaseStart) {
      throw new ErrInvalidLease();
    }

    if (nodeID < 0 || nodeID > RANDFLAKE_MAX_NODE) {
      throw new ErrInvalidNode();
    }

    if (leaseStart < RANDFLAKE_EPOCH_OFFSET) {
      throw new ErrInvalidLease();
    }

    if (leaseEnd > RANDFLAKE_MAX_TIMESTAMP) {
      throw new ErrRandflakeDead();
    }

    if (secret.length !== 16) {
      throw new ErrInvalidSecret();
    }

    this.leaseStart = leaseStart;
    this.leaseEnd = leaseEnd;
    this.nodeID = nodeID;
    this.sequence = 0;
    this.rollover = leaseStart;
    this.sbox = new Sparx64(secret);
  }

  updateLease(leaseStart: number, leaseEnd: number): boolean {
    if (leaseStart !== this.leaseStart) {
      return false;
    }

    if (leaseEnd < leaseStart) {
      return false;
    }

    if (leaseEnd > RANDFLAKE_MAX_TIMESTAMP) {
      return false;
    }

    if (this.leaseEnd < leaseEnd) {
      this.leaseEnd = leaseEnd;
      return true;
    }

    return false;
  }

  getLeaseInfo(): LeaseInfo {
    return {
      nodeID: this.nodeID,
      leaseStart: this.leaseStart,
      leaseEnd: this.leaseEnd,
    };
  }

  private newRAW(): bigint {
    while (true) {
      const now = this.timeSource ? this.timeSource() : Math.floor(Date.now() / 1000);

      if (now < this.leaseStart) {
        throw new ErrInvalidLease();
      }

      if (now > this.leaseEnd) {
        throw new ErrInvalidLease();
      }

      this.sequence++;
      if (this.sequence > RANDFLAKE_MAX_SEQUENCE) {
        if (now > this.rollover) {
          this.rollover = now;
          this.sequence = 0;
        } else {
          if (now < this.rollover) {
            throw new ErrConsistencyViolation();
          }
          throw new ErrResourceExhausted();
        }
      }

      const timestamp = BigInt(now - RANDFLAKE_EPOCH_OFFSET);
      const nodeID = BigInt(this.nodeID);
      const sequence = BigInt(this.sequence);

      return (timestamp << BigInt(RANDFLAKE_NODE_BITS + RANDFLAKE_SEQUENCE_BITS)) |
             (nodeID << BigInt(RANDFLAKE_SEQUENCE_BITS)) |
             sequence;
    }
  }

  generate(): bigint {
    const idRaw = this.newRAW();
    const src = new Uint8Array(8);
    const view = new DataView(src.buffer);
    view.setBigInt64(0, idRaw, true);
    
    const dst = new Uint8Array(8);
    this.sbox.encrypt(dst, src);
    
    const dstView = new DataView(dst.buffer);
    return dstView.getBigInt64(0, true);
  }

  inspect(idVal: bigint): [number, number, number] {
    const src = new Uint8Array(8);
    const view = new DataView(src.buffer);
    view.setBigInt64(0, idVal, true);
    
    const dst = new Uint8Array(8);
    this.sbox.decrypt(dst, src);
    
    const dstView = new DataView(dst.buffer);
    const idRaw = dstView.getBigInt64(0, true);

    if (idRaw < 0) {
      throw new ErrInvalidLease();
    }

    const timestamp = Number(idRaw >> BigInt(RANDFLAKE_NODE_BITS + RANDFLAKE_SEQUENCE_BITS)) + RANDFLAKE_EPOCH_OFFSET;
    const nodeID = Number((idRaw >> BigInt(RANDFLAKE_SEQUENCE_BITS)) & BigInt(RANDFLAKE_MAX_NODE));
    const sequence = Number(idRaw & BigInt(RANDFLAKE_MAX_SEQUENCE));

    return [timestamp, nodeID, sequence];
  }
}
