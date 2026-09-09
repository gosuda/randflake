import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  Generator,
  RANDFLAKE_EPOCH_OFFSET,
  RANDFLAKE_MAX_NODE,
  RANDFLAKE_MAX_TIMESTAMP,
  ErrInvalidNode,
  ErrInvalidLease,
  ErrRandflakeDead,
  ErrInvalidSecret,
  ErrInvalidID,
  RandflakeError,
  encodeString,
  decodeString,
} from './index.js';
import {
  Generator as GeneratorV2,
  decodeString as decodeStringV2,
  encodeString as encodeStringV2,
} from './v2.js';

interface TestVector {
  secret: string;
  node_id: number;
  lease_start: number;
  lease_end: number;
  timestamp: number;
  sequence: number;
  encrypted_id: string;
  encoded_id: string;
}

const testVectors = JSON.parse(
  readFileSync(new URL('../../../../test_vectors.json', import.meta.url), 'utf8')
) as TestVector[];

function secretFromHex(secret: string): Uint8Array {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(secret.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

const epoch = RANDFLAKE_EPOCH_OFFSET;

describe('legacy compatibility', () => {
  it('uses inclusive lease ends and tuple inspection', () => {
    let now = epoch + 1;
    const generator = new Generator(7, epoch, now, new Uint8Array(16));
    generator.timeSource = () => now;
    const id = generator.generate();
    expect(generator.inspect(id)).toEqual([now, 7, 0]);
    expect(generator.inspectString(encodeString(id).toUpperCase() + '===')).toEqual([now, 7, 0]);
    now++;
    expect(() => generator.generate()).toThrow(ErrInvalidLease);
  });

  it('accepts a one-second inclusive lease at the final timestamp', () => {
    const generator = new Generator(0, RANDFLAKE_MAX_TIMESTAMP, RANDFLAKE_MAX_TIMESTAMP, new Uint8Array(16));
    generator.timeSource = () => RANDFLAKE_MAX_TIMESTAMP;
    expect(generator.inspect(generator.generate())).toEqual([RANDFLAKE_MAX_TIMESTAMP, 0, 0]);
  });

  it('preserves boolean lease updates without shrinking the lease', () => {
    const generator = new Generator(1, epoch, epoch + 1, new Uint8Array(16));
    generator.timeSource = () => epoch + 2;
    expect(() => generator.generate()).toThrow(ErrInvalidLease);
    expect(generator.updateLease(epoch, epoch + 2)).toBe(true);
    expect(generator.updateLease(epoch, epoch + 2)).toBe(false);
    expect(generator.updateLease(epoch, epoch + 1)).toBe(false);
    expect(generator.updateLease(epoch + 1, epoch + 3)).toBe(false);
    expect(generator.updateLease(epoch, RANDFLAKE_MAX_TIMESTAMP + 1)).toBe(false);
    expect(generator.inspect(generator.generate())).toEqual([epoch + 2, 1, 0]);
  });

  it('returns detached legacy lease information', () => {
    const generator = new Generator(1, epoch, epoch + 1, new Uint8Array(16));
    const snapshot = generator.getLeaseInfo();
    snapshot.leaseEnd = epoch + 100;
    expect(generator.getLeaseInfo().leaseEnd).toBe(epoch + 1);
    generator.updateLease(epoch, epoch + 2);
    expect(snapshot.leaseStart).toBe(epoch);
    expect(generator.getLeaseInfo().leaseEnd).toBe(epoch + 2);
  });

  it('preserves permissive base32hex decoding and integer wrapping', () => {
    expect(decodeString('')).toBe(0n);
    expect(decodeString('000A===ignored')).toBe(10n);
    expect(decodeString('FVVVVVVVVVVVV')).toBe(-1n);
    expect(decodeString('g000000000000')).toBe(0n);
    expect(encodeString(1n << 64n)).toBe('0');
    expect(encodeString(-1n)).toBe('fvvvvvvvvvvvv');
    expect(() => decodeString('w')).toThrow(ErrInvalidID);
  });

  it('preserves domain error categories', () => {
    expect(() => new Generator(-1, epoch, epoch + 1, new Uint8Array(16))).toThrow(ErrInvalidNode);
    expect(() => new Generator(RANDFLAKE_MAX_NODE + 1, epoch, epoch + 1, new Uint8Array(16))).toThrow(ErrInvalidNode);
    expect(() => new Generator(1, epoch - 1, epoch + 1, new Uint8Array(16))).toThrow(ErrInvalidLease);
    expect(() => new Generator(1, epoch + 1, epoch, new Uint8Array(16))).toThrow(ErrInvalidLease);
    expect(() => new Generator(1, epoch, RANDFLAKE_MAX_TIMESTAMP + 1, new Uint8Array(16))).toThrow(ErrRandflakeDead);
    expect(() => new Generator(1, epoch, epoch + 1, new Uint8Array(15))).toThrow(ErrInvalidSecret);
    expect(() => decodeString('!')).toThrow(RandflakeError);
  });

  it.each([NaN, Infinity, -Infinity, 1.5, epoch + 0.5, true, '1'])('rejects invalid numeric input %s', value => {
    const number = value as number;
    expect(() => new Generator(number, epoch, epoch + 1, new Uint8Array(16))).toThrow(ErrInvalidNode);
    expect(() => new Generator(1, number, epoch + 1, new Uint8Array(16))).toThrow(ErrInvalidLease);
    expect(() => new Generator(1, epoch, number, new Uint8Array(16))).toThrow(ErrInvalidLease);
    const generator = new Generator(1, epoch, epoch + 1, new Uint8Array(16));
    expect(generator.updateLease(epoch, number)).toBe(false);
    expect(generator.getLeaseInfo().leaseEnd).toBe(epoch + 1);
  });
});

describe('shared wire vectors', () => {
  for (const [index, vector] of testVectors.entries()) {
    it(`inspects historical vector ${index + 1} through both entrypoints`, () => {
      const secret = secretFromHex(vector.secret);
      const legacy = new Generator(vector.node_id, vector.lease_start, vector.lease_end, secret);
      const modern = new GeneratorV2({
        lease: { nodeID: vector.node_id, start: vector.lease_start, endExclusive: vector.lease_end + 1 },
        secret,
      });
      const id = BigInt(vector.encrypted_id);
      const expected = [vector.timestamp, vector.node_id, vector.sequence];
      expect(legacy.inspect(id)).toEqual(expected);
      expect(legacy.inspectString(vector.encoded_id)).toEqual(expected);
      const parts = modern.inspect(id);
      expect(parts.timestamp).toBe(vector.timestamp);
      expect(parts.nodeID).toBe(vector.node_id);
      expect(parts.sequence).toBe(vector.sequence);
      const stringParts = modern.inspectString(vector.encoded_id);
      expect(stringParts.timestamp).toBe(vector.timestamp);
      expect(stringParts.nodeID).toBe(vector.node_id);
      expect(stringParts.sequence).toBe(vector.sequence);
      expect(decodeString(vector.encoded_id)).toBe(id);
      expect(decodeStringV2(vector.encoded_id)).toBe(id);
      expect(encodeString(id)).toBe(vector.encoded_id);
      expect(encodeStringV2(id)).toBe(vector.encoded_id);
    });

    if (vector.sequence <= 1) {
      it(`generates vector ${index + 1} through public allocations`, () => {
        const secret = secretFromHex(vector.secret);
        const legacy = new Generator(vector.node_id, vector.lease_start, vector.lease_end, secret);
        legacy.timeSource = () => vector.timestamp;
        const config = {
          lease: { nodeID: vector.node_id, start: vector.lease_start, endExclusive: vector.lease_end + 1 },
          secret,
          clock: () => vector.timestamp,
        };
        const modern = new GeneratorV2(config);
        const stringGenerator = new GeneratorV2(config);
        for (let sequence = 0; sequence < vector.sequence; sequence++) {
          legacy.generate();
          modern.generate();
          stringGenerator.generate();
        }
        expect(legacy.generate()).toBe(BigInt(vector.encrypted_id));
        expect(modern.generate()).toBe(BigInt(vector.encrypted_id));
        expect(stringGenerator.generateString()).toBe(vector.encoded_id);
      });
    }
  }
});
