package main

import (
	"testing"
	"time"
)

func TestCloseAsksWhileAMapIsUnsaved(t *testing.T) {
	a := &App{}
	t0 := time.Unix(1000, 0)
	if a.stopClose(t0) {
		t.Fatal("stopped a close with every map saved")
	}
	a.SetUnsaved(true)
	if !a.stopClose(t0) {
		t.Fatal("closed with an unsaved map")
	}
	// The frontend showed the dialog; the author cancels and closes again much later.
	a.AckClose()
	if !a.stopClose(t0.Add(time.Minute)) {
		t.Fatal("a later close after an answered one went through")
	}
	// No answer this time (a hung frontend): a quick second close is still stopped, a later one not.
	if !a.stopClose(t0.Add(time.Minute + closeAckWait/2)) {
		t.Fatal("a quick second close went through")
	}
	if a.stopClose(t0.Add(time.Minute + closeAckWait/2 + closeAckWait + time.Millisecond)) {
		t.Fatal("an unanswered close kept the window open")
	}
	// Quit without saving clears the flag first.
	a.SetUnsaved(false)
	if a.stopClose(t0.Add(time.Hour)) {
		t.Fatal("stopped the quit")
	}
}
