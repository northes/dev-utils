package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sync"
)

type Config struct {
	TrayMatchEnabled bool   `json:"trayMatchEnabled"`
	AutoOverwrite    bool   `json:"autoOverwrite"`
	DetectJson       bool   `json:"detectJson"`
	DetectTimestamp  bool   `json:"detectTimestamp"`
	DetectUrl        bool   `json:"detectUrl"`
	DetectJwt        bool   `json:"detectJwt"`
	Language         string `json:"language"`
}

func defaultConfig() Config {
	return Config{
		TrayMatchEnabled: true,
		AutoOverwrite:    true,
		DetectJson:       true,
		DetectTimestamp:  true,
		DetectUrl:        true,
		DetectJwt:        true,
		Language:         "zh-CN",
	}
}

func configPath() string {
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "DevUtils", "config.json")
	}
	return filepath.Join(os.TempDir(), "devutils-config.json")
}

type ConfigService struct {
	mu   sync.Mutex
	path string
	cfg  Config
}

func NewConfigService() *ConfigService {
	cfg := defaultConfig()
	path := configPath()
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &cfg)
	}
	return &ConfigService{path: path, cfg: cfg}
}

func (s *ConfigService) ServiceName() string { return "ConfigService" }

func (s *ConfigService) GetAppName() string { return appName }

func (s *ConfigService) Get() Config {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.cfg
}

func (s *ConfigService) Save(cfg Config) {
	s.mu.Lock()
	s.cfg = cfg
	path := s.path
	s.mu.Unlock()
	b, err := json.Marshal(cfg)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, b, 0o600)
}
