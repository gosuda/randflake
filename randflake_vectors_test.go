package randflake

import (
	"encoding/hex"
	"encoding/json"
	"flag"
	"os"
	"reflect"
	"strconv"
	"testing"
)

var updateTestVectors = flag.Bool("update-test-vectors", false, "write canonical randflake test vectors to test_vectors.json")

type randflakeVector struct {
	Secret      string `json:"secret"`
	NodeID      int64  `json:"node_id"`
	LeaseStart  int64  `json:"lease_start"`
	LeaseEnd    int64  `json:"lease_end"`
	Timestamp   int64  `json:"timestamp"`
	Sequence    int64  `json:"sequence"`
	RawID       string `json:"raw_id"`
	EncryptedID string `json:"encrypted_id"`
	EncodedID   string `json:"encoded_id"`
}

type randflakeVectorSpec struct {
	secret     string
	nodeID     int64
	leaseStart int64
	leaseEnd   int64
	timestamp  int64
	sequence   int64
}

func TestRandflakeTestVectors(t *testing.T) {
	vectors := buildRandflakeVectors(t)

	if *updateTestVectors || os.Getenv("RANDFLAKE_UPDATE_TEST_VECTORS") == "1" {
		writeRandflakeVectors(t, "test_vectors.json", vectors)
	}

	data, err := os.ReadFile("test_vectors.json")
	if err != nil {
		t.Fatalf("read test_vectors.json: %v (regenerate with `go test . -run TestRandflakeTestVectors -update-test-vectors`)", err)
	}

	var actual []randflakeVector
	if err := json.Unmarshal(data, &actual); err != nil {
		t.Fatalf("parse test_vectors.json: %v", err)
	}

	if !reflect.DeepEqual(actual, vectors) {
		expectedJSON, err := json.MarshalIndent(vectors, "", "  ")
		if err != nil {
			t.Fatalf("marshal expected vectors: %v", err)
		}
		t.Fatalf("test_vectors.json is stale or incorrect; regenerate with `go test . -run TestRandflakeTestVectors -update-test-vectors`\nexpected:\n%s", expectedJSON)
	}
}

func buildRandflakeVectors(t *testing.T) []randflakeVector {
	t.Helper()

	maxPositiveTimestamp := int64(RANDFLAKE_EPOCH_OFFSET + (1 << 29) - 1)
	specs := []randflakeVectorSpec{
		// Canonical compatibility case from the README and existing language tests.
		{"dffd6021bb2bd5b0af676290809ec3a5", 42, 1730000000, 1735000000, 1733706297, 1},
		// Edge values and representative secrets.
		{"00000000000000000000000000000000", 0, RANDFLAKE_EPOCH_OFFSET, RANDFLAKE_EPOCH_OFFSET + 10, RANDFLAKE_EPOCH_OFFSET + 1, 0},
		{"ffffffffffffffffffffffffffffffff", RANDFLAKE_MAX_NODE, RANDFLAKE_EPOCH_OFFSET, RANDFLAKE_EPOCH_OFFSET + 10, RANDFLAKE_EPOCH_OFFSET + 2, RANDFLAKE_MAX_SEQUENCE},
		{"000102030405060708090a0b0c0d0e0f", 1, RANDFLAKE_EPOCH_OFFSET, RANDFLAKE_EPOCH_OFFSET + 1000, RANDFLAKE_EPOCH_OFFSET + 123, 1},
		{"0f0e0d0c0b0a09080706050403020100", 131070, RANDFLAKE_EPOCH_OFFSET + 1, RANDFLAKE_EPOCH_OFFSET + 5000, RANDFLAKE_EPOCH_OFFSET + 4567, 131070},
		{"73757065722d7365637265742d6b6579", 7, 1730500000, 1732500000, 1731234567, 42},
		{"00112233445566778899aabbccddeeff", 65535, 1731000000, 1739000000, 1737654321, 65535},
		{"ffeeddccbbaa99887766554433221100", 65536, 1732000000, 1740000000, 1738888888, 65536},
		{"0123456789abcdeffedcba9876543210", 12345, 1740000000, 1748000000, 1745678901, 12345},
		{"89abcdef0123456776543210fedcba98", 98765, 1750000000, 1758000000, 1753456789, 98765},
		{"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", 2, 1760000000, 1765000000, 1762345678, 2},
		{"55555555555555555555555555555555", 131071, 1770000000, 1779000000, 1777777777, 0},
		{"31415926535897932384626433832795", 31415, 1800000000, 1810000000, 1803141592, 65358},
		{"27182818284590452353602874713526", 27182, 1850000000, 1860000000, 1852718281, 84590},
		{"11235813213455891442333776109871", 1098, 1900000000, 1910000000, 1901123581, 33776},
		{"fedcba98765432100123456789abcdef", RANDFLAKE_MAX_NODE, maxPositiveTimestamp - 10, maxPositiveTimestamp, maxPositiveTimestamp, RANDFLAKE_MAX_SEQUENCE},
	}

	vectors := make([]randflakeVector, 0, len(specs))
	for _, spec := range specs {
		vectors = append(vectors, buildRandflakeVector(t, spec))
	}
	return vectors
}

