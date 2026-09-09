import { describe, it, expect } from 'vitest';
import {
  Generator,
  RANDFLAKE_EPOCH_OFFSET,
  RANDFLAKE_MAX_TIMESTAMP,
  RANDFLAKE_MAX_NODE,
  RANDFLAKE_MAX_SEQUENCE,
  ErrConsistencyViolation,
  ErrInvalidID,
  ErrInvalidLease,
  ErrInvalidNode,
  ErrInvalidSecret,
  ErrResourceExhausted,
  RandflakeError,
  encodeString,
  decodeString,
} from './v2.js';

const epoch = RANDFLAKE_EPOCH_OFFSET;

describe('v2 allocation', () => {
  it('resets sequence at each new second and rejects rollback after rollover', () => {
    let now = epoch;
    const generator = new Generator({
      lease: { nodeID: 7, start: epoch, endExclusive: epoch + 3 },
      secret: new Uint8Array(16),
      clock: () => now,
    });
    const first = generator.generate();
    expect(generator.inspect(first).sequence).toBe(0);
    expect(generator.inspect(generator.generate()).sequence).toBe(1);
    now++;
    const nextSecond = generator.generate();
    expect(generator.inspect(nextSecond).timestamp).toBe(now);
    expect(generator.inspect(nextSecond).sequence).toBe(0);
    expect(nextSecond).not.toBe(first);
    now--;
    expect(() => generator.generate()).toThrow(ErrConsistencyViolation);
    now++;
    expect(generator.inspect(generator.generate()).sequence).toBe(1);
  });

  it('allocates every sequence exactly once before exhaustion and resumes at zero next second', () => {
    let now = epoch;
    const generator = new Generator({
      lease: { nodeID: 0, start: epoch, endExclusive: epoch + 2 },
      secret: new Uint8Array(16),
      clock: () => now,
    });
    const seen = new Set<bigint>();
    let last = 0n;
    for (let sequence = 0; sequence <= RANDFLAKE_MAX_SEQUENCE; sequence++) {
      last = generator.generate();
      seen.add(last);
    }
    expect(seen.size).toBe(RANDFLAKE_MAX_SEQUENCE + 1);
    expect(generator.inspect(last).sequence).toBe(RANDFLAKE_MAX_SEQUENCE);
    expect(() => generator.generate()).toThrow(ErrResourceExhausted);
    expect(() => generator.generate()).toThrow(ErrResourceExhausted);
    now++;
    const resumed = generator.inspect(generator.generate());
    expect(resumed.timestamp).toBe(now);
    expect(resumed.sequence).toBe(0);
  });

  it('propagates clock failures without consuming a sequence', () => {
    const failure = new Error('clock unavailable');
    let fail = false;
    const generator = new Generator({
      lease: { nodeID: 0, start: epoch, endExclusive: epoch + 1 },
      secret: new Uint8Array(16),
      clock: () => {
        if (fail) throw failure;
        return epoch;
      },
    });
    expect(generator.inspect(generator.generate()).sequence).toBe(0);
    fail = true;
    expect(() => generator.generate()).toThrow(failure);
    fail = false;
    expect(generator.inspect(generator.generate()).sequence).toBe(1);
  });

  it.each([0, true, 'clock', {}])('rejects a non-callable configured clock %s', clock => {
    expect(() => new Generator({
      lease: { nodeID: 0, start: epoch, endExclusive: epoch + 1 },
      secret: new Uint8Array(16),
      clock: clock as unknown as () => number,
    })).toThrow(ErrConsistencyViolation);
  });

  it.each([NaN, Infinity, -Infinity, epoch + 0.5, true, '1730000000'])(
    'rejects malformed clock seconds %s without advancing state', value => {
      let now = value as number;
      const generator = new Generator({
        lease: { nodeID: 0, start: epoch, endExclusive: epoch + 1 },
        secret: new Uint8Array(16),
        clock: () => now,
      });
      expect(() => generator.generate()).toThrow(ErrConsistencyViolation);
      now = epoch;
      expect(generator.inspect(generator.generate()).sequence).toBe(0);
    }
  );

  it.each([epoch + 2 ** 29, RANDFLAKE_MAX_TIMESTAMP])(
    'round-trips timestamp %s with the raw sign bit set', timestamp => {
      const generator = new Generator({
        lease: { nodeID: RANDFLAKE_MAX_NODE, start: timestamp, endExclusive: timestamp + 1 },
        secret: new Uint8Array(16),
        clock: () => timestamp,
      });
      const id = generator.generate();
      expect(id >= -(1n << 63n) && id < (1n << 63n)).toBe(true);
      const parts = generator.inspectString(encodeString(id));
      expect(parts.timestamp).toBe(timestamp);
      expect(parts.nodeID).toBe(RANDFLAKE_MAX_NODE);
      expect(parts.sequence).toBe(0);
    }
  );

  it('inspects IDs independently of the inspecting generator lease', () => {
    const secret = new Uint8Array(16);
    const producer = new Generator({
      lease: { nodeID: 17, start: RANDFLAKE_MAX_TIMESTAMP, endExclusive: RANDFLAKE_MAX_TIMESTAMP + 1 },
      secret,
      clock: () => RANDFLAKE_MAX_TIMESTAMP,
    });
    const inspector = new Generator({
      lease: { nodeID: 0, start: epoch, endExclusive: epoch + 1 },
      secret,
    });
    const parts = inspector.inspect(producer.generate());
    expect(parts.timestamp).toBe(RANDFLAKE_MAX_TIMESTAMP);
    expect(parts.nodeID).toBe(17);
    expect(parts.sequence).toBe(0);
  });

  it('retains key ownership when the supplied secret is modified', () => {
    const secret = new Uint8Array(16);
    const config = {
      lease: { nodeID: 0, start: epoch, endExclusive: epoch + 1 },
      secret,
      clock: () => epoch,
    };
    const generator = new Generator(config);
    secret.fill(255);
    const originalKey = new Generator({ ...config, secret: new Uint8Array(16) });
    expect(generator.generate()).toBe(originalKey.generate());
  });
});

