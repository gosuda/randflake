import { bench, describe } from "vitest";
import { Generator } from "./index";

describe("Generator Benchmarks", () => {
  // Pre-initialize generators for pure generation benchmarks
  const secret = new Uint8Array(16);
  crypto.getRandomValues(secret);
  const now = Math.floor(Date.now() / 1000);

  // Pre-create 32 generators for cascade benchmark
  const cascadeGenerators: Generator[] = Array.from(
    { length: 32 },
    (_, i) => new Generator(i + 1, now - 3600, now + 3600, secret)
  );

  // Pre-create generators for high throughput benchmark
  const throughputGenerators: Generator[] = Array.from(
    { length: 8 },
    (_, i) => new Generator(i + 1, now - 3600, now + 3600, secret)
  );

  let cursor = 0;

  bench("generate - 32 generators cascade", () => {
    try {
      cascadeGenerators[cursor].generate();
    } catch (err) {
      cursor = (cursor + 1) % 32;
      cascadeGenerators[cursor].generate();
    }
  });
});