func buildRandflakeVector(t *testing.T, spec randflakeVectorSpec) randflakeVector {
	t.Helper()

	secret, err := hex.DecodeString(spec.secret)
	if err != nil {
		t.Fatalf("decode secret %q: %v", spec.secret, err)
	}

	generator, err := NewGenerator(spec.nodeID, spec.leaseStart, spec.leaseEnd, secret)
	if err != nil {
		t.Fatalf("new generator for vector %+v: %v", spec, err)
	}
	prepareGeneratorForVector(generator, spec)

	encryptedID, err := generator.Generate()
	if err != nil {
		t.Fatalf("generate vector %+v: %v", spec, err)
	}

	encodedID := EncodeString(encryptedID)
	timestamp, nodeID, sequence, err := generator.Inspect(encryptedID)
	if err != nil {
		t.Fatalf("inspect encrypted vector %+v: %v", spec, err)
	}
	if timestamp != spec.timestamp || nodeID != spec.nodeID || sequence != spec.sequence {
		t.Fatalf("inspect encrypted vector %+v = (%d, %d, %d), want (%d, %d, %d)", spec, timestamp, nodeID, sequence, spec.timestamp, spec.nodeID, spec.sequence)
	}

	stringTimestamp, stringNodeID, stringSequence, err := generator.InspectString(encodedID)
	if err != nil {
		t.Fatalf("inspect encoded vector %+v: %v", spec, err)
	}
	if stringTimestamp != spec.timestamp || stringNodeID != spec.nodeID || stringSequence != spec.sequence {
		t.Fatalf("inspect encoded vector %+v = (%d, %d, %d), want (%d, %d, %d)", spec, stringTimestamp, stringNodeID, stringSequence, spec.timestamp, spec.nodeID, spec.sequence)
	}

	decodedID, err := DecodeString(encodedID)
	if err != nil {
		t.Fatalf("decode encoded vector %+v: %v", spec, err)
	}
	if decodedID != encryptedID {
		t.Fatalf("decode encoded vector %+v = %d, want %d", spec, decodedID, encryptedID)
	}

	rawID := composeRawID(spec.timestamp, spec.nodeID, spec.sequence)
	return randflakeVector{
		Secret:      spec.secret,
		NodeID:      spec.nodeID,
		LeaseStart:  spec.leaseStart,
		LeaseEnd:    spec.leaseEnd,
		Timestamp:   spec.timestamp,
		Sequence:    spec.sequence,
		RawID:       strconv.FormatUint(rawID, 10),
		EncryptedID: strconv.FormatInt(encryptedID, 10),
		EncodedID:   encodedID,
	}
}

func prepareGeneratorForVector(generator *Generator, spec randflakeVectorSpec) {
	if spec.sequence == 0 {
		generator.sequence.Store(RANDFLAKE_MAX_SEQUENCE)
		generator.rollover.Store(spec.timestamp - 1)
	} else {
		generator.sequence.Store(spec.sequence - 1)
		generator.rollover.Store(spec.leaseStart)
	}
	generator.TimeSource = func() int64 { return spec.timestamp }
}

func composeRawID(timestamp, nodeID, sequence int64) uint64 {
	timestampOffset := uint64(timestamp - RANDFLAKE_EPOCH_OFFSET)
	return timestampOffset<<(RANDFLAKE_NODE_BITS+RANDFLAKE_SEQUENCE_BITS) |
		uint64(nodeID)<<RANDFLAKE_SEQUENCE_BITS |
		uint64(sequence)
}

func writeRandflakeVectors(t *testing.T, path string, vectors []randflakeVector) {
	t.Helper()

	data, err := json.MarshalIndent(vectors, "", "  ")
	if err != nil {
		t.Fatalf("marshal vectors: %v", err)
	}
	data = append(data, '\n')
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}
