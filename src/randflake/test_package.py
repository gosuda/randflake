import unittest

from . import Generator, RandflakeError, RANDFLAKE_EPOCH_OFFSET
from . import v2


class TestPackageImports(unittest.TestCase):
    def test_old_and_versioned_imports_share_the_wire_format(self):
        now = RANDFLAKE_EPOCH_OFFSET
        legacy = Generator(0, now, now, bytes(16))
        legacy.time_source = lambda: now
        versioned = v2.Generator(v2.Config(v2.Lease(0, now, now + 1), bytes(16), lambda: now))
        self.assertEqual(legacy.generate_string(), versioned.generate_string())

    def test_root_error_base_catches_versioned_validation(self):
        with self.assertRaises(RandflakeError):
            v2.decode_string("not-an-id")
        with self.assertRaises(RandflakeError):
            Generator(0, RANDFLAKE_EPOCH_OFFSET, RANDFLAKE_EPOCH_OFFSET, bytes(15))


if __name__ == "__main__":
    unittest.main()
