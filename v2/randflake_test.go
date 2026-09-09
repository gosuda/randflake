package randflake_test

import (
	"errors"
	"fmt"
	"math"
	"sync"
	"sync/atomic"
	"testing"

	randflake "gosuda.org/randflake/v2"
)

var errClockOffline = errors.New("clock offline")

func newGenerator(t *testing.T, lease randflake.Lease, clock randflake.Clock) *randflake.Generator {
	t.Helper()
	g, err := randflake.New(randflake.Config{Lease: lease, Secret: make([]byte, 16), Clock: clock})
	if err != nil {
		t.Fatal(err)
	}
	return g
}

func TestSequenceCapacityAndClockFailure(t *testing.T) {
	const start randflake.UnixSeconds = 1770000000
	now := start
	clockErr := errClockOffline
	g := newGenerator(t, randflake.Lease{NodeID: 42, Start: start, EndExclusive: start + 10}, func() (randflake.UnixSeconds, error) { return now, clockErr })
	if _, err := g.Generate(); !errors.Is(err, errClockOffline) {
		t.Fatalf("clock error = %v", err)
	}
	clockErr = nil
	var last int64
	for sequence := range randflake.MaxSequence + 1 {
		id, err := g.Generate()
		if err != nil {
			t.Fatalf("sequence %d: %v", sequence, err)
		}
		last = id
		if sequence == 0 && g.Inspect(id).Sequence != 0 {
			t.Fatal("clock failure consumed a sequence")
		}
	}
	if got := g.Inspect(last).Sequence; got != randflake.MaxSequence {
		t.Fatalf("last sequence = %d", got)
	}
	if _, err := g.Generate(); !errors.Is(err, randflake.ErrResourceExhausted) {
		t.Fatalf("exhaustion = %v", err)
	}
	now++
	id, err := g.Generate()
	if err != nil {
		t.Fatal(err)
	}
	if parts := g.Inspect(id); parts.Timestamp != now || parts.Sequence != 0 {
		t.Fatalf("next second = %+v", parts)
	}
	now--
	if _, err := g.Generate(); !errors.Is(err, randflake.ErrConsistencyViolation) {
		t.Fatalf("rollback = %v", err)
	}
}

func TestHalfOpenLeaseHandoffAndExtension(t *testing.T) {
	const start randflake.UnixSeconds = 1770000000
	now := start + 1
	clock := func() (randflake.UnixSeconds, error) { return now, nil }
	lease := randflake.Lease{NodeID: 42, Start: start, EndExclusive: start + 1}
	old := newGenerator(t, lease, clock)
	next := newGenerator(t, randflake.Lease{NodeID: 42, Start: start + 1, EndExclusive: start + 2}, clock)
	if _, err := old.Generate(); !errors.Is(err, randflake.ErrInvalidLease) {
		t.Fatalf("old owner at handoff: %v", err)
	}
	if _, err := next.Generate(); err != nil {
		t.Fatalf("new owner at handoff: %v", err)
	}

	g := newGenerator(t, randflake.Lease{NodeID: 7, Start: start, EndExclusive: start + 2}, clock)
	copy := g.Lease()
	copy.EndExclusive = start + 100
	now = start + 2
	if _, err := g.Generate(); !errors.Is(err, randflake.ErrInvalidLease) {
		t.Fatalf("snapshot mutation changed lease: %v", err)
	}
	if err := g.ExtendLease(randflake.Lease{NodeID: 7, Start: start, EndExclusive: start + 4}); err != nil {
		t.Fatal(err)
	}
	if err := g.ExtendLease(randflake.Lease{NodeID: 7, Start: start, EndExclusive: start + 3}); err != nil {
		t.Fatalf("satisfied extension: %v", err)
	}
	now = start + 3
	if _, err := g.Generate(); err != nil {
		t.Fatalf("stale extension shortened lease: %v", err)
	}
	copy = g.Lease()
	copy.NodeID++
	if err := g.ExtendLease(copy); !errors.Is(err, randflake.ErrInvalidLease) {
		t.Fatalf("wrong node: %v", err)
	}
	copy = g.Lease()
	copy.Start++
	if err := g.ExtendLease(copy); !errors.Is(err, randflake.ErrInvalidLease) {
		t.Fatalf("wrong start: %v", err)
	}
}

func TestConcurrentExtensionsKeepGreatestEnd(t *testing.T) {
	const start randflake.UnixSeconds = 1770000000
	g := newGenerator(t, randflake.Lease{NodeID: 42, Start: start, EndExclusive: start + 1}, nil)
	var wg sync.WaitGroup
	for offset := range 32 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := g.ExtendLease(randflake.Lease{NodeID: 42, Start: start, EndExclusive: start + randflake.UnixSeconds(offset) + 2}); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if got := g.Lease().EndExclusive; got != start+33 {
		t.Fatalf("lease end = %d, want %d", got, start+33)
	}
}

