"""Half-open leases and canonical signed-64-bit ID codecs."""

from ._core import (
    Clock,
    Config,
    ErrConsistencyViolation,
    ErrInvalidID,
    ErrInvalidLease,
    ErrInvalidNode,
    ErrInvalidSecret,
    ErrRandflakeDead,
    ErrResourceExhausted,
    Lease,
    Parts,
    RandflakeError,
    RANDFLAKE_EPOCH_OFFSET,
    RANDFLAKE_MAX_NODE,
    RANDFLAKE_MAX_SEQUENCE,
    RANDFLAKE_MAX_TIMESTAMP,
    _GeneratorCore,
    decode_string as _decode_string,
    encode_string,
)


__all__ = [
    "Clock",
    "Config",
    "Generator",
    "Lease",
    "Parts",
    "encode_string",
    "decode_string",
    "RandflakeError",
    "ErrConsistencyViolation",
    "ErrInvalidID",
    "ErrInvalidLease",
    "ErrInvalidNode",
    "ErrInvalidSecret",
    "ErrRandflakeDead",
    "ErrResourceExhausted",
    "RANDFLAKE_EPOCH_OFFSET",
    "RANDFLAKE_MAX_NODE",
    "RANDFLAKE_MAX_SEQUENCE",
    "RANDFLAKE_MAX_TIMESTAMP",
]


def decode_string(value: str) -> int:
    """Reject noncanonical base32hex and return the signed 64-bit ID."""
    return _decode_string(value)


class Generator:
    """Thread-safe allocator. Clock exceptions leave allocation state unchanged."""

    __slots__ = ("__core",)

    def __init__(self, config: Config):
        self.__core = _GeneratorCore(config)

    def generate(self) -> int:
        return self.__core.generate()

    def generate_string(self) -> str:
        return encode_string(self.__core.generate())

    def extend_lease(self, next_lease: Lease) -> None:
        """Extend the same node/start; valid shorter or equal leases are no-ops."""
        self.__core.extend_lease(next_lease)

    def lease(self) -> Lease:
        return self.__core.lease()

    def inspect(self, value: int) -> Parts:
        """Decrypt fields without authenticating the ID or checking this lease."""
        return self.__core.inspect(value)

    def inspect_string(self, value: str) -> Parts:
        return self.__core.inspect(decode_string(value))
