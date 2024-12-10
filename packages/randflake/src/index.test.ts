import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  Generator,
  RANDFLAKE_EPOCH_OFFSET,
  RANDFLAKE_MAX_NODE,
  RANDFLAKE_MAX_TIMESTAMP,
  ErrInvalidNode,
  ErrInvalidLease,
  ErrRandflakeDead,
  ErrInvalidSecret,
} from "./index";

describe("Generator", () => {
  describe("constructor", () => {
    const tests = [
      {
        name: "valid generator",
        nodeID: 1,
        leaseStart: RANDFLAKE_EPOCH_OFFSET + 1,
        leaseEnd: RANDFLAKE_EPOCH_OFFSET + 3600,
        secret: new Uint8Array(16),
        wantErr: null,
      },
      {
        name: "invalid node ID - negative",
        nodeID: -1,
        leaseStart: RANDFLAKE_EPOCH_OFFSET + 1,
        leaseEnd: RANDFLAKE_EPOCH_OFFSET + 3600,
        secret: new Uint8Array(16),
        wantErr: ErrInvalidNode,
      },
      {
        name: "invalid node ID - too large",
        nodeID: RANDFLAKE_MAX_NODE + 1,
        leaseStart: RANDFLAKE_EPOCH_OFFSET + 1,
        leaseEnd: RANDFLAKE_EPOCH_OFFSET + 3600,
        secret: new Uint8Array(16),
        wantErr: ErrInvalidNode,
      },
      {
        name: "invalid lease - end before start",
        nodeID: 1,
        leaseStart: RANDFLAKE_EPOCH_OFFSET + 3600,
        leaseEnd: RANDFLAKE_EPOCH_OFFSET + 1,
        secret: new Uint8Array(16),
        wantErr: ErrInvalidLease,
      },
      {
        name: "invalid lease - start before epoch",
        nodeID: 1,
        leaseStart: RANDFLAKE_EPOCH_OFFSET - 1,
        leaseEnd: RANDFLAKE_EPOCH_OFFSET + 3600,
        secret: new Uint8Array(16),
        wantErr: ErrInvalidLease,
      },
      {
        name: "invalid lease - end after max timestamp",
        nodeID: 1,
        leaseStart: RANDFLAKE_EPOCH_OFFSET + 1,
        leaseEnd: RANDFLAKE_MAX_TIMESTAMP + 1,
        secret: new Uint8Array(16),
        wantErr: ErrRandflakeDead,
      },
      {
        name: "invalid secret length",
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
          expect(
            () => new Generator(nodeID, leaseStart, leaseEnd, secret)
          ).toThrow(wantErr);
        } else {
          expect(
            () => new Generator(nodeID, leaseStart, leaseEnd, secret)
          ).not.toThrow();
        }
      });
    });
  });

  describe("updateLease", () => {
    const secret = new Uint8Array(16);
    const leaseStart = RANDFLAKE_EPOCH_OFFSET + 1;
    const leaseEnd = RANDFLAKE_EPOCH_OFFSET + 3600;
    let generator: Generator;

    beforeEach(() => {
      generator = new Generator(1, leaseStart, leaseEnd, secret);
    });

    const tests = [
      {
        name: "valid update",
        leaseStart,
        leaseEnd: leaseEnd + 3600,
        want: true,
      },
      {
        name: "invalid start time",
        leaseStart: leaseStart + 1,
        leaseEnd: leaseEnd + 7200,
        want: false,
      },
      {
        name: "end before start",
        leaseStart,
        leaseEnd: leaseStart - 1,
        want: false,
      },
      {
        name: "end after max timestamp",
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

  describe("generate", () => {
    it("generates unique IDs", () => {
      const secret = new Uint8Array(16);
      const now = RANDFLAKE_EPOCH_OFFSET + 1000; // Fixed time within lease period
      const leaseStart = RANDFLAKE_EPOCH_OFFSET + 1;
      const leaseEnd = RANDFLAKE_EPOCH_OFFSET + 3600;

      const generator = new Generator(1, leaseStart, leaseEnd, secret);
      // @ts-expect-error accessing private field for testing
      generator.timeSource = () => now;
      
      const seen = new Set<bigint>();

      for (let i = 0; i < 1000; i++) {
        const id = generator.generate();
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    });

    it("throws error when time is before lease start", () => {
      const secret = new Uint8Array(16);
      const now = Math.floor(Date.now() / 1000);
      const generator = new Generator(1, now + 3600, now + 7200, secret);

      // @ts-expect-error accessing private field for testing
      generator.timeSource = () => now;

      expect(() => generator.generate()).toThrow(ErrInvalidLease);
    });

    it("throws error when time is after lease end", () => {
      const secret = new Uint8Array(16);
      const now = Math.floor(Date.now() / 1000);
      const generator = new Generator(1, now - 7200, now - 3600, secret);

      // @ts-expect-error accessing private field for testing
      generator.timeSource = () => now;

      expect(() => generator.generate()).toThrow(ErrInvalidLease);
    });
  });

  describe("inspect", () => {
    it("correctly inspects generated ID", () => {
      const secret = new Uint8Array(16);
      crypto.getRandomValues(secret);

      const timestamp = 1234528;
      const nodeID = 1;
      const sequence = 12345;
      const now = RANDFLAKE_EPOCH_OFFSET + timestamp;

      const generator = new Generator(
        nodeID,
        RANDFLAKE_EPOCH_OFFSET + 1,
        RANDFLAKE_EPOCH_OFFSET + timestamp + 3600,
        secret
      );

      // Set up the generator with fixed values
      // @ts-expect-error accessing private field for testing
      generator.sequence = sequence - 1;
      // @ts-expect-error accessing private field for testing
      generator.timeSource = () => now;

      // Generate an encrypted ID
      const id = generator.generate();
      
      // Inspect the encrypted ID
      const [timestamp2, nodeID2, sequence2] = generator.inspect(id);
      
      // Verify exact values
      expect(timestamp2).toBe(now);
      expect(nodeID2).toBe(nodeID);
      expect(sequence2).toBe(sequence);
    });

    it("compatible with go implementation", () => {
      // Use the exact same secret as Go test
      const secretStr = "dffd6021bb2bd5b0af676290809ec3a5";
      const secret = new Uint8Array(16);
      for (let i = 0; i < 16; i++) {
        secret[i] = parseInt(secretStr.slice(i * 2, i * 2 + 2), 16);
      }

      const now = Math.floor(Date.now() / 1000);
      const generator = new Generator(
        42,  // Use the expected nodeID
        now,
        now + 3600,
        secret
      );

      // The test ID from Go implementation
      const id = 4594531474933654033n;

      // Inspect the ID
      const [timestamp, nodeID, sequence] = generator.inspect(id);
      
      expect(timestamp).toBe(1733706297);
      expect(nodeID).toBe(42);
      expect(sequence).toBe(1);
    });
  });
});
