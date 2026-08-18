package main

import (
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Config struct {
	TrayMatchEnabled        bool     `json:"trayMatchEnabled"`
	TrayMatchTools          []string `json:"trayMatchTools"`
	URLTrayMatchMigrated    bool     `json:"urlTrayMatchMigrated"`
	AutoOverwrite           bool     `json:"autoOverwrite"`
	AutoCheckUpdates        bool     `json:"autoCheckUpdates"`
	Language                string   `json:"language"`
	SidebarMode             string   `json:"sidebarMode"`
	Theme                   string   `json:"theme"`
	DiffHighlightMode       string   `json:"diffHighlightMode"`
	DiffClipboardTargetMode string   `json:"diffClipboardTargetMode"`
	CodeEditorFontSize      int      `json:"codeEditorFontSize"`
	TimeResultOrder         []string `json:"timeResultOrder"`
	HiddenTimeResults       []string `json:"hiddenTimeResults"`
}
type HistoryItem struct {
	ID        int64  `json:"id"`
	Tool      string `json:"tool"`
	Action    string `json:"action"`
	Detail    string `json:"detail"`
	At        string `json:"at"`
	Mode      string `json:"mode"`
	MediaType string `json:"mediaType"`
	Name      string `json:"name"`
	Bytes     int64  `json:"bytes"`
}
type HistoryContent struct {
	Input  string `json:"input"`
	Output string `json:"output"`
}
type HistoryEntry struct {
	Tool      string `json:"tool"`
	Action    string `json:"action"`
	Detail    string `json:"detail"`
	Mode      string `json:"mode"`
	MediaType string `json:"mediaType"`
	Name      string `json:"name"`
	Bytes     int64  `json:"bytes"`
	Input     string `json:"input"`
	Output    string `json:"output"`
}
type historyStored struct {
	Item HistoryItem `json:"item"`
	File string      `json:"file"`
}

func defaultConfig() Config {
	return Config{TrayMatchEnabled: true, TrayMatchTools: []string{"json", "time", "text", "base64", "diff", "jwt", "url"}, AutoOverwrite: true, AutoCheckUpdates: true, Language: "zh-CN", SidebarMode: "full", Theme: "default-dark", DiffHighlightMode: "character", DiffClipboardTargetMode: "alternate", CodeEditorFontSize: 12, TimeResultOrder: []string{"local", "dateTime", "dateOnly", "timeOnly", "zonedIso8601", "rfc3339", "utc", "compact", "underscore", "unixSeconds", "unixMilliseconds", "unixNanoseconds"}}
}
func normalizeConfig(cfg Config) Config {
	trayTools := []string{"json", "time", "text", "base64", "diff", "jwt", "url"}
	validTrayTool := make(map[string]bool, len(trayTools))
	for _, id := range trayTools {
		validTrayTool[id] = true
	}
	if cfg.TrayMatchTools == nil {
		cfg.TrayMatchTools = append([]string(nil), trayTools...)
	} else {
		matched := make([]string, 0, len(cfg.TrayMatchTools))
		seen := make(map[string]bool, len(trayTools))
		for _, id := range cfg.TrayMatchTools {
			if validTrayTool[id] && !seen[id] {
				matched = append(matched, id)
				seen[id] = true
			}
		}
		cfg.TrayMatchTools = matched
	}
	if !cfg.URLTrayMatchMigrated {
		seenURL := false
		for _, id := range cfg.TrayMatchTools {
			if id == "url" {
				seenURL = true
				break
			}
		}
		if !seenURL {
			cfg.TrayMatchTools = append(cfg.TrayMatchTools, "url")
		}
		cfg.URLTrayMatchMigrated = true
	}
	switch cfg.Theme {
	case "default-light", "default-dark", "violet-bloom-light", "violet-bloom-dark", "solar-dusk-light", "solar-dusk-dark":
	default:
		cfg.Theme = "default-dark"
	}
	switch cfg.DiffHighlightMode {
	case "word-alt", "word", "character", "none":
	default:
		cfg.DiffHighlightMode = "character"
	}
	switch cfg.DiffClipboardTargetMode {
	case "alternate", "before", "after":
	default:
		cfg.DiffClipboardTargetMode = "alternate"
	}
	if cfg.CodeEditorFontSize < 10 || cfg.CodeEditorFontSize > 24 {
		cfg.CodeEditorFontSize = 12
	}
	timeResults := []string{"local", "dateTime", "dateOnly", "timeOnly", "zonedIso8601", "rfc3339", "utc", "compact", "underscore", "unixSeconds", "unixMilliseconds", "unixNanoseconds"}
	validTimeResult := make(map[string]bool, len(timeResults))
	for _, id := range timeResults {
		validTimeResult[id] = true
	}
	seenTimeResult := make(map[string]bool, len(timeResults))
	order := make([]string, 0, len(timeResults))
	for _, id := range cfg.TimeResultOrder {
		if validTimeResult[id] && !seenTimeResult[id] {
			order = append(order, id)
			seenTimeResult[id] = true
		}
	}
	for _, id := range timeResults {
		if !seenTimeResult[id] {
			order = append(order, id)
		}
	}
	cfg.TimeResultOrder = order
	hidden := make([]string, 0, len(cfg.HiddenTimeResults))
	seenHidden := make(map[string]bool, len(timeResults))
	for _, id := range cfg.HiddenTimeResults {
		if validTimeResult[id] && !seenHidden[id] {
			hidden = append(hidden, id)
			seenHidden[id] = true
		}
	}
	cfg.HiddenTimeResults = hidden
	return cfg
}
func appDataDir() string {
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "DevUtils")
	}
	return filepath.Join(os.TempDir(), "DevUtils")
}
func configPath() string     { return filepath.Join(appDataDir(), "config.json") }
func historyPath() string    { return filepath.Join(appDataDir(), "history.json") }
func historyDataDir() string { return filepath.Join(appDataDir(), "history-data") }

