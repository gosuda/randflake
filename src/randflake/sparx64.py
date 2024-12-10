_N_STEPS = 8
_ROUNDS_PER_STEPS = 3
_N_BRANCHES = 2
_K_SIZE = 4


# Custom error classes
class SparxError(Exception):
    """Base class for sparx64 errors"""

    pass


class ErrInvalidKey(SparxError):
    def __init__(self):
        super().__init__("sparx64: key must be 16 bytes (128 bits)")


class ErrInvalidBuffer(SparxError):
    def __init__(self):
        super().__init__("sparx64: src must be 8 bytes (64 bits)")


def _rotl(x, n):
    return ((x << n) | (x >> (16 - n))) & 0xFFFF


def _A(l, r):
    l = _rotl(l, 9)
    l = (l + r) & 0xFFFF
    r = _rotl(r, 2)
    r ^= l
    return l, r


def _A_inv(l, r):
    r ^= l
    r = _rotl(r, 14)
    l = (l - r) & 0xFFFF
    l = _rotl(l, 7)
    return l, r


def _L_2(x):
    tmp = _rotl(x[0] ^ x[1], 8)
    x[2] ^= x[0] ^ tmp
    x[3] ^= x[1] ^ tmp
    x[0], x[2] = x[2], x[0]
    x[1], x[3] = x[3], x[1]


def _L_2_inv(x):
    x[0], x[2] = x[2], x[0]
    x[1], x[3] = x[3], x[1]
    tmp = _rotl(x[0] ^ x[1], 8)
    x[2] ^= x[0] ^ tmp
    x[3] ^= x[1] ^ tmp


def _K_perm_64_128(k, c):
    k[0], k[1] = _A(k[0], k[1])
    k[2] = (k[2] + k[0]) & 0xFFFF
    k[3] = (k[3] + k[1]) & 0xFFFF
    k[7] = (k[7] + c) & 0xFFFF
    tmp0, tmp1 = k[6], k[7]
    for i in range(7, 1, -1):
        k[i] = k[i - 2]
    k[0], k[1] = tmp0, tmp1


def _key_schedule(master_key):
    subkeys = [
        [0 for _ in range(2 * _ROUNDS_PER_STEPS)]
        for _ in range(_N_BRANCHES * _N_STEPS + 1)
    ]
    for c in range(_N_BRANCHES * _N_STEPS + 1):
        subkeys[c][: 2 * _ROUNDS_PER_STEPS] = master_key[: 2 * _ROUNDS_PER_STEPS]
        _K_perm_64_128(master_key, c + 1)
    return subkeys


def _sparx_encrypt(x, k):
    for s in range(_N_STEPS):
        for b in range(_N_BRANCHES):
            for r in range(_ROUNDS_PER_STEPS):
                x[2 * b] ^= k[_N_BRANCHES * s + b][2 * r]
                x[2 * b + 1] ^= k[_N_BRANCHES * s + b][2 * r + 1]
                x[2 * b], x[2 * b + 1] = _A(x[2 * b], x[2 * b + 1])
        _L_2(x)
    for b in range(_N_BRANCHES):
        x[2 * b] ^= k[_N_BRANCHES * _N_STEPS][2 * b]
        x[2 * b + 1] ^= k[_N_BRANCHES * _N_STEPS][2 * b + 1]


def _sparx_decrypt(x, k):
    for b in range(_N_BRANCHES):
        x[2 * b] ^= k[_N_BRANCHES * _N_STEPS][2 * b]
        x[2 * b + 1] ^= k[_N_BRANCHES * _N_STEPS][2 * b + 1]
    for s in range(_N_STEPS - 1, -1, -1):
        _L_2_inv(x)
        for b in range(_N_BRANCHES):
            for r in range(_ROUNDS_PER_STEPS - 1, -1, -1):
                x[2 * b], x[2 * b + 1] = _A_inv(x[2 * b], x[2 * b + 1])
                x[2 * b] ^= k[_N_BRANCHES * s + b][2 * r]
                x[2 * b + 1] ^= k[_N_BRANCHES * s + b][2 * r + 1]


class Sparx64:
    def __init__(self, key):
        if len(key) != 16:
            raise ErrInvalidKey()

        _key = [0] * (2 * _K_SIZE)
        _key[0] = (key[0] << 8) | key[1]
        _key[1] = (key[2] << 8) | key[3]
        _key[2] = (key[4] << 8) | key[5]
        _key[3] = (key[6] << 8) | key[7]
        _key[4] = (key[8] << 8) | key[9]
        _key[5] = (key[10] << 8) | key[11]
        _key[6] = (key[12] << 8) | key[13]
        _key[7] = (key[14] << 8) | key[15]

        self.subkeys = _key_schedule(_key)
        for i in range(len(_key)):
            _key[i] = 0

    def encrypt(self, dst, src):
        if len(src) != 8 or len(dst) < 8:
            raise ErrInvalidBuffer()

        x = [0] * (2 * _N_BRANCHES)
        x[0] = (src[0] << 8) | src[1]
        x[1] = (src[2] << 8) | src[3]
        x[2] = (src[4] << 8) | src[5]
        x[3] = (src[6] << 8) | src[7]

        _sparx_encrypt(x, self.subkeys)

        dst[0] = x[0] >> 8
        dst[1] = x[0] & 0xFF
        dst[2] = x[1] >> 8
        dst[3] = x[1] & 0xFF
        dst[4] = x[2] >> 8
        dst[5] = x[2] & 0xFF
        dst[6] = x[3] >> 8
        dst[7] = x[3] & 0xFF

    def decrypt(self, dst, src):
        if len(src) != 8 or len(dst) < 8:
            raise ErrInvalidBuffer()

        x = [0] * (2 * _N_BRANCHES)
        x[0] = (src[0] << 8) | src[1]
        x[1] = (src[2] << 8) | src[3]
        x[2] = (src[4] << 8) | src[5]
        x[3] = (src[6] << 8) | src[7]

        _sparx_decrypt(x, self.subkeys)

        dst[0] = x[0] >> 8
        dst[1] = x[0] & 0xFF
        dst[2] = x[1] >> 8
        dst[3] = x[1] & 0xFF
        dst[4] = x[2] >> 8
        dst[5] = x[2] & 0xFF
        dst[6] = x[3] >> 8
        dst[7] = x[3] & 0xFF

    def block_size(self):
        return 8

    def destroy(self):
        for i in range(len(self.subkeys)):
            for j in range(len(self.subkeys[i])):
                self.subkeys[i][j] = 0
