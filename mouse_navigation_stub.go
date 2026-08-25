//go:build !darwin

package main

func installMouseNavigationMonitor() {}

func installMouseNavigationSwipeMonitor(func(int, int)) {}

func removeMouseNavigationMonitor() {}
