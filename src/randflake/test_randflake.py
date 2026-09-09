import json
import unittest
import warnings
from concurrent.futures import ThreadPoolExecutor
from dataclasses import FrozenInstanceError
from pathlib import Path
from threading import Barrier

from . import (
    ErrConsistencyViolation,
    ErrInvalidID,
    ErrInvalidLease,
    ErrInvalidNode,
    ErrInvalidSecret,
    ErrRandflakeDead,
    ErrResourceExhausted,
    Generator as LegacyGenerator,
    RANDFLAKE_EPOCH_OFFSET,
    RANDFLAKE_MAX_NODE,
    RANDFLAKE_MAX_SEQUENCE,
    RANDFLAKE_MAX_TIMESTAMP,
)
from .v2 import Config, Generator, Lease, Parts, decode_string, encode_string


TEST_VECTOR_PATH = Path(__file__).resolve().parents[2] / "test_vectors.json"
EPOCH = RANDFLAKE_EPOCH_OFFSET
SECRET = bytes(16)


class TestAllocation(unittest.TestCase):
    def test_second_change_resets_sequence_and_rejects_rollback(self):
        for legacy in (False, True):
            with self.subTest(legacy=legacy):
                now = EPOCH + 10
                if legacy:
                    generator = LegacyGenerator(7, EPOCH, EPOCH + 20, SECRET)
                    generator.time_source = lambda: now
                    inspect = lambda value: Parts(*generator.inspect(value))
                else:
                    generator = Generator(Config(Lease(7, EPOCH, EPOCH + 20), SECRET, lambda: now))
                    inspect = generator.inspect
                first = generator.generate()
                now += 1
                second = generator.generate()
                self.assertEqual(inspect(first).sequence, 0)
                self.assertEqual(inspect(second).sequence, 0)
                self.assertEqual(inspect(second).timestamp, now)
                now -= 1
                with self.assertRaises(ErrConsistencyViolation):
                    generator.generate()
                now += 1
                third = generator.generate()
                self.assertEqual(inspect(third).sequence, 1)
                self.assertEqual(len({first, second, third}), 3)

    def test_exhaustion_does_not_consume_next_second(self):
        now = EPOCH
        generator = Generator(Config(Lease(0, EPOCH, EPOCH + 2), SECRET, lambda: now))
        first = generator.generate()
        for _ in range(RANDFLAKE_MAX_SEQUENCE):
            last = generator.generate()
        self.assertEqual(generator.inspect(first).sequence, 0)
        self.assertEqual(generator.inspect(last).sequence, RANDFLAKE_MAX_SEQUENCE)
        for _ in range(2):
            with self.assertRaises(ErrResourceExhausted):
                generator.generate()
        now += 1
        self.assertEqual(generator.inspect(generator.generate()).sequence, 0)
        now -= 1
        with self.assertRaises(ErrConsistencyViolation):
            generator.generate()
        now += 1
        self.assertEqual(generator.inspect(generator.generate()).sequence, 1)

    def test_concurrent_allocations_are_unique(self):
        generator = Generator(Config(Lease(2, EPOCH, EPOCH + 1), SECRET, lambda: EPOCH))
        start = Barrier(8)

        def generate_batch():
            start.wait(timeout=10)
            return [generator.generate() for _ in range(128)]

        with ThreadPoolExecutor(max_workers=8) as executor:
            futures = [executor.submit(generate_batch) for _ in range(8)]
            ids = [value for future in futures for value in future.result(timeout=30)]
        self.assertEqual(len(set(ids)), 1024)
        self.assertEqual({generator.inspect(value).sequence for value in ids}, set(range(1024)))

    def test_upper_half_timestamps_round_trip(self):
        for timestamp in (EPOCH + (1 << 29), RANDFLAKE_MAX_TIMESTAMP):
            with self.subTest(timestamp=timestamp):
                generator = Generator(Config(Lease(RANDFLAKE_MAX_NODE, timestamp, timestamp + 1), SECRET, lambda: timestamp))
                value = generator.generate()
                parts = generator.inspect(value)
                self.assertEqual(parts.timestamp, timestamp)
                self.assertEqual(parts.node_id, RANDFLAKE_MAX_NODE)
                self.assertEqual(parts.sequence, 0)
                legacy = LegacyGenerator(RANDFLAKE_MAX_NODE, timestamp, timestamp, SECRET)
                legacy.time_source = lambda: timestamp
                self.assertEqual(legacy.generate(), value)
                self.assertEqual(legacy.inspect(value), (timestamp, RANDFLAKE_MAX_NODE, 0))

    def test_clock_failure_leaves_allocation_state_unchanged(self):
        failure = RuntimeError("clock unavailable")
        readings = iter((EPOCH, failure, EPOCH))

        def clock():
            result = next(readings)
            if isinstance(result, Exception):
                raise result
            return result

        generator = Generator(Config(Lease(0, EPOCH, EPOCH + 1), SECRET, clock))
        self.assertEqual(generator.inspect(generator.generate()).sequence, 0)
        with self.assertRaises(RuntimeError) as raised:
            generator.generate()
        self.assertIs(raised.exception, failure)
        self.assertEqual(generator.inspect(generator.generate()).sequence, 1)

    def test_invalid_clock_reading_does_not_consume_sequence(self):
        now = EPOCH
        generator = Generator(Config(Lease(0, EPOCH, EPOCH + 1), SECRET, lambda: now))
        generator.generate()
        for now in (True, float(EPOCH), float("nan"), float("inf"), None, "1730000000"):
            with self.subTest(reading=now):
                with self.assertRaises(ErrConsistencyViolation):
                    generator.generate()
        now = EPOCH
        self.assertEqual(generator.inspect(generator.generate()).sequence, 1)


