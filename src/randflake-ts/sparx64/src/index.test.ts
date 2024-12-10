import { describe, it, expect } from 'vitest';
import { Sparx64 } from './index';

describe('Sparx64', () => {
  it('should correctly encrypt and decrypt data', () => {
    const key = new Uint8Array([
      0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77,
      0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff
    ]);
    const plaintext = new Uint8Array([
      0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef
    ]);
    const expectedCiphertext = new Uint8Array([
      0x2b, 0xbe, 0xf1, 0x52, 0x01, 0xf5, 0x5f, 0x98
    ]);

    const s = new Sparx64(key);

    const encrypted = new Uint8Array(8);
    const decrypted = new Uint8Array(8);

    s.encrypt(encrypted, plaintext);
    expect(encrypted).toEqual(expectedCiphertext);

    s.decrypt(decrypted, encrypted);
    expect(decrypted).toEqual(plaintext);
  });

  it('should throw error for invalid key size', () => {
    const invalidKey = new Uint8Array([0x00, 0x11]); // Too short
    expect(() => new Sparx64(invalidKey)).toThrow('sparx64: key must be 16 bytes (128 bits)');
  });

  it('should throw error for invalid buffer size', () => {
    const key = new Uint8Array(16).fill(0);
    const s = new Sparx64(key);
    const invalidBuffer = new Uint8Array([0x00, 0x11]); // Too short
    const dst = new Uint8Array(8);

    expect(() => s.encrypt(dst, invalidBuffer)).toThrow('sparx64: src must be 8 bytes (64 bits)');
    expect(() => s.decrypt(dst, invalidBuffer)).toThrow('sparx64: src must be 8 bytes (64 bits)');
  });

  it('should have correct block size', () => {
    const key = new Uint8Array(16).fill(0);
    const s = new Sparx64(key);
    expect(s.blockSize()).toBe(8);
  });

  it('should properly destroy key material', () => {
    const key = new Uint8Array(16).fill(0xff);
    const s = new Sparx64(key);
    s.destroy();
    // Check that subkeys are zeroed
    // @ts-expect-error accessing private field for testing
    expect(s.subkeys.every(subkey => subkey.every(val => val === 0))).toBe(true);
  });
});
