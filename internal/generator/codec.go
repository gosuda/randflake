package generator

const alphabet = "0123456789abcdefghijklmnopqrstuv"

func Encode(id int64) string {
	num := uint64(id)
	if num == 0 {
		return "0"
	}
	var encoded [13]byte
	index := len(encoded)
	for num > 0 {
		index--
		encoded[index] = alphabet[num&31]
		num >>= 5
	}
	return string(encoded[index:])
}

// Decode accepts exactly the canonical spelling emitted by Encode.
func Decode(s string) (int64, error) {
	if len(s) == 0 || len(s) > 13 {
		return 0, ErrInvalidID
	}
	if len(s) > 1 && s[0] == '0' {
		return 0, ErrInvalidID
	}
	var num uint64
	for i := range len(s) {
		c := s[i]
		var digit uint64
		if c >= '0' && c <= '9' {
			digit = uint64(c - '0')
		} else if c >= 'a' && c <= 'v' {
			digit = uint64(c - 'a' + 10)
		} else {
			return 0, ErrInvalidID
		}
		if num > ^uint64(0)>>5 {
			return 0, ErrInvalidID
		}
		num = num<<5 | digit
	}
	return int64(num), nil
}

// DecodeLegacy retains case folding, padding termination and modulo-64 overflow.
func DecodeLegacy(s string) (int64, error) {
	var num uint64
	for i := range len(s) {
		c := s[i]
		if c == '=' {
			break
		}
		var digit uint64
		if c >= '0' && c <= '9' {
			digit = uint64(c - '0')
		} else if c >= 'a' && c <= 'v' {
			digit = uint64(c - 'a' + 10)
		} else if c >= 'A' && c <= 'V' {
			digit = uint64(c - 'A' + 10)
		} else {
			return 0, ErrInvalidID
		}
		num = num<<5 | digit
	}
	return int64(num), nil
}
