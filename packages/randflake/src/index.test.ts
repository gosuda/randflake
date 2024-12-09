import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  Generator,
  RANDFLAKE_EPOCH_OFFSET,
  RANDFLAKE_MAX_NODE,
  RANDFLAKE_MAX_TIMESTAMP,
  ErrInvalidNode,
  ErrInvalidLease,
  ErrRandflakeDead,
  ErrInvalidSecret,
} from './index';

describe('Generator', () => {
  describe('constructor', () => {
    const tests = [
      {
        name: 'valid generator',
        nodeID: 1,
        leaseStart: RANDFLAKE_EPOCH_OFFSET + 1,
        leaseEnd: RANDFLAKE_EPOCH_OFFSET + 3600,
        secret: new Uint8Array(16),
        wantErr: null,
      },
      {
        name: 'invalid node ID - negative',
        nodeID: -1,
        leaseStart: RANDFLAKE_EPOCH_OFFSET + 1,
        leaseEnd: RANDFLAKE_EPOCH_OFFSET + 3600,
        secret: new Uint8Array(16),
        wantErr: ErrInvalidNode,
      },
      {
        name: 'invalid node ID - too large',
        nodeID: RANDFLAKE_MAX_NODE + 1,
        leaseStart: RANDFLAKE_EPOCH_OFFSET + 1,
        leaseEnd: RANDFLAKE_EPOCH_OFFSET + 3600,
        secret: new Uint8Array(16),
        wantErr: ErrInvalidNode,
      },
      {
        name: 'invalid lease - end before start',
        nodeID: 1,
        leaseStart: RANDFLAKE_EPOCH_OFFSET + 3600,
        leaseEnd: RANDFLAKE_EPOCH_OFFSET + 1,
        secret: new Uint8Array(16),
        wantErr: ErrInvalidLease,
      },
      {
        name: 'invalid lease - start before epoch',
        nodeID: 1,
        leaseStart: RANDFLAKE_EPOCH_OFFSET - 1,
        leaseEnd: RANDFLAKE_EPOCH_OFFSET + 3600,
        secret: new Uint8Array(16),
        wantErr: ErrInvalidLease,
      },
      {
        name: 'invalid lease - end after max timestamp',
        nodeID: 1,
        leaseStart: RANDFLAKE_EPOCH_OFFSET + 1,
        leaseEnd: RANDFLAKE_MAX_TIMESTAMP + 1,
        secret: new Uint8Array(16),
        wantErr: ErrRandflakeDead,
      },
      {
        name: 'invalid secret length',
        nodeID: 1,
        leaseStart: RANDFLAKE_EPOCH_OFFSET + 1,
        leaseEnd: RANDFLAKE_EPOCH_OFFSET + 3600,
        secret: new Uint8Array(15),
        wantErr: ErrInvalidSecret,
      },
    ];

    tests.forEach(({ name, nodeID, leaseStart, leaseEnd, secret, wantErr }) => {
      it(name, () => {
        if (wantErr) {
          expect(() => new Generator(nodeID, leaseStart, leaseEnd, secret))
            .toThrow(wantErr);
        } else {
          expect(() => new Generator(nodeID, leaseStart, leaseEnd, secret))
            .not.toThrow();
        }
      });
    });
  });

  describe('updateLease', () => {
    const secret = new Uint8Array(16);
    const leaseStart = RANDFLAKE_EPOCH_OFFSET + 1;
    const leaseEnd = RANDFLAKE_EPOCH_OFFSET + 3600;
    let generator: Generator;

    beforeEach(() => {
      generator = new Generator(1, leaseStart, leaseEnd, secret);
    });

    const tests = [
      {
        name: 'valid update',
        leaseStart,
        leaseEnd: leaseEnd + 3600,
        want: true,
      },
      {
        name: 'invalid start time',
        leaseStart: leaseStart + 1,
        leaseEnd: leaseEnd + 7200,
        want: false,
      },
      {
        name: 'end before start',
        leaseStart,
        leaseEnd: leaseStart - 1,
        want: false,
      },
      {
        name: 'end after max timestamp',
        leaseStart,
        leaseEnd: RANDFLAKE_MAX_TIMESTAMP + 1,
        want: false,
      },
    ];

    tests.forEach(({ name, leaseStart, leaseEnd, want }) => {
      it(name, () => {
        expect(generator.updateLease(leaseStart, leaseEnd)).toBe(want);
      });
    });
  });

  describe('generate', () => {
    it('generates unique IDs', () => {
      const secret = new Uint8Array(16);
      const now = Math.floor(Date.now() / 1000);
      const leaseStart = now - 1;
      const leaseEnd = now + 3600;

      const generator = new Generator(1, leaseStart, leaseEnd, secret);
      const seen = new Set<bigint>();

      for (let i = 0; i < 1000; i++) {
        const id = generator.generate();
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    });

    it('throws error when time is before lease start', () => {
      const secret = new Uint8Array(16);
      const now = Math.floor(Date.now() / 1000);
      const generator = new Generator(1, now + 3600, now + 7200, secret);
      
      // @ts-expect-error accessing private field for testing
      generator.timeSource = () => now;

      expect(() => generator.generate()).toThrow(ErrInvalidLease);
    });

    it('throws error when time is after lease end', () => {
      const secret = new Uint8Array(16);
      const now = Math.floor(Date.now() / 1000);
      const generator = new Generator(1, now - 7200, now - 3600, secret);
      
      // @ts-expect-error accessing private field for testing
      generator.timeSource = () => now;

      expect(() => generator.generate()).toThrow(ErrInvalidLease);
    });
  });

  describe('inspect', () => {
    it('correctly inspects generated ID', () => {
      const secret = new Uint8Array(16);
      crypto.getRandomValues(secret);

      const timestamp = 1234528n;
      const nodeID = 1n;
      const sequence = 12345n;
      const raw = (timestamp << 34n) | (nodeID << 17n) | sequence;

      const generator = new Generator(
        Number(nodeID),
        Number(timestamp) + RANDFLAKE_EPOCH_OFFSET - 3600,
        Number(timestamp) + RANDFLAKE_EPOCH_OFFSET + 3600,
        secret
      );

      const [timestamp2, nodeID2, sequence2] = generator.inspect(raw);

      expect(timestamp2).toBe(RANDFLAKE_EPOCH_OFFSET+Number(timestamp));
      expect(nodeID2).toBe(Number(nodeID));
      expect(sequence2).toBe(Number(sequence));
      expect(sequence2).toBe(Number(sequence));
    });
  });
});
