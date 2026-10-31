package main

import "testing"

func TestDebugPortArgs(t *testing.T) {
	cases := map[string]int{"": 0, "0": 0, "abc": 0, "70000": 0, "9333": 1, " 9333 ": 1}
	for in, want := range cases {
		t.Setenv(debugPortEnv, in)
		if got := debugPortArgs(); len(got) != want {
			t.Errorf("%q: got %v", in, got)
		}
	}
	t.Setenv(debugPortEnv, "9333")
	if got := debugPortArgs(); got[0] != "--remote-debugging-port=9333" {
		t.Errorf("got %v", got)
	}
}
