package randflake

import (
	"errors"
	"testing"
)

func TestLegacyRejectsRollbackAfterRollover(t *testing.T) {
	const start int64 = 1770000000
	now := start
	g, err := NewGenerator(42, start, start+10, make([]byte, 16))
	if err != nil {
		t.Fatal(err)
	}
	g.TimeSource = func() int64 { return now }
	for range RANDFLAKE_MAX_SEQUENCE {
		if _, err := g.Generate(); err != nil {
			t.Fatal(err)
		}
	}
	now++
	if _, err := g.Generate(); err != nil {
		t.Fatal(err)
	}
	now--
	if _, err := g.Generate(); !errors.Is(err, ErrConsistencyViolation) {
		t.Fatalf("rollback error = %v, want ErrConsistencyViolation", err)
	}
	now++
	id, err := g.Generate()
	if err != nil {
		t.Fatal(err)
	}
	_, _, sequence, err := g.Inspect(id)
	if err != nil || sequence != 1 {
		t.Fatalf("resumed sequence = %d, error = %v; want 1", sequence, err)
	}
}

func TestLegacySupportsUpperHalfOfTimestampRange(t *testing.T) {
	for _, timestamp := range []int64{RANDFLAKE_EPOCH_OFFSET + 1<<29, RANDFLAKE_MAX_TIMESTAMP} {
		g, err := NewGenerator(RANDFLAKE_MAX_NODE, timestamp, timestamp, make([]byte, 16))
		if err != nil {
			t.Fatal(err)
		}
		g.TimeSource = func() int64 { return timestamp }
		id, err := g.Generate()
		if err != nil {
			t.Fatal(err)
		}
		gotTime, node, sequence, err := g.Inspect(id)
		if err != nil || gotTime != timestamp || node != RANDFLAKE_MAX_NODE || sequence != 0 {
			t.Fatalf("Inspect at %d = (%d, %d, %d, %v)", timestamp, gotTime, node, sequence, err)
		}
	}
}