describe('v2 leases', () => {
  it('honors half-open bounds without consuming state on lease errors', () => {
    let now = epoch - 1;
    const generator = new Generator({
      lease: { nodeID: 0, start: epoch, endExclusive: epoch + 1 },
      secret: new Uint8Array(16),
      clock: () => now,
    });
    expect(() => generator.generate()).toThrow(ErrInvalidLease);
    now = epoch + 1;
    expect(() => generator.generate()).toThrow(ErrInvalidLease);
    now = epoch;
    expect(generator.inspect(generator.generate()).sequence).toBe(0);
  });

  it('extends monotonically and accepts already-satisfied requests', () => {
    let now = epoch;
    const lease = { nodeID: 2, start: epoch, endExclusive: epoch + 1 };
    const generator = new Generator({ lease, secret: new Uint8Array(16), clock: () => now });
    generator.generate();
    const snapshot = generator.lease();
    generator.extendLease({ ...lease, endExclusive: epoch + 3 });
    generator.extendLease({ ...lease, endExclusive: epoch + 3 });
    generator.extendLease(lease);
    expect(snapshot.endExclusive).toBe(epoch + 1);
    expect(generator.lease().endExclusive).toBe(epoch + 3);
    expect(generator.inspect(generator.generate()).sequence).toBe(1);
    now = epoch + 2;
    expect(generator.inspect(generator.generate()).timestamp).toBe(now);
  });

  it('does not permit caller-owned lease data or snapshots to extend a lease', () => {
    const lease = { nodeID: 0, start: epoch, endExclusive: epoch + 1 };
    const generator = new Generator({ lease, secret: new Uint8Array(16), clock: () => epoch + 1 });
    lease.endExclusive = epoch + 2;
    expect(Reflect.set(generator.lease(), 'endExclusive', epoch + 2)).toBe(false);
    expect(() => generator.generate()).toThrow(ErrInvalidLease);
  });

  it.each([
    { nodeID: 1, start: epoch, endExclusive: epoch + 3 },
    { nodeID: 0, start: epoch + 1, endExclusive: epoch + 3 },
    { nodeID: 0, start: epoch, endExclusive: epoch },
    { nodeID: 0, start: epoch, endExclusive: RANDFLAKE_MAX_TIMESTAMP + 2 },
    { nodeID: 0, start: epoch, endExclusive: NaN },
    { nodeID: 0, start: epoch, endExclusive: epoch + 1.5 },
  ])('rejects an invalid renewal %o without changing the lease', next => {
    const generator = new Generator({
      lease: { nodeID: 0, start: epoch, endExclusive: epoch + 2 },
      secret: new Uint8Array(16),
    });
    expect(() => generator.extendLease(next)).toThrow(ErrInvalidLease);
    expect(generator.lease().endExclusive).toBe(epoch + 2);
  });

  it.each([NaN, Infinity, -Infinity, 1.5, epoch + 0.5, true, '1'])(
    'rejects invalid numeric lease fields %s', value => {
      const number = value as number;
      const lease = { nodeID: 0, start: epoch, endExclusive: epoch + 1 };
      const secret = new Uint8Array(16);
      expect(() => new Generator({ lease: { ...lease, nodeID: number }, secret })).toThrow(ErrInvalidNode);
      expect(() => new Generator({ lease: { ...lease, start: number }, secret })).toThrow(ErrInvalidLease);
      expect(() => new Generator({ lease: { ...lease, endExclusive: number }, secret })).toThrow(ErrInvalidLease);
      const generator = new Generator({ lease, secret });
      expect(() => generator.extendLease({ ...lease, nodeID: number })).toThrow(ErrInvalidLease);
      expect(() => generator.extendLease({ ...lease, start: number })).toThrow(ErrInvalidLease);
      expect(() => generator.extendLease({ ...lease, endExclusive: number })).toThrow(ErrInvalidLease);
      expect(generator.lease().endExclusive).toBe(epoch + 1);
    }
  );

  it.each([
    { nodeID: 0, start: epoch - 1, endExclusive: epoch + 1 },
    { nodeID: 0, start: epoch, endExclusive: epoch },
    { nodeID: 0, start: epoch + 1, endExclusive: epoch },
    { nodeID: 0, start: epoch, endExclusive: RANDFLAKE_MAX_TIMESTAMP + 2 },
  ])('rejects invalid half-open lease bounds %o', lease => {
    expect(() => new Generator({ lease, secret: new Uint8Array(16) })).toThrow(ErrInvalidLease);
  });

  it.each([-1, RANDFLAKE_MAX_NODE + 1])('rejects out-of-range node %s', nodeID => {
    expect(() => new Generator({
      lease: { nodeID, start: epoch, endExclusive: epoch + 1 },
      secret: new Uint8Array(16),
    })).toThrow(ErrInvalidNode);
  });

  it.each([new Uint8Array(15), new Uint8Array(17), null, '0123456789abcdef'])(
    'rejects malformed secrets %s', secret => {
      expect(() => new Generator({
        lease: { nodeID: 0, start: epoch, endExclusive: epoch + 1 },
        secret: secret as Uint8Array,
      })).toThrow(ErrInvalidSecret);
    }
  );
});

