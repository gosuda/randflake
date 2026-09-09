package generator

import (
	"encoding/binary"
	"errors"
	"sync/atomic"
	"time"

	"gosuda.org/randflake/v2/sparx64"
)

const (
	Epoch         = 1730000000
	TimestampBits = 30
	NodeBits      = 17
	SequenceBits  = 17
	MaxTimestamp  = Epoch + 1<<TimestampBits - 1
	MaxNode       = 1<<NodeBits - 1
	MaxSequence   = 1<<SequenceBits - 1

	// One extra bit represents an exhausted second without overflowing its timestamp.
	nextSequenceBits = SequenceBits + 1
	nextSequenceMask = 1<<nextSequenceBits - 1
)

var (
	ErrRandflakeDead        = errors.New("randflake: timestamp exceeds the 30-bit lifetime")
	ErrInvalidSecret        = errors.New("randflake: secret must be 16 bytes")
	ErrInvalidLease         = errors.New("randflake: invalid or inactive lease")
	ErrInvalidNode          = errors.New("randflake: node ID must be between 0 and 131071")
	ErrResourceExhausted    = errors.New("randflake: sequence exhausted for this second")
	ErrConsistencyViolation = errors.New("randflake: Unix seconds moved backwards")
	ErrInvalidID            = errors.New("randflake: invalid ID")
)

// UnixSeconds is a POSIX timestamp in whole seconds, not continuous SI time.
type UnixSeconds int64

// Clock must be safe for concurrent reads and must not call back into its generator.
// A CAS retry can read it again. Errors are returned without consuming a sequence.
type Clock func() (UnixSeconds, error)

// Lease assigns one node the half-open interval [Start, EndExclusive).
type Lease struct {
	NodeID       uint32
	Start        UnixSeconds
	EndExclusive UnixSeconds
}

// Parts are decoded fields, not proof that an ID was issued by a trusted party.
type Parts struct {
	Timestamp UnixSeconds
	NodeID    uint32
	Sequence  uint32
}

// Generator must not be copied after initialization.
type Generator struct {
	state      atomic.Uint64
	leaseEnd   atomic.Int64
	leaseStart UnixSeconds
	nodeBits   uint64
	sbox       *sparx64.Sparx64
	clock      Clock
}

// Init is called once by a public constructor, before the generator is exposed.
func (g *Generator) Init(lease Lease, secret []byte, clock Clock) error {
	if lease.NodeID > MaxNode {
		return ErrInvalidNode
	}
	if lease.Start < Epoch || lease.EndExclusive <= lease.Start || lease.EndExclusive > MaxTimestamp+1 {
		return ErrInvalidLease
	}
	if len(secret) != 16 {
		return ErrInvalidSecret
	}
	g.leaseStart = lease.Start
	g.leaseEnd.Store(int64(lease.EndExclusive))
	g.nodeBits = uint64(lease.NodeID) << SequenceBits
	g.sbox = sparx64.NewSparx64(secret)
	g.clock = clock
	g.state.Store(uint64(lease.Start) << nextSequenceBits)
	return nil
}

func (g *Generator) Lease() Lease {
	return Lease{NodeID: uint32(g.nodeBits >> SequenceBits), Start: g.leaseStart, EndExclusive: UnixSeconds(g.leaseEnd.Load())}
}

func (g *Generator) ExtendLease(next Lease) (bool, error) {
	if next.NodeID != uint32(g.nodeBits>>SequenceBits) || next.Start != g.leaseStart || next.EndExclusive <= next.Start || next.EndExclusive > MaxTimestamp+1 {
		return false, ErrInvalidLease
	}
	for {
		current := g.leaseEnd.Load()
		if int64(next.EndExclusive) <= current {
			return false, nil
		}
		if g.leaseEnd.CompareAndSwap(current, int64(next.EndExclusive)) {
			return true, nil
		}
	}
}

func (g *Generator) nextRaw(legacyClock func() int64) (uint64, error) {
	for {
		// Sampling after the load lets a stale concurrent read fail CAS and resample.
		old := g.state.Load()
		var now UnixSeconds
		if legacyClock != nil {
			now = UnixSeconds(legacyClock())
		} else if g.clock != nil {
			var err error
			now, err = g.clock()
			if err != nil {
				return 0, err
			}
		} else {
			now = UnixSeconds(time.Now().Unix())
		}
		if now < g.leaseStart || int64(now) >= g.leaseEnd.Load() {
			return 0, ErrInvalidLease
		}
		last := UnixSeconds(old >> nextSequenceBits)
		if now < last {
			return 0, ErrConsistencyViolation
		}
		sequence := old & nextSequenceMask
		if now > last {
			sequence = 0
		}
		if sequence > MaxSequence {
			return 0, ErrResourceExhausted
		}
		next := uint64(now)<<nextSequenceBits | (sequence + 1)
		if !g.state.CompareAndSwap(old, next) {
			continue
		}
		return uint64(now-Epoch)<<(NodeBits+SequenceBits) | g.nodeBits | sequence, nil
	}
}

func (g *Generator) Generate(legacyClock func() int64) (int64, error) {
	id, err := g.nextRaw(legacyClock)
	if err != nil {
		return 0, err
	}
	var block [8]byte
	binary.LittleEndian.PutUint64(block[:], id)
	g.sbox.Encrypt(block[:], block[:])
	return int64(binary.LittleEndian.Uint64(block[:])), nil
}

func (g *Generator) GenerateString(legacyClock func() int64) (string, error) {
	id, err := g.Generate(legacyClock)
	if err != nil {
		return "", err
	}
	return Encode(id), nil
}

func (g *Generator) Inspect(id int64) Parts {
	var block [8]byte
	binary.LittleEndian.PutUint64(block[:], uint64(id))
	g.sbox.Decrypt(block[:], block[:])
	raw := binary.LittleEndian.Uint64(block[:])
	return Parts{
		Timestamp: UnixSeconds(raw>>(NodeBits+SequenceBits)) + Epoch,
		NodeID:    uint32(raw>>SequenceBits) & MaxNode,
		Sequence:  uint32(raw) & MaxSequence,
	}
}
