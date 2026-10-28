package wow

import (
	"slices"
	"testing"
	"time"

	"Meld/internal/testclient"
)

// pickEvenly returns n entries of list spread evenly through the sorted list, so the benchmark
// builds the same assets on every run of the same client.
func pickEvenly(list []string, n int) []string {
	s := slices.Clone(list)
	slices.Sort(s)
	if len(s) <= n {
		return s
	}
	out := make([]string, 0, n)
	for i := range n {
		out = append(out, s[i*len(s)/n])
	}
	return out
}

// benchBuilds times the asset server's cold builds of a fixed spread of assets of one kind
// ("wmo" or "m2"): Model and Collision on a fresh Client each iteration, so nothing is cached.
// Client.Open stays outside the timer. Reported as model-ms/op and collision-ms/op.
func benchBuilds(b *testing.B, kind string, n int) {
	dir := testclient.DataDir(b)
	first := NewClient()
	if err := first.Open(dir); err != nil {
		b.Fatal(err)
	}
	paths := pickEvenly(first.List(kind), n)
	if len(paths) == 0 {
		b.Skipf("the client lists no %s files", kind)
	}
	var model, coll time.Duration
	built := 0
	for b.Loop() {
		b.StopTimer()
		c := NewClient()
		if err := c.Open(dir); err != nil {
			b.Fatal(err)
		}
		b.StartTimer()
		built = 0
		for _, p := range paths {
			t0 := time.Now()
			_, err := c.Model(p, Look{})
			model += time.Since(t0)
			if err != nil {
				continue
			}
			built++
			t1 := time.Now()
			_, _ = c.Collision(p, 0)
			coll += time.Since(t1)
		}
	}
	b.ReportMetric(float64(model.Milliseconds())/float64(b.N), "model-ms/op")
	b.ReportMetric(float64(coll.Milliseconds())/float64(b.N), "collision-ms/op")
	b.ReportMetric(float64(built), "built")
}

// BenchmarkWMOBuild times 100 WMOs' cold Model and Collision builds. It is the measure for
// asset-server (Go) optimizations: perf-wmo's loadMs is dominated by the frontend and hides them.
// WOW_DIR=/path/to/client go test ./internal/wow/ -bench WMOBuild -run x
func BenchmarkWMOBuild(b *testing.B) { benchBuilds(b, "wmo", 100) }

// BenchmarkM2Build is BenchmarkWMOBuild for 300 M2s.
// WOW_DIR=/path/to/client go test ./internal/wow/ -bench M2Build -run x
func BenchmarkM2Build(b *testing.B) { benchBuilds(b, "m2", 300) }
