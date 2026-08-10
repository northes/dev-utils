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
	SidebarMode      string `json:"sidebarMode"`
	Theme            string `json:"theme"`
}

type HistoryItem struct {
	ID     int64  `json:"id"`
	Tool   string `json:"tool"`
	Action string `json:"action"`
	Detail string `json:"detail"`
	Input  string `json:"input"`
	At     string `json:"at"`
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
		SidebarMode:      "full",
		Theme:            "dark",
	}
}

func configPath() string {
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "DevUtils", "config.json")
	}
	return filepath.Join(os.TempDir(), "devutils-config.json")
}

func historyPath() string {
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "DevUtils", "history.json")
	}
	return filepath.Join(os.TempDir(), "devutils-history.json")
}

type ConfigService struct {
	mu          sync.Mutex
	path        string
	historyPath string
	cfg         Config
	history     []HistoryItem
}

func NewConfigService() *ConfigService {
	cfg := defaultConfig()
	path := configPath()
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &cfg)
	}
	historyPath := historyPath()
	var history []HistoryItem
	if b, err := os.ReadFile(historyPath); err == nil {
		_ = json.Unmarshal(b, &history)
	}
	return &ConfigService{path: path, historyPath: historyPath, cfg: cfg, history: history}
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

func (s *ConfigService) GetHistory() []HistoryItem {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]HistoryItem(nil), s.history...)
}

func (s *ConfigService) SaveHistory(history []HistoryItem) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.history = append([]HistoryItem(nil), history...)
	path := s.historyPath
	b, err := json.Marshal(history)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(path), 0o755)
	_ = os.WriteFile(path, b, 0o600)
}