type ConfigService struct {
	mu          sync.Mutex
	path        string
	historyPath string
	historyDir  string
	cfg         Config
	history     []historyStored
	onChange    func(Config)
}

func NewConfigService() *ConfigService {
	cfg := defaultConfig()
	path := configPath()
	if b, err := os.ReadFile(path); err == nil {
		_ = json.Unmarshal(b, &cfg)
	}
	cfg = normalizeConfig(cfg)
	s := &ConfigService{path: path, historyPath: historyPath(), historyDir: historyDataDir(), cfg: cfg}
	if b, err := os.ReadFile(s.historyPath); err == nil {
		_ = json.Unmarshal(b, &s.history)
	}
	return s
}
func (s *ConfigService) ServiceName() string { return "ConfigService" }
func (s *ConfigService) GetAppName() string  { return appName }
func (s *ConfigService) Get() Config         { s.mu.Lock(); defer s.mu.Unlock(); return s.cfg }
func (s *ConfigService) setOnChange(callback func(Config)) {
	s.mu.Lock()
	s.onChange = callback
	s.mu.Unlock()
}
func (s *ConfigService) Save(cfg Config) {
	cfg = normalizeConfig(cfg)
	s.mu.Lock()
	s.cfg = cfg
	path := s.path
	onChange := s.onChange
	s.mu.Unlock()
	if b, err := json.Marshal(cfg); err == nil {
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		_ = os.WriteFile(path, b, 0o600)
	}
	if onChange != nil {
		onChange(cfg)
	}
}
func (s *ConfigService) writeIndexLocked() {
	b, err := json.Marshal(s.history)
	if err != nil {
		return
	}
	_ = os.MkdirAll(filepath.Dir(s.historyPath), 0o755)
	_ = os.WriteFile(s.historyPath, b, 0o600)
}
func (s *ConfigService) GetHistory() []HistoryItem {
	s.mu.Lock()
	defer s.mu.Unlock()
	items := make([]HistoryItem, len(s.history))
	for i, v := range s.history {
		items[i] = v.Item
	}
	return items
}

type HistoryPage struct {
	Items []HistoryItem `json:"items"`
	Total int           `json:"total"`
}

