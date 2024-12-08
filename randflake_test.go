package randflake

import (
	"crypto/rand"
	"encoding/binary"
	"sync/atomic"
	"testing"
	"time"

	"gosuda.org/randflake/sparx64"
)

func TestNewGenerator(t *testing.T) {
	tests := []struct {
		name       string
		nodeID     int64
		leaseStart int64
		leaseEnd   int64
		secret     []byte
		wantErr    error
	}{
		{
			name:       "valid generator",
			nodeID:     1,
			leaseStart: RANDFLAKE_EPOCH_OFFSET + 1,
			leaseEnd:   RANDFLAKE_EPOCH_OFFSET + 3600,
			secret:     make([]byte, 16),
			wantErr:    nil,
		},
		{
			name:       "invalid node ID - negative",
			nodeID:     -1,
			leaseStart: RANDFLAKE_EPOCH_OFFSET + 1,
			leaseEnd:   RANDFLAKE_EPOCH_OFFSET + 3600,
			secret:     make([]byte, 16),
			wantErr:    ErrInvalidNode,
		},
		{
			name:       "invalid node ID - too large",
			nodeID:     RANDFLAKE_MAX_NODE + 1,
			leaseStart: RANDFLAKE_EPOCH_OFFSET + 1,
			leaseEnd:   RANDFLAKE_EPOCH_OFFSET + 3600,
			secret:     make([]byte, 16),
			wantErr:    ErrInvalidNode,
		},
		{
			name:       "invalid lease - end before start",
			nodeID:     1,
			leaseStart: RANDFLAKE_EPOCH_OFFSET + 3600,
			leaseEnd:   RANDFLAKE_EPOCH_OFFSET + 1,
			secret:     make([]byte, 16),
			wantErr:    ErrInvalidLease,
		},
		{
			name:       "invalid lease - start before epoch",
			nodeID:     1,
			leaseStart: RANDFLAKE_EPOCH_OFFSET - 1,
			leaseEnd:   RANDFLAKE_EPOCH_OFFSET + 3600,
			secret:     make([]byte, 16),
			wantErr:    ErrInvalidLease,
		},
		{
			name:       "invalid lease - end after max timestamp",
			nodeID:     1,
			leaseStart: RANDFLAKE_EPOCH_OFFSET + 1,
			leaseEnd:   RANDFLAKE_MAX_TIMESTAMP + RANDFLAKE_EPOCH_OFFSET + 1,
			secret:     make([]byte, 16),
			wantErr:    ErrRandflakeDead,
		},
		{
			name:       "invalid secret length",
			nodeID:     1,
			leaseStart: RANDFLAKE_EPOCH_OFFSET + 1,
			leaseEnd:   RANDFLAKE_EPOCH_OFFSET + 3600,
			secret:     make([]byte, 15),
			wantErr:    ErrInvalidSecret,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := NewGenerator(tt.nodeID, tt.leaseStart, tt.leaseEnd, tt.secret)
			if err != tt.wantErr {
				t.Errorf("NewGenerator() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func TestGenerator_UpdateLease(t *testing.T) {
	secret := make([]byte, 16)
	leaseStart := int64(RANDFLAKE_EPOCH_OFFSET + 1)
	leaseEnd := int64(RANDFLAKE_EPOCH_OFFSET + 3600)

	g, err := NewGenerator(1, leaseStart, leaseEnd, secret)
	if err != nil {
		t.Fatalf("Failed to create generator: %v", err)
	}

	tests := []struct {
		name       string
		leaseStart int64
		leaseEnd   int64
		want       bool
	}{
		{
			name:       "valid update",
			leaseStart: leaseStart,
			leaseEnd:   leaseEnd + 3600,
			want:       true,
		},
		{
			name:       "invalid start time",
			leaseStart: leaseStart + 1,
			leaseEnd:   leaseEnd + 7200,
			want:       false,
		},
		{
			name:       "end before start",
			leaseStart: leaseStart,
			leaseEnd:   leaseStart - 1,
			want:       false,
		},
		{
			name:       "end after max timestamp",
			leaseStart: leaseStart,
			leaseEnd:   RANDFLAKE_MAX_TIMESTAMP + RANDFLAKE_EPOCH_OFFSET + 1,
			want:       false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := g.UpdateLease(tt.leaseStart, tt.leaseEnd); got != tt.want {
				t.Errorf("Generator.UpdateLease() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestGenerator_Generate(t *testing.T) {
	secret := make([]byte, 16)
	leaseStart := int64(RANDFLAKE_EPOCH_OFFSET + 1)
	leaseEnd := int64(RANDFLAKE_EPOCH_OFFSET + 3600)

	g, err := NewGenerator(1, leaseStart, leaseEnd, secret)
	if err != nil {
		t.Fatalf("Failed to create generator: %v", err)
	}

	// Test ID generation and uniqueness
	seen := make(map[int64]bool)
	for i := 0; i < 1000; i++ {
		id, err := g.Generate()
		if err != nil {
			t.Fatalf("Failed to generate ID: %v", err)
		}
		if seen[id] {
			t.Errorf("Generated duplicate ID: %d", id)
		}
		seen[id] = true
	}
}

func TestGenerator_GenerateErrors(t *testing.T) {
	secret := make([]byte, 16)
	now := time.Now().Unix()

	tests := []struct {
		name       string
		nodeID     int64
		leaseStart int64
		leaseEnd   int64
		timeSource func() int64
		wantErr    error
	}{
		{
			name:       "time before lease start",
			nodeID:     1,
			leaseStart: now + 3600,
			leaseEnd:   now + 7200,
			timeSource: func() int64 { return now },
			wantErr:    ErrInvalidLease,
		},
		{
			name:       "time after lease end",
			nodeID:     1,
			leaseStart: now - 7200,
			leaseEnd:   now - 3600,
			timeSource: func() int64 { return now },
			wantErr:    ErrInvalidLease,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			g, err := NewGenerator(tt.nodeID, tt.leaseStart, tt.leaseEnd, secret)
			if err != nil {
				t.Fatalf("Failed to create generator: %v", err)
			}
			g.TimeSource = tt.timeSource

			_, err = g.Generate()
			if err != tt.wantErr {
				t.Errorf("Generator.Generate() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

func BenchmarkGenerator_GenerateParallel(b *testing.B) {
	secret := make([]byte, 16)
	now := time.Now().Unix()

	var nodeid atomic.Int64

	b.SetBytes(1)
	b.ResetTimer()
	b.RunParallel(func(pb *testing.PB) {
		var generators [32]*Generator
		for i := 0; i < 32; i++ {
			g, err := NewGenerator(nodeid.Add(1), now-3600, now+3600, secret)
			if err != nil {
				b.Fatalf("Failed to create generator: %v", err)
			}
			generators[i] = g
		}
		var cursor int

		for pb.Next() {
			_, err := generators[cursor].Generate()
			if err != nil {
				cursor = (cursor + 1) % 32
				_, err := generators[cursor].Generate()
				if err != nil {
					b.Fatalf("Failed to generate ID: %v", err)
				}
			}
		}
	})
}

func TestGenerator_Inspect(t *testing.T) {
	secret := make([]byte, 16)
	rand.Read(secret)
	sbox := sparx64.NewSparx64(secret)

	timestamp := int64(1234528)
	nodeID := int64(1)
	counter := int64(12345)
	raw := timestamp<<34 | nodeID<<17 | counter

	var b [8]byte
	binary.LittleEndian.PutUint64(b[:], uint64(raw))
	sbox.Encrypt(b[:], b[:])
	id := int64(binary.LittleEndian.Uint64(b[:]))

	g, err := NewGenerator(nodeID, RANDFLAKE_EPOCH_OFFSET+timestamp-3600, RANDFLAKE_EPOCH_OFFSET+timestamp+3600, secret)
	if err != nil {
		t.Fatalf("Failed to create generator: %v", err)
	}

	timestamp2, nodeID2, counter2, err := g.Inspect(id)
	if err != nil {
		t.Fatalf("Failed to inspect ID: %v", err)
	}

	if timestamp2 != timestamp+RANDFLAKE_EPOCH_OFFSET {
		t.Errorf("Expected timestamp %d, got %d", timestamp+RANDFLAKE_EPOCH_OFFSET, timestamp2)
	}

	if nodeID2 != nodeID {
		t.Errorf("Expected node ID %d, got %d", nodeID, nodeID2)
	}

	if counter2 != counter {
		t.Errorf("Expected counter %d, got %d", counter, counter2)
	}
}
