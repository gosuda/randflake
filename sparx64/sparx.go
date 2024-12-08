package sparx64

import "crypto/cipher"

// Constants based on VERSION
const (
	_N_STEPS          = 8
	_ROUNDS_PER_STEPS = 3
	_N_BRANCHES       = 2
	_K_SIZE           = 4
)

func rotl(x uint16, n uint) uint16 {
	return (x << n) | (x >> (16 - n))
}

// _A performs one keyless round of SPECK-32
func _A(l, r *uint16) {
	*l = rotl(*l, 9)
	*l += *r
	*r = rotl(*r, 2)
	*r ^= *l
}

// _A_inv is the inverse of A
func _A_inv(l, r *uint16) {
	*r ^= *l
	*r = rotl(*r, 14)
	*l -= *r
	*l = rotl(*l, 7)
}

// _L_2 is the linear layer for SPARX-64/128
func _L_2(x *[2 * _N_BRANCHES]uint16) {
	tmp := rotl(x[0]^x[1], 8)
	x[2] ^= x[0] ^ tmp
	x[3] ^= x[1] ^ tmp
	x[0], x[2] = x[2], x[0]
	x[1], x[3] = x[3], x[1]
}

// _L_2_inv is the inverse of L_2
func _L_2_inv(x *[2 * _N_BRANCHES]uint16) {
	x[0], x[2] = x[2], x[0]
	x[1], x[3] = x[3], x[1]
	tmp := rotl(x[0]^x[1], 8)
	x[2] ^= x[0] ^ tmp
	x[3] ^= x[1] ^ tmp
}

// _K_perm_64_128 is the key permutation for SPARX-64/128
func _K_perm_64_128(k *[2 * _K_SIZE]uint16, c uint16) {
	_A(&k[0], &k[1])
	k[2] += k[0]
	k[3] += k[1]
	k[7] += c
	tmp0, tmp1 := k[6], k[7]
	for i := 7; i >= 2; i-- {
		k[i] = k[i-2]
	}
	k[0], k[1] = tmp0, tmp1
}

// key_schedule generates the subkeys
//
//go:nosplit
func key_schedule(subkeys *[_N_BRANCHES*_N_STEPS + 1][2 * _ROUNDS_PER_STEPS]uint16, masterKey *[2 * _K_SIZE]uint16) {
	for c := 0; c < _N_BRANCHES*_N_STEPS+1; c++ {
		copy(subkeys[c][:], masterKey[:2*_ROUNDS_PER_STEPS])
		_K_perm_64_128(masterKey, uint16(c+1))
	}
}

// sparx_encrypt encrypts the input
func sparx_encrypt(x *[2 * _N_BRANCHES]uint16, k *[_N_BRANCHES*_N_STEPS + 1][2 * _ROUNDS_PER_STEPS]uint16) {
	for s := 0; s < _N_STEPS; s++ {
		for b := 0; b < _N_BRANCHES; b++ {
			for r := 0; r < _ROUNDS_PER_STEPS; r++ {
				x[2*b] ^= k[_N_BRANCHES*s+b][2*r]
				x[2*b+1] ^= k[_N_BRANCHES*s+b][2*r+1]
				_A(&x[2*b], &x[2*b+1])
			}
		}
		_L_2(x)
	}
	for b := 0; b < _N_BRANCHES; b++ {
		x[2*b] ^= k[_N_BRANCHES*_N_STEPS][2*b]
		x[2*b+1] ^= k[_N_BRANCHES*_N_STEPS][2*b+1]
	}
}