func TestConcurrentGenerationAcrossSeconds(t *testing.T) {
	for _, advance := range []bool{false, true} {
		t.Run(fmt.Sprintf("advance=%v", advance), func(t *testing.T) {
			const start int64 = 1770000000
			var now atomic.Int64
			now.Store(start)
			g := newGenerator(t, randflake.Lease{NodeID: 42, Start: randflake.UnixSeconds(start), EndExclusive: randflake.UnixSeconds(start + 1000)}, func() (randflake.UnixSeconds, error) { return randflake.UnixSeconds(now.Load()), nil })
			const workers, count = 8, 1024
			results := make([][]int64, workers)
			var wg sync.WaitGroup
			for worker := range workers {
				wg.Add(1)
				go func() {
					defer wg.Done()
					ids := make([]int64, 0, count)
					for i := range count {
						id, err := g.Generate()
						if err != nil {
							t.Error(err)
							return
						}
						ids = append(ids, id)
						if advance && i%64 == 63 {
							now.Add(1)
						}
					}
					results[worker] = ids
				}()
			}
			wg.Wait()
			seen := make(map[int64]struct{}, workers*count)
			for _, ids := range results {
				for _, id := range ids {
					if _, exists := seen[id]; exists {
						t.Fatalf("duplicate ID %d", id)
					}
					seen[id] = struct{}{}
				}
			}
			if len(seen) != workers*count {
				t.Fatalf("generated %d IDs, want %d", len(seen), workers*count)
			}
		})
	}
}

func TestConcurrentNewerSecondResamplesStaleRead(t *testing.T) {
	const start randflake.UnixSeconds = 1770000000
	entered, release := make(chan struct{}), make(chan struct{})
	var calls atomic.Int64
	g := newGenerator(t, randflake.Lease{NodeID: 42, Start: start, EndExclusive: start + 10}, func() (randflake.UnixSeconds, error) {
		if calls.Add(1) == 1 {
			close(entered)
			<-release
			return start, nil
		}
		return start + 1, nil
	})
	type result struct {
		id  int64
		err error
	}
	done := make(chan result, 1)
	go func() { id, err := g.Generate(); done <- result{id, err} }()
	<-entered
	first, err := g.Generate()
	close(release)
	second := <-done
	if err != nil || second.err != nil {
		t.Fatalf("concurrent generation errors: %v, %v", err, second.err)
	}
	if first == second.id {
		t.Fatal("concurrent allocations reused an ID")
	}
	if parts := g.Inspect(second.id); parts.Timestamp != start+1 || parts.Sequence != 1 {
		t.Fatalf("resampled allocation = %+v", parts)
	}
}

func TestLeaseConstructionBoundaries(t *testing.T) {
	for _, lease := range []randflake.Lease{
		{NodeID: 0, Start: randflake.Epoch, EndExclusive: randflake.Epoch},
		{NodeID: 0, Start: randflake.Epoch - 1, EndExclusive: randflake.Epoch + 1},
		{NodeID: 0, Start: randflake.Epoch, EndExclusive: randflake.MaxTimestamp + 2},
	} {
		if _, err := randflake.New(randflake.Config{Lease: lease, Secret: make([]byte, 16)}); !errors.Is(err, randflake.ErrInvalidLease) {
			t.Fatalf("lease %+v: %v", lease, err)
		}
	}
	g := newGenerator(t, randflake.Lease{NodeID: randflake.MaxNodeID, Start: randflake.MaxTimestamp, EndExclusive: randflake.MaxTimestamp + 1}, func() (randflake.UnixSeconds, error) { return randflake.MaxTimestamp, nil })
	id, err := g.Generate()
	if err != nil {
		t.Fatal(err)
	}
	if parts := g.Inspect(id); parts.Timestamp != randflake.MaxTimestamp || parts.NodeID != randflake.MaxNodeID {
		t.Fatalf("maximum timestamp = %+v", parts)
	}
}

func TestCanonicalDecodeRejectsAlternateSpellings(t *testing.T) {
	for _, text := range []string{"", "00", "V", "1=ignored", "g000000000001", "10000000000000", "!"} {
		if _, err := randflake.DecodeString(text); !errors.Is(err, randflake.ErrInvalidID) {
			t.Errorf("DecodeString(%q) error = %v", text, err)
		}
	}
	for _, tc := range []struct {
		text string
		id   int64
	}{{"0", 0}, {"v", 31}, {"8000000000000", math.MinInt64}, {"fvvvvvvvvvvvv", -1}} {
		id, err := randflake.DecodeString(tc.text)
		if err != nil || id != tc.id {
			t.Errorf("DecodeString(%q) = %d, %v; want %d", tc.text, id, err, tc.id)
		}
	}
}