class TestLease(unittest.TestCase):
    def test_half_open_boundary_and_idempotent_extension(self):
        now = EPOCH - 1
        generator = Generator(Config(Lease(7, EPOCH, EPOCH + 1), SECRET, lambda: now))
        snapshot = generator.lease()
        with self.assertRaises(ErrInvalidLease):
            generator.generate()
        now = EPOCH
        self.assertEqual(generator.inspect(generator.generate()).timestamp, now)
        now += 1
        with self.assertRaises(ErrInvalidLease):
            generator.generate()
        generator.extend_lease(Lease(7, EPOCH, EPOCH + 3))
        generator.extend_lease(Lease(7, EPOCH, EPOCH + 3))
        generator.extend_lease(snapshot)
        self.assertEqual(snapshot.end_exclusive, EPOCH + 1)
        self.assertEqual(generator.lease().end_exclusive, EPOCH + 3)
        self.assertEqual(generator.inspect(generator.generate()).sequence, 0)
        now = EPOCH + 2
        self.assertEqual(generator.inspect(generator.generate()).timestamp, now)

    def test_extension_rejects_different_node_or_start(self):
        now = EPOCH + 2
        generator = Generator(Config(Lease(7, EPOCH, EPOCH + 2), SECRET, lambda: now))
        for lease in (Lease(8, EPOCH, EPOCH + 3), Lease(7, EPOCH + 1, EPOCH + 3), None):
            with self.subTest(lease=lease):
                with self.assertRaises(ErrInvalidLease):
                    generator.extend_lease(lease)
        with self.assertRaises(ErrInvalidLease):
            generator.generate()
        generator.extend_lease(Lease(7, EPOCH, EPOCH + 3))
        self.assertEqual(generator.inspect(generator.generate()).sequence, 0)

    def test_invalid_node_values_raise_domain_errors(self):
        for node in (-1, RANDFLAKE_MAX_NODE + 1, True, 1.0, float("nan"), None, "1"):
            with self.subTest(node=node):
                with self.assertRaises(ErrInvalidNode):
                    Lease(node, EPOCH, EPOCH + 1)
                with self.assertRaises(ErrInvalidNode):
                    LegacyGenerator(node, EPOCH, EPOCH, SECRET)

    def test_invalid_lease_intervals_raise_domain_errors(self):
        for start, end in (
            (EPOCH - 1, EPOCH + 1),
            (EPOCH, EPOCH),
            (EPOCH + 1, EPOCH),
            (EPOCH, RANDFLAKE_MAX_TIMESTAMP + 2),
            (RANDFLAKE_MAX_TIMESTAMP + 1, RANDFLAKE_MAX_TIMESTAMP + 2),
        ):
            with self.subTest(start=start, end=end):
                with self.assertRaises(ErrInvalidLease):
                    Lease(0, start, end)
        for invalid in (True, float(EPOCH), float("nan"), float("inf"), None, str(EPOCH)):
            with self.subTest(value=invalid):
                with self.assertRaises(ErrInvalidLease):
                    Lease(0, invalid, EPOCH + 1)
                with self.assertRaises(ErrInvalidLease):
                    Lease(0, EPOCH, invalid)
                with self.assertRaises(ErrInvalidLease):
                    LegacyGenerator(0, invalid, EPOCH + 1, SECRET)
                with self.assertRaises(ErrInvalidLease):
                    LegacyGenerator(0, EPOCH, invalid, SECRET)

    def test_secret_snapshot_survives_caller_mutation(self):
        secret = bytearray(16)
        config = Config(Lease(0, EPOCH, EPOCH + 2), secret, lambda: EPOCH + 1)
        secret[:] = bytes([255]) * 16
        generator = Generator(config)
        self.assertEqual(generator.generate(), 2111581968557607991)

    def test_invalid_config_raises_domain_errors(self):
        lease = Lease(0, EPOCH, EPOCH + 1)
        for secret in (bytes(15), bytes(17), 16, None, "0" * 16):
            with self.subTest(secret=secret):
                with self.assertRaises(ErrInvalidSecret):
                    Config(lease, secret)
        with self.assertRaises(ErrInvalidLease):
            Config(None, SECRET)
        with self.assertRaises(ErrConsistencyViolation):
            Config(lease, SECRET, clock=EPOCH)
        with self.assertRaises(ErrInvalidLease):
            Generator(None)

    def test_v2_values_and_generator_configuration_are_read_only(self):
        lease = Lease(0, EPOCH, EPOCH + 1)
        config = Config(lease, SECRET, lambda: EPOCH)
        generator = Generator(config)
        parts = generator.inspect(generator.generate())
        for value, name, replacement in ((lease, "end_exclusive", EPOCH + 2), (config, "secret", bytes([255]) * 16), (parts, "sequence", 10)):
            with self.subTest(field=name):
                with self.assertRaises(FrozenInstanceError):
                    setattr(value, name, replacement)
        for name in ("node_id", "sequence", "clock", "time_source", "lease"):
            with self.subTest(field=name):
                with self.assertRaises(AttributeError):
                    setattr(generator, name, 0)


