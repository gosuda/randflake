import unittest
from . import (
    Generator,
    Sparx64,
    ErrInvalidKey,
    ErrInvalidSecret,
    RANDFLAKE_EPOCH_OFFSET,
)


class TestPackageImports(unittest.TestCase):
    def test_imports(self):
        # Test that we can create instances of the main classes
        key = bytes([0] * 16)
        sparx = Sparx64(key)
        self.assertEqual(sparx.block_size(), 8)

        generator = Generator(
            1, RANDFLAKE_EPOCH_OFFSET + 1, RANDFLAKE_EPOCH_OFFSET + 3600, key
        )
        self.assertIsNotNone(generator)

        # Test that error classes are properly imported
        with self.assertRaises(ErrInvalidKey):
            Sparx64(bytes([0] * 15))  # Wrong key size

        with self.assertRaises(ErrInvalidSecret):
            Generator(
                1,
                RANDFLAKE_EPOCH_OFFSET + 1,
                RANDFLAKE_EPOCH_OFFSET + 3600,
                bytes([0] * 15),
            )


if __name__ == "__main__":
    unittest.main()
