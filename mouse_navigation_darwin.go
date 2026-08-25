//go:build darwin

package main

/*
#cgo CFLAGS: -mmacosx-version-min=10.13 -x objective-c -fobjc-arc
#cgo LDFLAGS: -framework Cocoa -mmacosx-version-min=10.13

#import <Cocoa/Cocoa.h>

extern void devutilsMouseNavigationSwipeCallback(int direction, int phase);

static id devutilsMouseNavigationMonitor = nil;

static void devutilsInstallMouseNavigationMonitorOnMain(void) {
	if (devutilsMouseNavigationMonitor != nil) {
		return;
	}

	devutilsMouseNavigationMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskAny
		handler:^NSEvent *(NSEvent *event) {
			if ([event type] != NSEventTypeSwipe) {
				return event;
			}
			CGFloat deltaX = [event deltaX];
			int direction = deltaX < 0 ? 1 : (deltaX > 0 ? 2 : 0);
			devutilsMouseNavigationSwipeCallback(direction, (int)[event phase]);
			return nil;
		}];
}

static void devutilsInstallMouseNavigationMonitor(void) {
	if ([NSThread isMainThread]) {
		devutilsInstallMouseNavigationMonitorOnMain();
		return;
	}
	dispatch_sync(dispatch_get_main_queue(), ^{
		devutilsInstallMouseNavigationMonitorOnMain();
	});
}

static void devutilsRemoveMouseNavigationMonitor(void) {
	if (devutilsMouseNavigationMonitor == nil) {
		return;
	}
	[NSEvent removeMonitor:devutilsMouseNavigationMonitor];
	devutilsMouseNavigationMonitor = nil;
}
*/
import "C"

import "sync"

var mouseNavigationMu sync.RWMutex
var mouseNavigationSwipeHandler func(int, int)

func installMouseNavigationMonitor() {
	C.devutilsInstallMouseNavigationMonitor()
}

func installMouseNavigationSwipeMonitor(handler func(int, int)) {
	mouseNavigationMu.Lock()
	mouseNavigationSwipeHandler = handler
	mouseNavigationMu.Unlock()
}

func removeMouseNavigationMonitor() {
	C.devutilsRemoveMouseNavigationMonitor()
	mouseNavigationMu.Lock()
	mouseNavigationSwipeHandler = nil
	mouseNavigationMu.Unlock()
}

//export devutilsMouseNavigationSwipeCallback
func devutilsMouseNavigationSwipeCallback(direction C.int, phase C.int) {
	mouseNavigationMu.RLock()
	handler := mouseNavigationSwipeHandler
	mouseNavigationMu.RUnlock()
	if handler != nil {
		go handler(int(direction), int(phase))
	}
}
