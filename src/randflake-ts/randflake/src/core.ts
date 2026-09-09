import { Sparx64 } from 'sparx64';

export const RANDFLAKE_EPOCH_OFFSET = 1730000000;
export const RANDFLAKE_TIMESTAMP_BITS = 30;
export const RANDFLAKE_NODE_BITS = 17;
export const RANDFLAKE_SEQUENCE_BITS = 17;
export const RANDFLAKE_MAX_TIMESTAMP: number = RANDFLAKE_EPOCH_OFFSET + 2 ** RANDFLAKE_TIMESTAMP_BITS - 1;
export const RANDFLAKE_MAX_NODE: number = 2 ** RANDFLAKE_NODE_BITS - 1;
export const RANDFLAKE_MAX_SEQUENCE: number = 2 ** RANDFLAKE_SEQUENCE_BITS - 1;

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
    super('randflake: invalid lease');
  }
}

export class ErrInvalidNode extends RandflakeError {
  constructor() {
    super('randflake: invalid node id, node id must be between 0 and 131071');
  }
}

export class ErrResourceExhausted extends RandflakeError {
  constructor() {
    super('randflake: sequence capacity exhausted for this second');
  }
}

export class ErrConsistencyViolation extends RandflakeError {
  constructor() {
    super('randflake: clock must return nondecreasing integer Unix seconds');
  }
}

export class ErrInvalidID extends RandflakeError {
  constructor() {
    super('randflake: invalid id');
  }
}

/** Returns POSIX Unix seconds. Must be read-only and non-reentrant; failures propagate. */
export type Clock = () => number;

export interface Lease {
  readonly nodeID: number;
  readonly start: number;
  readonly endExclusive: number;
}

export interface Config {
  readonly lease: Lease;
  readonly secret: Uint8Array;
  readonly clock?: Clock;
}

/** Decrypted fields are not proof of authenticity. */
export interface Parts {
  readonly timestamp: number;
  readonly nodeID: number;
  readonly sequence: number;
}

export function systemClock(): number {
  return Math.floor(Date.now() / 1000);
}

function validateLease(lease: Lease): void {
  if (!Number.isInteger(lease.nodeID) || lease.nodeID < 0 || lease.nodeID > RANDFLAKE_MAX_NODE) {
    throw new ErrInvalidNode();
  }
  if (!Number.isInteger(lease.start) || !Number.isInteger(lease.endExclusive) ||
      lease.start < RANDFLAKE_EPOCH_OFFSET || lease.start >= lease.endExclusive) {
    throw new ErrInvalidLease();
  }
  if (lease.endExclusive > RANDFLAKE_MAX_TIMESTAMP + 1) {
    throw new ErrInvalidLease();
  }
}

function validateID(id: bigint): void {
  if (typeof id !== 'bigint' || id < -(1n << 63n) || id > (1n << 63n) - 1n) {
    throw new ErrInvalidID();
  }
}

export function encodeString(id: bigint): string {
  validateID(id);
  return BigInt.asUintN(64, id).toString(32);
}

export function decodeString(id: string): bigint {
  if (typeof id !== 'string' || id.length === 0 || id.length > 13 ||
      !/^(?:0|[1-9a-v][0-9a-v]*)$/.test(id)) {
    throw new ErrInvalidID();
  }
  const value = decodeBase32(id);
  if (value > (1n << 64n) - 1n) {
    throw new ErrInvalidID();
  }
  return BigInt.asIntN(64, value);
}

export function decodeBase32(id: string): bigint {
  let value = 0n;
  for (const character of id) {
    if (character === '=') {
      break;
    }
    const code = character.charCodeAt(0);
    let digit: number;
    if (code >= 48 && code <= 57) {
      digit = code - 48;
    } else if (code >= 97 && code <= 118) {
      digit = code - 97 + 10;
    } else if (code >= 65 && code <= 86) {
      digit = code - 65 + 10;
    } else {
      throw new ErrInvalidID();
    }
    value = (value << 5n) | BigInt(digit);
  }
  return value;
}

export class GeneratorCore {
  private currentLease: Lease;
  private readonly clock: Clock;
  private readonly sbox: Sparx64;
  private readonly nodeBits: bigint;
  private readonly block = new Uint8Array(8);
  private readonly view = new DataView(this.block.buffer);
  private lastTimestamp = RANDFLAKE_EPOCH_OFFSET - 1;
  private nextSequence = 0;

  constructor(config: Config) {
    const { nodeID, start, endExclusive } = config.lease;
    const lease = Object.freeze({ nodeID, start, endExclusive });
    validateLease(lease);
    if (!(config.secret instanceof Uint8Array) || config.secret.length !== 16) {
      throw new ErrInvalidSecret();
    }
    const clock = config.clock ?? systemClock;
    if (typeof clock !== 'function') {
      throw new ErrConsistencyViolation();
    }
    this.currentLease = lease;
    this.clock = clock;
    this.sbox = new Sparx64(config.secret);
    this.nodeBits = BigInt(nodeID) << 17n;
  }

  lease(): Lease {
    return this.currentLease;
  }

  extendLease(next: Lease): void {
    const { nodeID, start, endExclusive } = next;
    if (nodeID !== this.currentLease.nodeID || start !== this.currentLease.start ||
        !Number.isInteger(endExclusive) || endExclusive <= start ||
        endExclusive > RANDFLAKE_MAX_TIMESTAMP + 1) {
      throw new ErrInvalidLease();
    }
    if (endExclusive > this.currentLease.endExclusive) {
      this.currentLease = Object.freeze({ nodeID, start, endExclusive });
    }
  }

  generate(): bigint {
    const now = this.clock();
    if (!Number.isInteger(now)) {
      throw new ErrConsistencyViolation();
    }
    if (now < this.currentLease.start || now >= this.currentLease.endExclusive) {
      throw new ErrInvalidLease();
    }
    if (now < this.lastTimestamp) {
      throw new ErrConsistencyViolation();
    }
    const sequence = now === this.lastTimestamp ? this.nextSequence : 0;
    if (sequence > RANDFLAKE_MAX_SEQUENCE) {
      throw new ErrResourceExhausted();
    }
    this.lastTimestamp = now;
    this.nextSequence = sequence + 1;

    const raw = (BigInt(now - RANDFLAKE_EPOCH_OFFSET) << 34n) |
      this.nodeBits | BigInt(sequence);
    this.view.setBigUint64(0, raw, true);
    this.sbox.encrypt(this.block, this.block);
    return this.view.getBigInt64(0, true);
  }

  generateString(): string {
    return BigInt.asUintN(64, this.generate()).toString(32);
  }

  inspect(id: bigint): Parts {
    validateID(id);
    this.view.setBigInt64(0, id, true);
    this.sbox.decrypt(this.block, this.block);
    const raw = this.view.getBigUint64(0, true);
    return Object.freeze({
      timestamp: Number(raw >> 34n) + RANDFLAKE_EPOCH_OFFSET,
      nodeID: Number((raw >> 17n) & 0x1ffffn),
      sequence: Number(raw & 0x1ffffn),
    });
  }
}
