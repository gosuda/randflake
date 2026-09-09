import struct
import time
from dataclasses import dataclass, field
from threading import Lock
from typing import Callable, Optional

from .sparx64 import Sparx64


RANDFLAKE_EPOCH_OFFSET = 1730000000
RANDFLAKE_TIMESTAMP_BITS = 30
RANDFLAKE_NODE_BITS = 17
RANDFLAKE_SEQUENCE_BITS = 17
RANDFLAKE_MAX_TIMESTAMP = RANDFLAKE_EPOCH_OFFSET + (1 << RANDFLAKE_TIMESTAMP_BITS) - 1
RANDFLAKE_MAX_NODE = (1 << RANDFLAKE_NODE_BITS) - 1
RANDFLAKE_MAX_SEQUENCE = (1 << RANDFLAKE_SEQUENCE_BITS) - 1

_SIGN_BIT = 1 << 63
_UINT64_MAX = (1 << 64) - 1
_BASE32HEX = "0123456789abcdefghijklmnopqrstuv"
Clock = Callable[[], int]


class RandflakeError(Exception):
    """Base class for randflake errors."""


class ErrRandflakeDead(RandflakeError):
    def __init__(self):
        super().__init__("randflake: the randflake id is dead after 34 years of lifetime")


class ErrInvalidSecret(RandflakeError):
    def __init__(self):
        super().__init__("randflake: invalid secret, secret must be 16 bytes long")


class ErrInvalidLease(RandflakeError):
    def __init__(self):
        super().__init__("randflake: invalid lease")


class ErrInvalidNode(RandflakeError):
    def __init__(self):
        super().__init__("randflake: invalid node id, node id must be between 0 and 131071")


class ErrResourceExhausted(RandflakeError):
    def __init__(self):
        super().__init__("randflake: sequence exhausted for the current second")


class ErrConsistencyViolation(RandflakeError):
    def __init__(self):
        super().__init__("randflake: clock must return nondecreasing integer Unix seconds")


class ErrInvalidID(RandflakeError):
    def __init__(self):
        super().__init__("randflake: invalid id")


def _is_integer(value) -> bool:
    return isinstance(value, int) and not isinstance(value, bool)


@dataclass(frozen=True)
class Lease:
    """A node's half-open allocation interval in POSIX Unix seconds."""

    __slots__ = ("node_id", "start", "end_exclusive")

    node_id: int
    start: int
    end_exclusive: int

    def __post_init__(self):
        if not _is_integer(self.node_id) or not 0 <= self.node_id <= RANDFLAKE_MAX_NODE:
            raise ErrInvalidNode()
        if (
            not _is_integer(self.start)
            or not _is_integer(self.end_exclusive)
            or not RANDFLAKE_EPOCH_OFFSET <= self.start < self.end_exclusive
            or self.end_exclusive > RANDFLAKE_MAX_TIMESTAMP + 1
        ):
            raise ErrInvalidLease()


@dataclass(frozen=True)
class Config:
    lease: Lease
    secret: bytes = field(repr=False)
    clock: Optional[Clock] = None

    def __post_init__(self):
        if not isinstance(self.lease, Lease):
            raise ErrInvalidLease()
        if not isinstance(self.secret, (bytes, bytearray, memoryview)):
            raise ErrInvalidSecret()
        secret = bytes(self.secret)
        if len(secret) != 16:
            raise ErrInvalidSecret()
        object.__setattr__(self, "secret", secret)
        if self.clock is not None and not callable(self.clock):
            raise ErrConsistencyViolation()


@dataclass(frozen=True)
class Parts:
    """Decrypted fields; inspection does not authenticate an ID."""

    __slots__ = ("timestamp", "node_id", "sequence")

    timestamp: int
    node_id: int
    sequence: int


def _validate_id(value: int) -> None:
    if not _is_integer(value) or not -_SIGN_BIT <= value < _SIGN_BIT:
        raise ErrInvalidID()