// sparx_decrypt decrypts the input
func sparx_decrypt(x *[2 * _N_BRANCHES]uint16, k *[_N_BRANCHES*_N_STEPS + 1][2 * _ROUNDS_PER_STEPS]uint16) {
	for b := 0; b < _N_BRANCHES; b++ {
		x[2*b] ^= k[_N_BRANCHES*_N_STEPS][2*b]
		x[2*b+1] ^= k[_N_BRANCHES*_N_STEPS][2*b+1]
	}
	for s := _N_STEPS - 1; s >= 0; s-- {
		_L_2_inv(x)
		for b := 0; b < _N_BRANCHES; b++ {
			for r := _ROUNDS_PER_STEPS - 1; r >= 0; r-- {
				_A_inv(&x[2*b], &x[2*b+1])
				x[2*b] ^= k[_N_BRANCHES*s+b][2*r]
				x[2*b+1] ^= k[_N_BRANCHES*s+b][2*r+1]
			}
		}
	}
}

type Sparx64 struct {
	subkeys [_N_BRANCHES*_N_STEPS + 1][2 * _ROUNDS_PER_STEPS]uint16
}

func NewSparx64(key []byte) *Sparx64 {
	if len(key) != 16 {
		panic("sparx64: key must be 16 bytes (128 bits)")
	}

	var _key [2 * _K_SIZE]uint16
	var s Sparx64

	_ = _key[7]
	_ = key[15]
	_key[0] = uint16(key[0])<<8 | uint16(key[1])
	_key[1] = uint16(key[2])<<8 | uint16(key[3])
	_key[2] = uint16(key[4])<<8 | uint16(key[5])
	_key[3] = uint16(key[6])<<8 | uint16(key[7])
	_key[4] = uint16(key[8])<<8 | uint16(key[9])
	_key[5] = uint16(key[10])<<8 | uint16(key[11])
	_key[6] = uint16(key[12])<<8 | uint16(key[13])
	_key[7] = uint16(key[14])<<8 | uint16(key[15])

	key_schedule(&s.subkeys, &_key)
	for i := range _key {
		_key[i] = 0
	}

	return &s
}

func (s *Sparx64) Encrypt(dst, src []byte) {
	if len(src) != 8 && len(dst) >= 8 {
		panic("sparx64: src must be 8 bytes (64 bits)")
	}
	_ = src[7]
	_ = dst[7]

	var x [2 * _N_BRANCHES]uint16
	x[0] = uint16(src[0])<<8 | uint16(src[1])
	x[1] = uint16(src[2])<<8 | uint16(src[3])
	x[2] = uint16(src[4])<<8 | uint16(src[5])
	x[3] = uint16(src[6])<<8 | uint16(src[7])

	sparx_encrypt(&x, &s.subkeys)

	dst[0] = byte(x[0] >> 8)
	dst[1] = byte(x[0])
	dst[2] = byte(x[1] >> 8)
	dst[3] = byte(x[1])
	dst[4] = byte(x[2] >> 8)
	dst[5] = byte(x[2])
	dst[6] = byte(x[3] >> 8)
	dst[7] = byte(x[3])
}

func (s *Sparx64) Decrypt(dst, src []byte) {
	if len(src) != 8 && len(dst) >= 8 {
		panic("sparx64: src must be 8 bytes (64 bits)")
	}
	_ = src[7]
	_ = dst[7]

	var x [2 * _N_BRANCHES]uint16
	x[0] = uint16(src[0])<<8 | uint16(src[1])
	x[1] = uint16(src[2])<<8 | uint16(src[3])
	x[2] = uint16(src[4])<<8 | uint16(src[5])
	x[3] = uint16(src[6])<<8 | uint16(src[7])

	sparx_decrypt(&x, &s.subkeys)

	dst[0] = byte(x[0] >> 8)
	dst[1] = byte(x[0])
	dst[2] = byte(x[1] >> 8)
	dst[3] = byte(x[1])
	dst[4] = byte(x[2] >> 8)
	dst[5] = byte(x[2])
	dst[6] = byte(x[3] >> 8)
	dst[7] = byte(x[3])
}

func (s *Sparx64) BlockSize() int {
	return 8
}

func (s *Sparx64) Destroy() {
	for i := range s.subkeys {
		for j := range s.subkeys[i] {
			s.subkeys[i][j] = 0
		}
	}
}

var _ cipher.Block = (*Sparx64)(nil)
