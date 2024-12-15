import unittest
import time
import os
from .randflake import (
    Generator,
    RANDFLAKE_EPOCH_OFFSET,
    RANDFLAKE_MAX_TIMESTAMP,
    RANDFLAKE_MAX_NODE,
    ErrRandflakeDead,
    ErrInvalidSecret,
    ErrInvalidLease,
    ErrInvalidNode,
)


class TestRandflake(unittest.TestCase):
    def test_new_generator(self):
        test_cases = [
            {
                "name": "valid generator",
                "node_id": 1,
                "lease_start": RANDFLAKE_EPOCH_OFFSET + 1,
                "lease_end": RANDFLAKE_EPOCH_OFFSET + 3600,
                "secret": bytes(16),
                "want_error": None,
            },
            {
                "name": "invalid node ID - negative",
                "node_id": -1,
                "lease_start": RANDFLAKE_EPOCH_OFFSET + 1,
                "lease_end": RANDFLAKE_EPOCH_OFFSET + 3600,
                "secret": bytes(16),
                "want_error": ErrInvalidNode,
            },
            {
                "name": "invalid node ID - too large",
                "node_id": RANDFLAKE_MAX_NODE + 1,
                "lease_start": RANDFLAKE_EPOCH_OFFSET + 1,
                "lease_end": RANDFLAKE_EPOCH_OFFSET + 3600,
                "secret": bytes(16),
                "want_error": ErrInvalidNode,
            },
            {
                "name": "invalid lease - end before start",
                "node_id": 1,
                "lease_start": RANDFLAKE_EPOCH_OFFSET + 3600,
                "lease_end": RANDFLAKE_EPOCH_OFFSET + 1,
                "secret": bytes(16),
                "want_error": ErrInvalidLease,
            },
            {
                "name": "invalid lease - end after max timestamp",
                "node_id": 1,
                "lease_start": RANDFLAKE_EPOCH_OFFSET + 1,
                "lease_end": RANDFLAKE_MAX_TIMESTAMP + 1,
                "secret": bytes(16),
                "want_error": ErrRandflakeDead,
            },
            {
                "name": "invalid secret length",
                "node_id": 1,
                "lease_start": RANDFLAKE_EPOCH_OFFSET + 1,
                "lease_end": RANDFLAKE_EPOCH_OFFSET + 3600,
                "secret": bytes(15),
                "want_error": ErrInvalidSecret,
            },
        ]

        for tc in test_cases:
            with self.subTest(name=tc["name"]):
                if tc["want_error"] is None:
                    try:
                        Generator(
                            tc["node_id"],
                            tc["lease_start"],
                            tc["lease_end"],
                            tc["secret"],
                        )
                    except Exception as e:
                        self.fail(f"Unexpected error: {e}")
                else:
                    with self.assertRaises(tc["want_error"]):
                        Generator(
                            tc["node_id"],
                            tc["lease_start"],
                            tc["lease_end"],
                            tc["secret"],
                        )

    def test_update_lease(self):
        secret = bytes(16)
        lease_start = RANDFLAKE_EPOCH_OFFSET + 1
        lease_end = RANDFLAKE_EPOCH_OFFSET + 3600

        g = Generator(1, lease_start, lease_end, secret)

        test_cases = [
            {
                "name": "valid update",
                "lease_start": lease_start,
                "lease_end": lease_end + 3600,
                "want": True,
            },
            {
                "name": "invalid start time",
                "lease_start": lease_start + 1,
                "lease_end": lease_end + 7200,
                "want": False,
            },
            {
                "name": "end before start",
                "lease_start": lease_start,
                "lease_end": lease_start - 1,
                "want": False,
            },
            {
                "name": "end after max timestamp",
                "lease_start": lease_start,
                "lease_end": RANDFLAKE_MAX_TIMESTAMP + 1,
                "want": False,
            },
        ]

        for tc in test_cases:
            with self.subTest(name=tc["name"]):
                result = g.update_lease(tc["lease_start"], tc["lease_end"])
                self.assertEqual(result, tc["want"])

    def test_generate_unique(self):
        secret = bytes(16)
        now = RANDFLAKE_EPOCH_OFFSET + 1000  # Fixed time within lease period
        lease_start = RANDFLAKE_EPOCH_OFFSET + 1
        lease_end = RANDFLAKE_EPOCH_OFFSET + 3600

        g = Generator(1, lease_start, lease_end, secret)
        g.time_source = lambda: now  # Use fixed time source

        # Test ID generation and uniqueness
        seen = set()
        for _ in range(1000):
            id_val = g.generate()
            self.assertNotIn(id_val, seen, "Generated duplicate ID")
            seen.add(id_val)

    def test_generate_errors(self):
        secret = bytes(16)
        now = RANDFLAKE_EPOCH_OFFSET + 1000

        test_cases = [
            {
                "name": "time before lease start",
                "node_id": 1,
                "lease_start": now + 3600,
                "lease_end": now + 7200,
                "time_source": lambda: now,
                "want_error": ErrInvalidLease,
            },
            {
                "name": "time after lease end",
                "node_id": 1,
                "lease_start": now - 7200,
                "lease_end": now - 3600,
                "time_source": lambda: now,
                "want_error": ErrInvalidLease,
            },
        ]

        for tc in test_cases:
            with self.subTest(name=tc["name"]):
                g = Generator(tc["node_id"], tc["lease_start"], tc["lease_end"], secret)
                g.time_source = tc["time_source"]
                with self.assertRaises(tc["want_error"]):
                    g.generate()

    def test_inspect(self):
        secret = os.urandom(16)
        timestamp = 1234528
        node_id = 1
        counter = 12345
        now = RANDFLAKE_EPOCH_OFFSET + timestamp

        g = Generator(
            node_id,
            RANDFLAKE_EPOCH_OFFSET + 1,
            RANDFLAKE_EPOCH_OFFSET + timestamp + 3600,
            secret,
        )

        # Generate an ID
        g.sequence = counter - 1  # Set sequence to generate expected counter
        g.time_source = lambda: now
        id_val = g.generate()

        # Inspect the generated ID
        timestamp2, node_id2, counter2 = g.inspect(id_val)

        self.assertEqual(timestamp2, now)
        self.assertEqual(node_id2, node_id)
        self.assertEqual(counter2, counter)

        secret = "dffd6021bb2bd5b0af676290809ec3a5"
        secret_bytes = bytes.fromhex(secret)
        g = Generator(1, time.time(), time.time() + 3600, secret_bytes)

        _id = 4594531474933654033
        timestamp, node_id, counter = g.inspect(_id)
        self.assertEqual(timestamp, 1733706297)
        self.assertEqual(node_id, 42)
        self.assertEqual(counter, 1)

        _id_str = "3vgoe12ccb8gh"
        timestamp, node_id, counter = g.inspect_string(_id_str)
        self.assertEqual(timestamp, 1733706297)
        self.assertEqual(node_id, 42)
        self.assertEqual(counter, 1)


if __name__ == "__main__":
    unittest.main()
