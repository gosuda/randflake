import unittest
from .sparx64 import Sparx64, ErrInvalidKey, ErrInvalidBuffer


class TestSparx64(unittest.TestCase):
    def test_valid_operations(self):
        key = bytes(
            [
                0x00,
                0x11,
                0x22,
                0x33,
                0x44,
                0x55,
                0x66,
                0x77,
                0x88,
                0x99,
                0xAA,
                0xBB,
                0xCC,
                0xDD,
                0xEE,
                0xFF,
            ]
        )
        plaintext = bytes([0x01, 0x23, 0x45, 0x67, 0x89, 0xAB, 0xCD, 0xEF])
        expected_ciphertext = bytes([0x2B, 0xBE, 0xF1, 0x52, 0x01, 0xF5, 0x5F, 0x98])

        s = Sparx64(key)
        encrypted = bytearray(8)
        decrypted = bytearray(8)

        s.encrypt(encrypted, plaintext)
        self.assertEqual(bytes(encrypted), expected_ciphertext)

        s.decrypt(decrypted, encrypted)
        self.assertEqual(bytes(decrypted), plaintext)

    def test_invalid_key(self):
        # Test key with invalid length
        with self.assertRaises(ErrInvalidKey):
            Sparx64(bytes(15))  # Too short

        with self.assertRaises(ErrInvalidKey):
            Sparx64(bytes(17))  # Too long

    def test_invalid_buffer(self):
        key = bytes(
            [
                0x00,
                0x11,
                0x22,
                0x33,
                0x44,
                0x55,
                0x66,
                0x77,
                0x88,
                0x99,
                0xAA,
                0xBB,
                0xCC,
                0xDD,
                0xEE,
                0xFF,
            ]
        )
        s = Sparx64(key)

        # Test encryption with invalid source buffer
        with self.assertRaises(ErrInvalidBuffer):
            s.encrypt(bytearray(8), bytes(7))  # Source too short

        with self.assertRaises(ErrInvalidBuffer):
            s.encrypt(bytearray(7), bytes(8))  # Destination too short

        # Test decryption with invalid source buffer
        with self.assertRaises(ErrInvalidBuffer):
            s.decrypt(bytearray(8), bytes(7))  # Source too short

        with self.assertRaises(ErrInvalidBuffer):
            s.decrypt(bytearray(7), bytes(8))  # Destination too short

    def test_block_size(self):
        key = bytes(
            [
                0x00,
                0x11,
                0x22,
                0x33,
                0x44,
                0x55,
                0x66,
                0x77,
                0x88,
                0x99,
                0xAA,
                0xBB,
                0xCC,
                0xDD,
                0xEE,
                0xFF,
            ]
        )
        s = Sparx64(key)
        self.assertEqual(s.block_size(), 8)

    def test_destroy(self):
        key = bytes(
            [
                0x00,
                0x11,
                0x22,
                0x33,
                0x44,
                0x55,
                0x66,
                0x77,
                0x88,
                0x99,
                0xAA,
                0xBB,
                0xCC,
                0xDD,
                0xEE,
                0xFF,
            ]
        )
        s = Sparx64(key)
        s.destroy()
        # Verify all subkeys are zeroed
        for subkey in s.subkeys:
            for k in subkey:
                self.assertEqual(k, 0)


if __name__ == "__main__":
    unittest.main()