def encode_string(value: int) -> str:
    """Encode a signed 64-bit ID as canonical lowercase base32hex."""
    _validate_id(value)
    value &= _UINT64_MAX
    if value == 0:
        return "0"
    result = ""
    while value:
        result = _BASE32HEX[value & 31] + result
        value >>= 5
    return result


def decode_string(value: str, *, strict: bool = True) -> int:
    if not isinstance(value, str):
        raise ErrInvalidID()
    if strict and (not value or len(value) > 13 or (len(value) > 1 and value[0] == "0")):
        raise ErrInvalidID()
    number = 0
    for character in value:
        if not strict and character == "=":
            break
        if "0" <= character <= "9":
            digit = ord(character) - 48
        elif "a" <= character <= "v":
            digit = ord(character) - 87
        elif not strict and "A" <= character <= "V":
            digit = ord(character) - 55
        else:
            raise ErrInvalidID()
        number = (number << 5) | digit
        if strict and number > _UINT64_MAX:
            raise ErrInvalidID()
        if not strict:
            number &= _UINT64_MAX
    return number - (1 << 64) if number >= _SIGN_BIT else number


class _GeneratorCore:
    __slots__ = ("_lease", "_clock", "_lock", "_timestamp", "_next_sequence", "_node_bits", "_sbox")

    def __init__(self, config: Config):
        if not isinstance(config, Config):
            raise ErrInvalidLease()
        self._lease = config.lease
        self._clock = config.clock
        self._lock = Lock()
        self._timestamp = RANDFLAKE_EPOCH_OFFSET - 1
        self._next_sequence = 0
        self._node_bits = config.lease.node_id << RANDFLAKE_SEQUENCE_BITS
        self._sbox = Sparx64(config.secret)

    def lease(self) -> Lease:
        with self._lock:
            return self._lease

    def extend_lease(self, next_lease: Lease) -> bool:
        if not isinstance(next_lease, Lease):
            raise ErrInvalidLease()
        with self._lock:
            current = self._lease
            if next_lease.node_id != current.node_id or next_lease.start != current.start:
                raise ErrInvalidLease()
            if next_lease.end_exclusive <= current.end_exclusive:
                return False
            self._lease = next_lease
            return True

    def clock(self) -> Optional[Clock]:
        with self._lock:
            return self._clock

    def set_clock(self, clock: Optional[Clock]) -> None:
        if clock is not None and not callable(clock):
            raise ErrConsistencyViolation()
        with self._lock:
            self._clock = clock

    def generate(self) -> int:
        # Reading the clock and committing both allocation fields share one order.
        with self._lock:
            if self._clock is None:
                now = int(time.time())
            else:
                now = self._clock()
                if not _is_integer(now):
                    raise ErrConsistencyViolation()
            if not self._lease.start <= now < self._lease.end_exclusive:
                raise ErrInvalidLease()
            if now < self._timestamp:
                raise ErrConsistencyViolation()
            sequence = 0 if now > self._timestamp else self._next_sequence
            if sequence > RANDFLAKE_MAX_SEQUENCE:
                raise ErrResourceExhausted()
            self._timestamp = now
            self._next_sequence = sequence + 1

        raw = ((now - RANDFLAKE_EPOCH_OFFSET) << (RANDFLAKE_NODE_BITS + RANDFLAKE_SEQUENCE_BITS)) | self._node_bits | sequence
        src = struct.pack("<Q", raw)
        dst = bytearray(8)
        self._sbox.encrypt(dst, src)
        return struct.unpack("<q", dst)[0]

    def inspect(self, value: int) -> Parts:
        _validate_id(value)
        src = struct.pack("<q", value)
        dst = bytearray(8)
        self._sbox.decrypt(dst, src)
        raw = struct.unpack("<Q", dst)[0]
        return Parts(
            (raw >> (RANDFLAKE_NODE_BITS + RANDFLAKE_SEQUENCE_BITS)) + RANDFLAKE_EPOCH_OFFSET,
            (raw >> RANDFLAKE_SEQUENCE_BITS) & RANDFLAKE_MAX_NODE,
            raw & RANDFLAKE_MAX_SEQUENCE,
        )
