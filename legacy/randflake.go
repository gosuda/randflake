// Package legacy retains the original inclusive-lease API.
//
// Deprecated: use gosuda.org/randflake/v2 for half-open leases and constructor-supplied clocks.
package legacy

import "gosuda.org/randflake/v2/internal/generator"

const (
	RANDFLAKE_EPOCH_OFFSET   = generator.Epoch
	RANDFLAKE_TIMESTAMP_BITS = generator.TimestampBits
	RANDFLAKE_NODE_BITS      = generator.NodeBits
	RANDFLAKE_SEQUENCE_BITS  = generator.SequenceBits
	RANDFLAKE_MAX_TIMESTAMP  = generator.MaxTimestamp
	RANDFLAKE_MAX_NODE       = generator.MaxNode
	RANDFLAKE_MAX_SEQUENCE   = generator.MaxSequence
)

var (
	ErrRandflakeDead        = generator.ErrRandflakeDead
	ErrInvalidSecret        = generator.ErrInvalidSecret
	ErrInvalidLease         = generator.ErrInvalidLease
	ErrInvalidNode          = generator.ErrInvalidNode
	ErrResourceExhausted    = generator.ErrResourceExhausted
	ErrConsistencyViolation = generator.ErrConsistencyViolation
	ErrInvalidID            = generator.ErrInvalidID
)

// Generator supports concurrent generation but must not be copied after construction.
//
// Deprecated: use v2.Generator.
type Generator struct {
	core generator.Generator

	// TimeSource returns Unix seconds. Set it before concurrent use; nil uses the system clock.
	// Deprecated: supply v2.Config.Clock at construction.
	TimeSource func() int64
}

// NewGenerator assigns nodeID the inclusive interval [leaseStart, leaseEnd].
// A node must have only one active generator for any overlapping lease seconds,
// including across process restarts.
//
// Deprecated: use v2.New with an exclusive lease end.
func NewGenerator(nodeID, leaseStart, leaseEnd int64, secret []byte) (*Generator, error) {
	if leaseEnd < leaseStart {
		return nil, ErrInvalidLease
	}
	if nodeID < 0 || nodeID > RANDFLAKE_MAX_NODE {
		return nil, ErrInvalidNode
	}
	if leaseStart < RANDFLAKE_EPOCH_OFFSET {
		return nil, ErrInvalidLease
	}
	if leaseEnd > RANDFLAKE_MAX_TIMESTAMP {
		return nil, ErrRandflakeDead
	}
	g := new(Generator)
	lease := generator.Lease{NodeID: uint32(nodeID), Start: generator.UnixSeconds(leaseStart), EndExclusive: generator.UnixSeconds(leaseEnd + 1)}
	if err := g.core.Init(lease, secret, nil); err != nil {
		return nil, err
	}
	return g, nil
}

// UpdateLease extends the inclusive lease end and reports whether it changed.
// Deprecated: use v2.Generator.ExtendLease.
func (g *Generator) UpdateLease(leaseStart, leaseEnd int64) bool {
	lease := g.core.Lease()
	if leaseStart != int64(lease.Start) || leaseEnd < leaseStart || leaseEnd > RANDFLAKE_MAX_TIMESTAMP {
		return false
	}
	lease.EndExclusive = generator.UnixSeconds(leaseEnd + 1)
	updated, err := g.core.ExtendLease(lease)
	return updated && err == nil
}

// LeaseInfo is a snapshot with an inclusive LeaseEnd.
// Deprecated: use v2.Lease.
type LeaseInfo struct {
	NodeID     int64
	LeaseStart int64
	LeaseEnd   int64
}

// GetLeaseInfo returns a detached snapshot of the inclusive lease.
// Deprecated: use v2.Generator.Lease.
func (g *Generator) GetLeaseInfo() LeaseInfo {
	lease := g.core.Lease()
	return LeaseInfo{NodeID: int64(lease.NodeID), LeaseStart: int64(lease.Start), LeaseEnd: int64(lease.EndExclusive) - 1}
}

// Generate returns a signed 64-bit encrypted ID without waiting on clock or sequence errors.
// Deprecated: use v2.Generator.Generate.
func (g *Generator) Generate() (int64, error) {
	return g.core.Generate(g.TimeSource)
}

// GenerateString returns the canonical base32hex encoding of a new ID.
// Deprecated: use v2.Generator.GenerateString.
func (g *Generator) GenerateString() (string, error) {
	return g.core.GenerateString(g.TimeSource)
}

// Inspect decodes fields without authenticating the ID or checking the current lease.
// Deprecated: use v2.Generator.Inspect for a named result.
func (g *Generator) Inspect(id int64) (timestamp, nodeID, sequence int64, err error) {
	parts := g.core.Inspect(id)
	return int64(parts.Timestamp), int64(parts.NodeID), int64(parts.Sequence), nil
}

// InspectString retains the original permissive string parsing rules.
// Deprecated: use v2.Generator.InspectString for canonical input validation.
func (g *Generator) InspectString(id string) (timestamp, nodeID, sequence int64, err error) {
	num, err := generator.DecodeLegacy(id)
	if err != nil {
		return 0, 0, 0, err
	}
	return g.Inspect(num)
}

// EncodeString returns the canonical base32hex representation of all 64 ID bits.
// Deprecated: use v2.EncodeString.
func EncodeString(id int64) string {
	return generator.Encode(id)
}

// DecodeString preserves case folding, padding termination and modulo-64 overflow.
// Deprecated: use v2.DecodeString for strict canonical parsing.
func DecodeString(s string) (int64, error) {
	return generator.DecodeLegacy(s)
}
