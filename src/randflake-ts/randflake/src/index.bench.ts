import { bench, describe } from 'vitest';
import { Generator as LegacyGenerator } from './index.js';
import {
  Generator,
  RANDFLAKE_EPOCH_OFFSET,
  RANDFLAKE_MAX_SEQUENCE,
  RANDFLAKE_MAX_TIMESTAMP,
} from './v2.js';

describe('Generator with an injected clock', () => {
  const secret = new Uint8Array(16);
  let modernCalls = 0;
  const generator = new Generator({
    lease: { nodeID: 1, start: RANDFLAKE_EPOCH_OFFSET, endExclusive: RANDFLAKE_MAX_TIMESTAMP + 1 },
    secret,
    clock: () => RANDFLAKE_EPOCH_OFFSET + Math.floor(modernCalls++ / (RANDFLAKE_MAX_SEQUENCE + 1)),
  });
  let legacyCalls = 0;
  const legacy = new LegacyGenerator(1, RANDFLAKE_EPOCH_OFFSET, RANDFLAKE_MAX_TIMESTAMP, secret);
  legacy.timeSource = () => RANDFLAKE_EPOCH_OFFSET + Math.floor(legacyCalls++ / (RANDFLAKE_MAX_SEQUENCE + 1));

  bench('v2 generate', () => {
    generator.generate();
  });

  bench('legacy generate', () => {
    legacy.generate();
  });
});
