package randflake

import (
	"encoding/binary"
	"errors"
	"sync/atomic"
	"time"

	"gosuda.org/randflake/sparx64"
)

const (
	// Sunday, October 27, 2024 3:33:20 AM UTC
	RANDFLAKE_EPOCH_OFFSET = 1730000000

	// 30 bits for timestamp (lifetime of 34 years)
	RANDFLAKE_TIMESTAMP_BITS = 30
	// 17 bits for node id (max 131072 nodes)
	RANDFLAKE_NODE_BITS = 17
	// 17 bits for sequence (max 131072 sequences)
	RANDFLAKE_SEQUENCE_BITS = 17

	// Tuesday, November 5, 2058 5:10:23 PM UTC
	RANDFLAKE_MAX_TIMESTAMP = RANDFLAKE_EPOCH_OFFSET + 1<<RANDFLAKE_TIMESTAMP_BITS - 1
	// 131071 nodes
	RANDFLAKE_MAX_NODE = 1<<RANDFLAKE_NODE_BITS - 1
	// 131071 sequences
	RANDFLAKE_MAX_SEQUENCE = 1<<RANDFLAKE_SEQUENCE_BITS - 1
)

var (
	ErrRandflakeDead        = errors.New("randflake: the randflake id is dead after 34 years of lifetime")
	ErrInvalidSecret        = errors.New("randflake: invalid secret, secret must be 16 bytes long")
	ErrInvalidLease         = errors.New("randflake: invalid lease, lease expired or not started yet")
	ErrInvalidNode          = errors.New("randflake: invalid node id, node id must be between 0 and 131071")
	ErrResourceExhausted    = errors.New("randflake: resource exhausted (generator can't handle current throughput, try using multiple randflake instances)")
	ErrConsistencyViolation = errors.New("randflake: timestamp consistency violation, the current time is less than the last time")
)

type Generator struct {
	leaseStart int64
	leaseEnd   atomic.Int64
	nodeID     int64
	sequence   atomic.Int64
	rollover   atomic.Int64
	sbox       *sparx64.Sparx64

	// TimeSource is a function that returns the current time in seconds since the epoch.
	// If TimeSource is nil, time.Now().Unix() will be used.
	TimeSource func() int64
}

// NewGenerator creates a new randflake generator.
//
// nodeID is the node ID of the randflake generator. (must be unique in the cluster in a specific lease interval)
// leaseStart is the start time of the lease in seconds since the epoch.
// leaseEnd is the end time of the lease in seconds since the epoch.
// secret is the secret used to generate the randflake id. (must be 16 bytes long)
func NewGenerator(nodeID int64, leaseStart int64, leaseEnd int64, secret []byte) (*Generator, error) {
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

	if len(secret) != 16 {
		return nil, ErrInvalidSecret
	}

	g := Generator{
		leaseStart: leaseStart,
		leaseEnd:   atomic.Int64{},
		nodeID:     nodeID,
		sequence:   atomic.Int64{},
		rollover:   atomic.Int64{},
		sbox:       sparx64.NewSparx64(secret),
	}
	g.leaseEnd.Store(leaseEnd)
	g.rollover.Store(leaseStart)

	return &g, nil
}

// UpdateLease updates the lease end time and returns true if the lease was updated.
//
// the leaseStart must equal to the leaseStart of the generator.
// the leaseEnd must be greater than the leaseStart.
// the leaseEnd must be less than or equal to the maximum timestamp (2058-11-05 17:10:23 UTC).
// the leaseEnd must be greater than the current leaseEnd.
func (g *Generator) UpdateLease(leaseStart, leaseEnd int64) bool {
	if leaseStart != g.leaseStart {
		return false
	}

	if leaseEnd < leaseStart {
		return false
	}

	if leaseEnd > RANDFLAKE_MAX_TIMESTAMP {
		return false
	}

	current := g.leaseEnd.Load()
	if current < leaseEnd {
		if g.leaseEnd.CompareAndSwap(current, leaseEnd) {
			return true
		}
	}
	return false
}

func (g *Generator) newRAW() (int64, error) {
	for {
		var now int64
		if g.TimeSource != nil {
			now = g.TimeSource()
		} else {
			now = time.Now().Unix()
		}

		if now < g.leaseStart {
			return 0, ErrInvalidLease
		}

		if now > g.leaseEnd.Load() {
			return 0, ErrInvalidLease
		}

		ctr := g.sequence.Add(1)
		if ctr > RANDFLAKE_MAX_SEQUENCE {
			last_rollover := g.rollover.Load()
			if now > last_rollover {
				if !g.rollover.CompareAndSwap(last_rollover, now) {
					continue
				}
				g.sequence.Store(0)
				ctr = 0
			} else {
				if now < last_rollover {
					return 0, ErrConsistencyViolation
				}
				return 0, ErrResourceExhausted
			}
		}

		timestamp := int64(now - RANDFLAKE_EPOCH_OFFSET)
		nodeID := int64(g.nodeID)
		sequence := int64(ctr)

		return ((timestamp << (RANDFLAKE_NODE_BITS + RANDFLAKE_SEQUENCE_BITS)) |
			(nodeID << RANDFLAKE_SEQUENCE_BITS) |
			sequence), nil
	}
}

// Generate generates a unique, encrypted ID.
func (g *Generator) Generate() (int64, error) {
	id, err := g.newRAW()
	if err != nil {
		return 0, err
	}

	var b [8]byte
	binary.LittleEndian.PutUint64(b[:], uint64(id))
	g.sbox.Encrypt(b[:], b[:])
	return int64(binary.LittleEndian.Uint64(b[:])), nil
}

// Inspect returns the timestamp, node ID, and sequence number of the given ID.
func (g *Generator) Inspect(id int64) (timestamp int64, nodeID int64, sequence int64, err error) {
	var b [8]byte
	binary.LittleEndian.PutUint64(b[:], uint64(id))
	g.sbox.Decrypt(b[:], b[:])
	id = int64(binary.LittleEndian.Uint64(b[:]))
	if id < 0 {
		return 0, 0, 0, ErrInvalidLease
	}
	timestamp = (id >> (RANDFLAKE_NODE_BITS + RANDFLAKE_SEQUENCE_BITS)) + RANDFLAKE_EPOCH_OFFSET
	nodeID = (id >> RANDFLAKE_SEQUENCE_BITS) & RANDFLAKE_MAX_NODE
	sequence = id & RANDFLAKE_MAX_SEQUENCE
	return
}
