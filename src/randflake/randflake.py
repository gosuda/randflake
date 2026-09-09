"""Deprecated inclusive-lease API; new callers should use randflake.v2."""

import warnings
from dataclasses import dataclass
from typing import Tuple

from ._core import (
    Config as _Config,
    ErrConsistencyViolation,
    ErrInvalidID,
    ErrInvalidLease,
    ErrInvalidNode,
    ErrInvalidSecret,
    ErrRandflakeDead,
    ErrResourceExhausted,
    Lease as _Lease,
    RandflakeError,
    RANDFLAKE_EPOCH_OFFSET,
    RANDFLAKE_MAX_NODE,
    RANDFLAKE_MAX_SEQUENCE,
    RANDFLAKE_MAX_TIMESTAMP,
    RANDFLAKE_NODE_BITS,
    RANDFLAKE_SEQUENCE_BITS,
    RANDFLAKE_TIMESTAMP_BITS,
    _GeneratorCore,
    _is_integer,
    decode_string as _decode_string,
    encode_string as _encodeB32hex,
)


def _decodeB32hex(value):
    return _decode_string(value, strict=False)


def _legacy_lease(node_id: int, lease_start: int, lease_end: int) -> _Lease:
    if (
        not _is_integer(lease_start)
        or not _is_integer(lease_end)
        or lease_end < lease_start
    ):
        raise ErrInvalidLease()
    if lease_end > RANDFLAKE_MAX_TIMESTAMP:
        raise ErrRandflakeDead()
    return _Lease(node_id, lease_start, lease_end + 1)


@dataclass
class LeaseInfo:
    node_id: int
    lease_start: int
    lease_end: int


class Generator:
    def __init__(self, node_id: int, lease_start: int, lease_end: int, secret: bytes):
        warnings.warn(
            "randflake.Generator is deprecated; use randflake.v2.Generator",
            DeprecationWarning,
            stacklevel=2,
        )
        self.__core = _GeneratorCore(
            _Config(_legacy_lease(node_id, lease_start, lease_end), secret)
        )

    @property
    def node_id(self) -> int:
        return self.__core.lease().node_id

    @property
    def lease_start(self) -> int:
        return self.__core.lease().start

    @property
    def lease_end(self) -> int:
        return self.__core.lease().end_exclusive - 1

    @property
    def time_source(self):
        return self.__core.clock()

    @time_source.setter
    def time_source(self, clock):
        self.__core.set_clock(clock)

    def update_lease(self, lease_start: int, lease_end: int) -> bool:
        try:
            return self.__core.extend_lease(
                _legacy_lease(self.node_id, lease_start, lease_end)
            )
        except RandflakeError:
            return False

    def get_lease_info(self) -> LeaseInfo:
        lease = self.__core.lease()
        return LeaseInfo(lease.node_id, lease.start, lease.end_exclusive - 1)

    def generate(self) -> int:
        return self.__core.generate()

    def generate_string(self) -> str:
        return _encodeB32hex(self.__core.generate())

    def inspect(self, id_val: int) -> Tuple[int, int, int]:
        parts = self.__core.inspect(id_val)
        return parts.timestamp, parts.node_id, parts.sequence

    def inspect_string(self, id_str: str) -> Tuple[int, int, int]:
        return self.inspect(_decodeB32hex(id_str))