class TestCodec(unittest.TestCase):
    def test_signed_integer_encoding_boundaries(self):
        for value, encoded in ((0, "0"), (31, "v"), (32, "10"), ((1 << 63) - 1, "7vvvvvvvvvvvv"), (-(1 << 63), "8000000000000"), (-1, "fvvvvvvvvvvvv")):
            with self.subTest(value=value):
                self.assertEqual(encode_string(value), encoded)
                self.assertEqual(decode_string(encoded), value)

    def test_strict_parser_rejects_noncanonical_and_overflow(self):
        generator = Generator(Config(Lease(0, EPOCH, EPOCH + 1), SECRET))
        for value in ("", "A", "a=", "00", "01", "w", " ", "g000000000000", "10000000000000", None, 1, b"0"):
            with self.subTest(value=value):
                with self.assertRaises(ErrInvalidID):
                    decode_string(value)
                with self.assertRaises(ErrInvalidID):
                    generator.inspect_string(value)

    def test_invalid_numeric_ids_raise_domain_errors(self):
        generator = Generator(Config(Lease(0, EPOCH, EPOCH + 1), SECRET))
        legacy = LegacyGenerator(0, EPOCH, EPOCH, SECRET)
        for value in (-(1 << 63) - 1, 1 << 63, True, 1.0, float("nan"), None, "0"):
            with self.subTest(value=value):
                with self.assertRaises(ErrInvalidID):
                    encode_string(value)
                with self.assertRaises(ErrInvalidID):
                    generator.inspect(value)
                with self.assertRaises(ErrInvalidID):
                    legacy.inspect(value)

    def test_historical_vectors_inspect_and_encode(self):
        with TEST_VECTOR_PATH.open(encoding="utf-8") as stream:
            vectors = json.load(stream)
        for vector in vectors:
            with self.subTest(id=vector["encrypted_id"]):
                secret = bytes.fromhex(vector["secret"])
                expected_id = int(vector["encrypted_id"])
                expected_parts = (vector["timestamp"], vector["node_id"], vector["sequence"])
                generator = Generator(Config(Lease(0, EPOCH, EPOCH + 1), secret))
                legacy = LegacyGenerator(0, EPOCH, EPOCH, secret)
                for parts in (generator.inspect(expected_id), generator.inspect_string(vector["encoded_id"])):
                    self.assertEqual((parts.timestamp, parts.node_id, parts.sequence), expected_parts)
                self.assertEqual(legacy.inspect(expected_id), expected_parts)
                self.assertEqual(legacy.inspect_string(vector["encoded_id"].upper() + "=ignored"), expected_parts)
                self.assertEqual(decode_string(vector["encoded_id"]), expected_id)
                self.assertEqual(encode_string(expected_id), vector["encoded_id"])
                if vector["sequence"] <= 1:
                    for as_string in (False, True):
                        for use_legacy in (False, True):
                            if use_legacy:
                                source = LegacyGenerator(vector["node_id"], vector["lease_start"], vector["lease_end"], secret)
                                source.time_source = lambda: vector["timestamp"]
                            else:
                                source = Generator(Config(Lease(vector["node_id"], vector["lease_start"], vector["lease_end"] + 1), secret, lambda: vector["timestamp"]))
                            for _ in range(vector["sequence"]):
                                source.generate()
                            if as_string:
                                self.assertEqual(source.generate_string(), vector["encoded_id"])
                            else:
                                self.assertEqual(source.generate(), expected_id)