describe('v2 canonical codec', () => {
  it.each([
    [0n, '0'],
    [1n, '1'],
    [(1n << 63n) - 1n, '7vvvvvvvvvvvv'],
    [-(1n << 63n), '8000000000000'],
    [-1n, 'fvvvvvvvvvvvv'],
  ] as const)('round-trips signed boundary %s', (id, encoded) => {
    expect(encodeString(id)).toBe(encoded);
    expect(decodeString(encoded)).toBe(id);
  });

  it.each(['', 'A', '0=', '00', '01', 'w', '-1', ' 1', '1\n', '00000000000000', 'g000000000000', 'vvvvvvvvvvvvv'])(
    'rejects noncanonical or overflowing ID %j', id => {
      expect(() => decodeString(id)).toThrow(ErrInvalidID);
      const generator = new Generator({
        lease: { nodeID: 0, start: epoch, endExclusive: epoch + 1 },
        secret: new Uint8Array(16),
      });
      expect(() => generator.inspectString(id)).toThrow(ErrInvalidID);
    }
  );

  it.each([-(1n << 63n) - 1n, 1n << 63n, 1, NaN, true, '1', null])(
    'rejects invalid numeric ID %s with a domain error', value => {
      const id = value as bigint;
      const generator = new Generator({
        lease: { nodeID: 0, start: epoch, endExclusive: epoch + 1 },
        secret: new Uint8Array(16),
      });
      expect(() => encodeString(id)).toThrow(ErrInvalidID);
      expect(() => generator.inspect(id)).toThrow(ErrInvalidID);
      expect(() => encodeString(id)).toThrow(RandflakeError);
    }
  );
});
