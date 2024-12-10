// Constants based on VERSION
const N_STEPS = 8;
const ROUNDS_PER_STEPS = 3;
const N_BRANCHES = 2;
const K_SIZE = 4;

function rotl(x: number, n: number): number {
  return ((x << n) | (x >> (16 - n))) & 0xFFFF;
}

function A(l: number, r: number): [number, number] {
  l = rotl(l, 9);
  l = (l + r) & 0xFFFF;
  r = rotl(r, 2);
  r ^= l;
  return [l, r];
}

function A_inv(l: number, r: number): [number, number] {
  r ^= l;
  r = rotl(r, 14);
  l = (l - r) & 0xFFFF;
  l = rotl(l, 7);
  return [l, r];
}

function L_2(x: number[]): void {
  const tmp = rotl(x[0] ^ x[1], 8);
  x[2] ^= x[0] ^ tmp;
  x[3] ^= x[1] ^ tmp;
  [x[0], x[2]] = [x[2], x[0]];
  [x[1], x[3]] = [x[3], x[1]];
}

function L_2_inv(x: number[]): void {
  [x[0], x[2]] = [x[2], x[0]];
  [x[1], x[3]] = [x[3], x[1]];
  const tmp = rotl(x[0] ^ x[1], 8);
  x[2] ^= x[0] ^ tmp;
  x[3] ^= x[1] ^ tmp;
}

function K_perm_64_128(k: number[], c: number): void {
  [k[0], k[1]] = A(k[0], k[1]);
  k[2] = (k[2] + k[0]) & 0xFFFF;
  k[3] = (k[3] + k[1]) & 0xFFFF;
  k[7] = (k[7] + c) & 0xFFFF;
  const [tmp0, tmp1] = [k[6], k[7]];
  for (let i = 7; i >= 2; i--) {
    k[i] = k[i - 2];
  }
  k[0] = tmp0;
  k[1] = tmp1;
}

function key_schedule(masterKey: number[]): number[][] {
  const subkeys: number[][] = Array.from({ length: N_BRANCHES * N_STEPS + 1 }, 
    () => new Array(2 * ROUNDS_PER_STEPS).fill(0)
  );

  for (let c = 0; c < N_BRANCHES * N_STEPS + 1; c++) {
    subkeys[c].splice(0, 2 * ROUNDS_PER_STEPS, ...masterKey.slice(0, 2 * ROUNDS_PER_STEPS));
    K_perm_64_128(masterKey, c + 1);
  }

  return subkeys;
}

function sparx_encrypt(x: number[], k: number[][]): void {
  for (let s = 0; s < N_STEPS; s++) {
    for (let b = 0; b < N_BRANCHES; b++) {
      for (let r = 0; r < ROUNDS_PER_STEPS; r++) {
        x[2 * b] ^= k[N_BRANCHES * s + b][2 * r];
        x[2 * b + 1] ^= k[N_BRANCHES * s + b][2 * r + 1];
        [x[2 * b], x[2 * b + 1]] = A(x[2 * b], x[2 * b + 1]);
      }
    }
    L_2(x);
  }
  for (let b = 0; b < N_BRANCHES; b++) {
    x[2 * b] ^= k[N_BRANCHES * N_STEPS][2 * b];
    x[2 * b + 1] ^= k[N_BRANCHES * N_STEPS][2 * b + 1];
  }
}

function sparx_decrypt(x: number[], k: number[][]): void {
  for (let b = 0; b < N_BRANCHES; b++) {
    x[2 * b] ^= k[N_BRANCHES * N_STEPS][2 * b];
    x[2 * b + 1] ^= k[N_BRANCHES * N_STEPS][2 * b + 1];
  }
  for (let s = N_STEPS - 1; s >= 0; s--) {
    L_2_inv(x);
    for (let b = 0; b < N_BRANCHES; b++) {
      for (let r = ROUNDS_PER_STEPS - 1; r >= 0; r--) {
        [x[2 * b], x[2 * b + 1]] = A_inv(x[2 * b], x[2 * b + 1]);
        x[2 * b] ^= k[N_BRANCHES * s + b][2 * r];
        x[2 * b + 1] ^= k[N_BRANCHES * s + b][2 * r + 1];
      }
    }
  }
}

export class Sparx64 {
  private subkeys: number[][];

  constructor(key: Uint8Array) {
    if (key.length !== 16) {
      throw new Error("sparx64: key must be 16 bytes (128 bits)");
    }

    const _key = new Array(2 * K_SIZE).fill(0);
    for (let i = 0; i < 8; i++) {
      _key[i] = (key[i * 2] << 8) | key[i * 2 + 1];
    }

    this.subkeys = key_schedule(_key);
    _key.fill(0);
  }

  encrypt(dst: Uint8Array, src: Uint8Array): void {
    if (src.length !== 8 || dst.length < 8) {
      throw new Error("sparx64: src must be 8 bytes (64 bits)");
    }

    const x = new Array(2 * N_BRANCHES).fill(0);
    for (let i = 0; i < 4; i++) {
      x[i] = (src[i * 2] << 8) | src[i * 2 + 1];
    }

    sparx_encrypt(x, this.subkeys);

    for (let i = 0; i < 4; i++) {
      dst[i * 2] = x[i] >> 8;
      dst[i * 2 + 1] = x[i] & 0xFF;
    }
  }

  decrypt(dst: Uint8Array, src: Uint8Array): void {
    if (src.length !== 8 || dst.length < 8) {
      throw new Error("sparx64: src must be 8 bytes (64 bits)");
    }

    const x = new Array(2 * N_BRANCHES).fill(0);
    for (let i = 0; i < 4; i++) {
      x[i] = (src[i * 2] << 8) | src[i * 2 + 1];
    }

    sparx_decrypt(x, this.subkeys);

    for (let i = 0; i < 4; i++) {
      dst[i * 2] = x[i] >> 8;
      dst[i * 2 + 1] = x[i] & 0xFF;
    }
  }

  blockSize(): number {
    return 8;
  }

  destroy(): void {
    for (const subkey of this.subkeys) {
      subkey.fill(0);
    }
  }
}
