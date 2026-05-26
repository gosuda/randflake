import json
from pathlib import Path
import unittest
import os
from .randflake import (
    Generator,
    RANDFLAKE_EPOCH_OFFSET,
    RANDFLAKE_MAX_TIMESTAMP,
    RANDFLAKE_MAX_NODE,
    RANDFLAKE_MAX_SEQUENCE,
    ErrRandflakeDead,
    ErrInvalidSecret,
    ErrInvalidLease,
    ErrInvalidNode,
    _decodeB32hex,
)


TEST_VECTOR_PATH = Path(__file__).resolve().parents[2] / "test_vectors.json"


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
                "name": "invalid lease - start before epoch",
                "node_id": 1,
                "lease_start": RANDFLAKE_EPOCH_OFFSET - 1,
                "lease_end": RANDFLAKE_EPOCH_OFFSET + 3600,
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
                "lease_start": RANDFLAKE_EPOCH_OFFSET + 1,
                "lease_end": now - 1,
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
        g = Generator(1, 1730000000, 1735000000, secret_bytes)

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

    def test_cross_language_test_vectors(self):
        with TEST_VECTOR_PATH.open(encoding="utf-8") as f:
            vectors = json.load(f)

        self.assertGreaterEqual(len(vectors), 10)

        for vector in vectors:
            with self.subTest(
                secret=vector["secret"],
                timestamp=vector["timestamp"],
                node_id=vector["node_id"],
                sequence=vector["sequence"],
            ):
                secret = bytes.fromhex(vector["secret"])
                encrypted_id = int(vector["encrypted_id"])

                generator = Generator(
                    vector["node_id"],
                    vector["lease_start"],
                    vector["lease_end"],
                    secret,
                )

                timestamp, node_id, sequence = generator.inspect(encrypted_id)
                self.assertEqual(timestamp, vector["timestamp"])
                self.assertEqual(node_id, vector["node_id"])
                self.assertEqual(sequence, vector["sequence"])

                decoded_id = _decodeB32hex(vector["encoded_id"])
                self.assertEqual(decoded_id, encrypted_id)

                timestamp, node_id, sequence = generator.inspect_string(
                    vector["encoded_id"]
                )
                self.assertEqual(timestamp, vector["timestamp"])
                self.assertEqual(node_id, vector["node_id"])
                self.assertEqual(sequence, vector["sequence"])

                raw_id = (
                    (
                        vector["timestamp"] - RANDFLAKE_EPOCH_OFFSET
                    )
                    << (17 + 17)
                ) | (vector["node_id"] << 17) | vector["sequence"]
                self.assertEqual(str(raw_id), vector["raw_id"])

                generated = self._generate_vector_id(vector, secret)
                self.assertEqual(generated, encrypted_id)

                generated_string = self._generate_vector_string(vector, secret)
                self.assertEqual(generated_string, vector["encoded_id"])

    def _generate_vector_id(self, vector, secret):
        generator = self._generator_at_vector_state(vector, secret)
        return generator.generate()

    def _generate_vector_string(self, vector, secret):
        generator = self._generator_at_vector_state(vector, secret)
        return generator.generate_string()

    def _generator_at_vector_state(self, vector, secret):
        generator = Generator(
            vector["node_id"],
            vector["lease_start"],
            vector["lease_end"],
            secret,
        )
        if vector["sequence"] == 0:
            generator.sequence = RANDFLAKE_MAX_SEQUENCE
            generator.rollover = vector["timestamp"] - 1
        else:
            generator.sequence = vector["sequence"] - 1
            generator.rollover = vector["lease_start"]
        generator.time_source = lambda: vector["timestamp"]
        return generator


if __name__ == "__main__":
    unittest.main()