func (s *ConfigService) GetHistoryPage(offset int, limit int) (HistoryPage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if offset < 0 {
		offset = 0
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	total := len(s.history)
	if offset >= total {
		return HistoryPage{Items: []HistoryItem{}, Total: total}, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	items := make([]HistoryItem, end-offset)
	for i, v := range s.history[offset:end] {
		items[i] = v.Item
	}
	return HistoryPage{Items: items, Total: total}, nil
}

type HistoryFilter struct {
	Tool string `json:"tool"`
	From int64  `json:"from"`
	To   int64  `json:"to"`
}

func (s *ConfigService) QueryHistory(offset int, limit int, filter HistoryFilter) (HistoryPage, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if offset < 0 {
		offset = 0
	}
	if limit < 1 || limit > 100 {
		limit = 20
	}
	filtered := make([]HistoryItem, 0, len(s.history))
	for _, v := range s.history {
		if filter.Tool != "" && v.Item.Tool != filter.Tool {
			continue
		}
		if filter.From != 0 || filter.To != 0 {
			t, err := time.Parse(time.RFC3339Nano, v.Item.At)
			if err != nil {
				continue
			}
			ms := t.UnixMilli()
			if filter.From != 0 && ms < filter.From {
				continue
			}
			if filter.To != 0 && ms > filter.To {
				continue
			}
		}
		filtered = append(filtered, v.Item)
	}
	total := len(filtered)
	if offset >= total {
		return HistoryPage{Items: []HistoryItem{}, Total: total}, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return HistoryPage{Items: filtered[offset:end], Total: total}, nil
}
func (s *ConfigService) AppendHistory(entry HistoryEntry) (HistoryItem, error) {
	if entry.Tool == "" {
		return HistoryItem{}, errors.New("missing history tool")
	}
	if detail := []rune(entry.Detail); len(detail) > 120 {
		entry.Detail = string(detail[:120])
	}
	id := time.Now().UnixNano()
	item := HistoryItem{ID: id, Tool: entry.Tool, Action: entry.Action, Detail: entry.Detail, At: time.Now().UTC().Format(time.RFC3339Nano), Mode: entry.Mode, MediaType: entry.MediaType, Name: entry.Name, Bytes: entry.Bytes}
	file := filepath.Join(s.historyDir, "entry-"+time.Unix(0, id).UTC().Format("20060102150405.000000000")+".json.gz")
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := writeGzipJSON(file, HistoryContent{Input: entry.Input, Output: entry.Output}); err != nil {
		return HistoryItem{}, err
	}
	s.history = append([]historyStored{{Item: item, File: file}}, s.history...)
	sort.SliceStable(s.history, func(i, j int) bool { return s.history[i].Item.ID > s.history[j].Item.ID })
	s.writeIndexLocked()
	return item, nil
}
func (s *ConfigService) GetHistoryContent(id int64) (HistoryContent, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, entry := range s.history {
		if entry.Item.ID == id {
			return readGzipJSON(entry.File)
		}
	}
	return HistoryContent{}, errors.New("history entry not found")
}
func (s *ConfigService) DeleteHistory(id int64) {
	s.mu.Lock()
	defer s.mu.Unlock()
	for i, entry := range s.history {
		if entry.Item.ID == id {
			_ = os.Remove(entry.File)
			s.history = append(s.history[:i], s.history[i+1:]...)
			s.writeIndexLocked()
			return
		}
	}
}
func (s *ConfigService) ClearHistory() {
	s.mu.Lock()
	defer s.mu.Unlock()
	for _, entry := range s.history {
		_ = os.Remove(entry.File)
	}
	s.history = nil
	s.writeIndexLocked()
}
func (s *ConfigService) SaveBase64File(path string, data string) error {
	if path == "" {
		return errors.New("missing save path")
	}
	if comma := strings.IndexByte(data, ','); strings.HasPrefix(data, "data:") && comma >= 0 {
		data = data[comma+1:]
	}
	data = strings.Map(func(r rune) rune {
		switch r {
		case ' ', '\t', '\r', '\n':
			return -1
		case '-':
			return '+'
		case '_':
			return '/'
		default:
			return r
		}
	}, data)
	if rem := len(data) % 4; rem != 0 {
		data += strings.Repeat("=", 4-rem)
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".devutils-save-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	reader := base64.NewDecoder(base64.StdEncoding, strings.NewReader(data))
	written, copyErr := io.Copy(tmp, io.LimitReader(reader, (100<<20)+1))
	closeErr := tmp.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if written > 100<<20 {
		return errors.New("decoded file exceeds 100 MiB")
	}
	if err := os.Chmod(tmpPath, 0o600); err != nil {
		return err
	}
	return os.Rename(tmpPath, path)
}
func writeGzipJSON(path string, value any) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	defer f.Close()
	z := gzip.NewWriter(f)
	if err := json.NewEncoder(z).Encode(value); err != nil {
		_ = z.Close()
		return err
	}
	return z.Close()
}
func readGzipJSON(path string) (HistoryContent, error) {
	f, err := os.Open(path)
	if err != nil {
		return HistoryContent{}, err
	}
	defer f.Close()
	z, err := gzip.NewReader(f)
	if err != nil {
		return HistoryContent{}, err
	}
	defer z.Close()
	var content HistoryContent
	err = json.NewDecoder(io.LimitReader(z, 256<<20)).Decode(&content)
	return content, err
}
