package sparx64

import (
	"bytes"
	"testing"
)

func TestSparx64(t *testing.T) {
	key := []byte{0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff}
	plaintext := []byte{0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef}
	expectedCiphertext := []byte{0x2b, 0xbe, 0xf1, 0x52, 0x01, 0xf5, 0x5f, 0x98}

	s := NewSparx64(key)

	var encrypted [8]byte
	var decrypted [8]byte

	s.Encrypt(encrypted[:], plaintext)
	if !bytes.Equal(encrypted[:], expectedCiphertext) {
		t.Errorf("Encryption failed. Expected %x, got %x", expectedCiphertext, encrypted)
	}

	s.Decrypt(decrypted[:], encrypted[:])
	if !bytes.Equal(decrypted[:], plaintext) {
		t.Errorf("Decryption failed. Expected %x, got %x", plaintext, decrypted)
	}
}