class TestLegacyCompatibility(unittest.TestCase):
    def test_warning_occurs_only_at_construction(self):
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            generator = LegacyGenerator(0, EPOCH, EPOCH, SECRET)
            generator.time_source = lambda: EPOCH
            value = generator.generate()
            generator.generate_string()
            generator.inspect(value)
        self.assertEqual([warning.category for warning in caught], [DeprecationWarning])

    def test_inclusive_lease_and_boolean_updates(self):
        now = EPOCH
        generator = LegacyGenerator(0, EPOCH, EPOCH, SECRET)
        generator.time_source = lambda: now
        self.assertEqual(generator.inspect(generator.generate()), (EPOCH, 0, 0))
        snapshot = generator.get_lease_info()
        now += 1
        with self.assertRaises(ErrInvalidLease):
            generator.generate()
        self.assertFalse(generator.update_lease(EPOCH, EPOCH))
        self.assertFalse(generator.update_lease(EPOCH + 1, EPOCH + 2))
        self.assertFalse(generator.update_lease(EPOCH, EPOCH - 1))
        self.assertFalse(generator.update_lease(EPOCH, RANDFLAKE_MAX_TIMESTAMP + 1))
        self.assertFalse(generator.update_lease(EPOCH, float("nan")))
        self.assertTrue(generator.update_lease(EPOCH, EPOCH + 1))
        self.assertEqual(snapshot.lease_end, EPOCH)
        self.assertEqual(generator.get_lease_info().lease_end, EPOCH + 1)
        self.assertEqual(generator.inspect(generator.generate()), (EPOCH + 1, 0, 0))

    def test_legacy_constructor_rejects_after_lifetime(self):
        with self.assertRaises(ErrRandflakeDead):
            LegacyGenerator(0, EPOCH, RANDFLAKE_MAX_TIMESTAMP + 1, SECRET)

    def test_legacy_parser_keeps_case_padding_and_overflow(self):
        generator = LegacyGenerator(0, EPOCH, EPOCH, SECRET)
        for value, expected in (("", 0), ("=ignored", 0), ("00A=ignored", 10), ("FVVVVVVVVVVVV===", -1), ("g000000000001", 1)):
            with self.subTest(value=value):
                self.assertEqual(generator.inspect_string(value), generator.inspect(expected))


if __name__ == "__main__":
    unittest.main()
