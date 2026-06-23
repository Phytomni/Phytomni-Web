package cache

import (
	"context"
	"testing"
)

func TestAvailable_TrueWhenRedisUp(t *testing.T) {
	startMiniredis(t)
	if err := InitFromViper(); err != nil {
		t.Fatalf("init: %v", err)
	}
	if !Available(context.Background()) {
		t.Error("Available should be true when miniredis is up and initialized")
	}
}

func TestAvailable_FalseWhenNotInitialized(t *testing.T) {
	// No InitFromViper / no client registered.
	clients = nil
	if Available(context.Background()) {
		t.Error("Available must be false when no client is registered")
	}
}
