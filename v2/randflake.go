// Package randflake generates encrypted IDs with half-open leases and whole Unix seconds.
// A node must have only one active generator for any overlapping lease seconds,
// including across process restarts. Clock monotonicity does not allocate node ownership.
package randflake

import "gosuda.org/randflake/internal/generator"

// UnixSeconds is a POSIX timestamp, not continuous SI time or Unix nanoseconds.
type UnixSeconds = generator.UnixSeconds

// Clock is a concurrent-safe, non-reentrant time reader. CAS retries may read it again.
// A clock failure is returned unchanged without consuming a sequence.
type Clock = generator.Clock

// Lease owns a node for [Start, EndExclusive). The maximum end is MaxTimestamp+1.
type Lease = generator.Lease

// Parts are decrypted fields, not an authenticity or issuance proof.
type Parts = generator.Parts

const (
	Epoch        UnixSeconds = generator.Epoch
	MaxTimestamp UnixSeconds = generator.MaxTimestamp
	MaxNodeID    uint32      = generator.MaxNode
	MaxSequence  uint32      = generator.MaxSequence
)

var (
	ErrInvalidSecret        = generator.ErrInvalidSecret
	ErrInvalidLease         = generator.ErrInvalidLease
	ErrInvalidNode          = generator.ErrInvalidNode
	ErrResourceExhausted    = generator.ErrResourceExhausted
	ErrConsistencyViolation = generator.ErrConsistencyViolation
	ErrInvalidID            = generator.ErrInvalidID
)

// Config is consumed at construction. Secret must contain exactly 16 bytes and is
// expanded into owned key material; later changes to the slice have no effect.
// A nil Clock selects the system clock.
type Config struct {
	Lease  Lease
	Secret []byte
	Clock  Clock
}

// Generator supports concurrent generation and lease extension. It must not be copied.
// Construct it with New; its zero value is not usable.
type Generator struct {
	core generator.Generator
}

func New(config Config) (*Generator, error) {
	g := new(Generator)
	if err := g.core.Init(config.Lease, config.Secret, config.Clock); err != nil {
		return nil, err
	}
	return g, nil
}

// Generate returns a signed 64-bit encrypted ID. It rejects backwards seconds and
// exhaustion without waiting, advancing synthetic time, or consuming a sequence.
func (g *Generator) Generate() (int64, error) {
	return g.core.Generate(nil)
}

func (g *Generator) GenerateString() (string, error) {
	return g.core.GenerateString(nil)
}

// ExtendLease requires the same node and start. An already-satisfied valid end is
// a successful no-op; concurrent extensions retain the greatest requested end.
func (g *Generator) ExtendLease(next Lease) error {
	_, err := g.core.ExtendLease(next)
	return err
}

func (g *Generator) Lease() Lease {
	return g.core.Lease()
}

// Inspect decrypts all 64 bits, including the upper half of the timestamp range.
// It does not require an active lease and does not authenticate the ID.
func (g *Generator) Inspect(id int64) Parts {
	return g.core.Inspect(id)
}

func (g *Generator) InspectString(id string) (Parts, error) {
	num, err := DecodeString(id)
	if err != nil {
		return Parts{}, err
	}
	return g.Inspect(num), nil
}

func EncodeString(id int64) string {
	return generator.Encode(id)
}

// DecodeString accepts only the canonical lowercase, unpadded representation.
// Empty input, leading zeros, uppercase, padding and uint64 overflow are invalid.
func DecodeString(s string) (int64, error) {
	return generator.Decode(s)
}
