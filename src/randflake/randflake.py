import time
import struct
from dataclasses import dataclass
from typing import Tuple
from .sparx64 import Sparx64

# Constants
RANDFLAKE_EPOCH_OFFSET = 1730000000  # Sunday, October 27, 2024 3:33:20 AM UTC

# Bits allocation
RANDFLAKE_TIMESTAMP_BITS = 30  # 30 bits for timestamp (lifetime of 34 years)
RANDFLAKE_NODE_BITS = 17  # 17 bits for node id (max 131072 nodes)
RANDFLAKE_SEQUENCE_BITS = 17  # 17 bits for sequence (max 131072 sequences)

# Derived constants
RANDFLAKE_MAX_TIMESTAMP = RANDFLAKE_EPOCH_OFFSET + (1 << RANDFLAKE_TIMESTAMP_BITS) - 1
RANDFLAKE_MAX_NODE = (1 << RANDFLAKE_NODE_BITS) - 1
RANDFLAKE_MAX_SEQUENCE = (1 << RANDFLAKE_SEQUENCE_BITS) - 1


# Custom error classes
class RandflakeError(Exception):
    """Base class for randflake errors"""

    pass


class ErrRandflakeDead(RandflakeError):
    def __init__(self):
        super().__init__(
            "randflake: the randflake id is dead after 34 years of lifetime"
        )


class ErrInvalidSecret(RandflakeError):
    def __init__(self):
        super().__init__("randflake: invalid secret, secret must be 16 bytes long")


class ErrInvalidLease(RandflakeError):
    def __init__(self):
        super().__init__("randflake: invalid lease, lease expired or not started yet")


class ErrInvalidNode(RandflakeError):
    def __init__(self):
        super().__init__(
            "randflake: invalid node id, node id must be between 0 and 131071"
        )


class ErrResourceExhausted(RandflakeError):
    def __init__(self):
        super().__init__(
            "randflake: resource exhausted (generator can't handle current throughput, try using multiple randflake instances)"
        )


class ErrConsistencyViolation(RandflakeError):
    def __init__(self):
        super().__init__(
            "randflake: timestamp consistency violation, the current time is less than the last time"
        )


class ErrInvalidID(RandflakeError):
    def __init__(self):
        super().__init__("randflake: invalid id")


_base32hexchars = "0123456789abcdefghijklmnopqrstuv"


def _encodeB32hex(n):
    if n < 0:
        n += 1 << 64

    if n == 0:
        return "0"

    result = ""
    while n > 0:
        result = _base32hexchars[n & 0x1F] + result
        n = n // 32
    return result


def _decodeB32hex(s):
    return int(s, 32)


@dataclass
class LeaseInfo:
    node_id: int
    lease_start: int
    lease_end: int


class Generator:
    def __init__(self, node_id: int, lease_start: int, lease_end: int, secret: bytes):
        if lease_end < lease_start:
            raise ErrInvalidLease()

        if not (0 <= node_id <= RANDFLAKE_MAX_NODE):
            raise ErrInvalidNode()

        if lease_end > RANDFLAKE_MAX_TIMESTAMP:
            raise ErrRandflakeDead()

        if len(secret) != 16:
            raise ErrInvalidSecret()

        self.lease_start = lease_start
        self.lease_end = lease_end
        self.node_id = node_id
        self.sequence = 0
        self.rollover = lease_start
        self.sbox = Sparx64(secret)
        self.time_source = None

    def update_lease(self, lease_start: int, lease_end: int) -> bool:
        if lease_start != self.lease_start:
            return False

        if lease_end < lease_start:
            return False

        if lease_end > RANDFLAKE_MAX_TIMESTAMP:
            return False

        if self.lease_end < lease_end:
            self.lease_end = lease_end
            return True

        return False

    def get_lease_info(self) -> LeaseInfo:
        return LeaseInfo(
            node_id=self.node_id,
            lease_start=self.lease_start,
            lease_end=self.lease_end,
        )

    def _new_raw(self) -> int:
        while True:
            now = self.time_source() if self.time_source else int(time.time())

            if now < self.lease_start:
                raise ErrInvalidLease()

            if now > self.lease_end:
                raise ErrInvalidLease()

            self.sequence += 1
            if self.sequence > RANDFLAKE_MAX_SEQUENCE:
                if now > self.rollover:
                    self.rollover = now
                    self.sequence = 0
                else:
                    if now < self.rollover:
                        raise ErrConsistencyViolation()
                    raise ErrResourceExhausted()

            timestamp = now - RANDFLAKE_EPOCH_OFFSET
            return (
                (timestamp << (RANDFLAKE_NODE_BITS + RANDFLAKE_SEQUENCE_BITS))
                | (self.node_id << RANDFLAKE_SEQUENCE_BITS)
                | self.sequence
            )

    def generate(self) -> int:
        id_raw = self._new_raw()
        src = struct.pack("<q", id_raw)
        dst = bytearray(8)  # Use bytearray for dst
        self.sbox.encrypt(dst, src)
        return struct.unpack("<q", dst)[0]

    def generate_string(self) -> str:
        _id = self.generate()
        return _encodeB32hex(_id)

    def inspect(self, id_val: int) -> Tuple[int, int, int]:
        src = struct.pack("<q", id_val)
        dst = bytearray(8)  # Use bytearray for dst
        self.sbox.decrypt(dst, src)
        id_raw = struct.unpack("<q", dst)[0]

        if id_raw < 0:
            raise ErrInvalidLease()

        timestamp = (
            id_raw >> (RANDFLAKE_NODE_BITS + RANDFLAKE_SEQUENCE_BITS)
        ) + RANDFLAKE_EPOCH_OFFSET
        node_id = (id_raw >> RANDFLAKE_SEQUENCE_BITS) & RANDFLAKE_MAX_NODE
        sequence = id_raw & RANDFLAKE_MAX_SEQUENCE

        return timestamp, node_id, sequence

    def inspect_string(self, id_str: str) -> Tuple[int, int, int]:
        id_val = _decodeB32hex(id_str)
        return self.inspect(id_val)
