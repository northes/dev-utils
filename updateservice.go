package main

import (
	"context"
	"errors"
	"log"
	"sync"
	"time"

	"github.com/wailsapp/wails/v3/pkg/updater"
)

const (
	autoCheckInitialDelay = 30 * time.Second
	autoCheckInterval     = 24 * time.Hour
)

type UpdateService struct {
	mu             sync.RWMutex
	checkMu        sync.Mutex
	updater        *updater.Updater
	currentVersion string
	autoEnabled    bool
	wake           chan struct{}
	stop           chan struct{}
	done           chan struct{}
	stopOnce       sync.Once
}

func NewUpdateService(version string) *UpdateService {
	return &UpdateService{currentVersion: version, wake: make(chan struct{}, 1), stop: make(chan struct{}), done: make(chan struct{})}
}

func (s *UpdateService) ServiceName() string       { return "UpdateService" }
func (s *UpdateService) GetCurrentVersion() string { return s.currentVersion }

func (s *UpdateService) start(u *updater.Updater, enabled bool) {
	s.mu.Lock()
	s.updater = u
	s.autoEnabled = enabled
	s.mu.Unlock()
	go s.loop()
}

func (s *UpdateService) SetAutoCheckEnabled(enabled bool) {
	s.mu.Lock()
	changed := s.autoEnabled != enabled
	s.autoEnabled = enabled
	s.mu.Unlock()
	if changed {
		select {
		case s.wake <- struct{}{}:
		default:
		}
	}
}

func (s *UpdateService) CheckForUpdates() error {
	s.checkMu.Lock()
	defer s.checkMu.Unlock()
	u := s.getUpdater()
	if u == nil {
		return errors.New("更新服务尚未初始化")
	}
	return u.CheckAndInstall(context.Background())
}

func (s *UpdateService) stopScheduler() {
	s.stopOnce.Do(func() { close(s.stop) })
	<-s.done
}

func (s *UpdateService) loop() {
	defer close(s.done)
	timer := time.NewTimer(s.nextDelay())
	defer timer.Stop()
	for {
		select {
		case <-timer.C:
			if s.isAutoEnabled() {
				s.checkAutomatically()
			}
			timer.Reset(autoCheckInterval)
		case <-s.wake:
			if !timer.Stop() {
				select {
				case <-timer.C:
				default:
				}
			}
			timer.Reset(s.nextDelay())
		case <-s.stop:
			return
		}
	}
}

func (s *UpdateService) nextDelay() time.Duration {
	if s.isAutoEnabled() {
		return autoCheckInitialDelay
	}
	return autoCheckInterval
}

func (s *UpdateService) checkAutomatically() {
	s.checkMu.Lock()
	defer s.checkMu.Unlock()
	u := s.getUpdater()
	if u == nil {
		return
	}
	release, err := u.Check(context.Background())
	if err != nil {
		log.Printf("自动检查更新失败: %v", err)
		return
	}
	if release != nil {
		if err := u.CheckAndInstall(context.Background()); err != nil {
			log.Printf("准备自动更新失败: %v", err)
		}
	}
}

func (s *UpdateService) getUpdater() *updater.Updater {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.updater
}

func (s *UpdateService) isAutoEnabled() bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.autoEnabled
}
