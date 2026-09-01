package main

import (
	"compress/gzip"
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

type Config struct {
	TrayMatchEnabled             bool                `json:"trayMatchEnabled"`
	TrayMatchTools               []string            `json:"trayMatchTools"`
	URLTrayMatchMigrated         bool                `json:"urlTrayMatchMigrated"`
	AutoOverwrite                bool                `json:"autoOverwrite"`
	AutoCheckUpdates             bool                `json:"autoCheckUpdates"`
	Language                     string              `json:"language"`
	SidebarMode                  string              `json:"sidebarMode"`
	SidebarTools                 []SidebarToolConfig `json:"sidebarTools"`
	ThemeMode                    string              `json:"themeMode"`
	LightTheme                   string              `json:"lightTheme"`
	DarkTheme                    string              `json:"darkTheme"`
	DiffClipboardTargetMode      string              `json:"diffClipboardTargetMode"`
	CodeEditorFontSize           int                 `json:"codeEditorFontSize"`
	TimeResultOrder              []string            `json:"timeResultOrder"`
	HiddenTimeResults            []string            `json:"hiddenTimeResults"`
	JsonAutoFormatOnFill         bool                `json:"jsonAutoFormatOnFill"`
	JsonAutoFormatOnFillMigrated bool                `json:"jsonAutoFormatOnFillMigrated"`
	DockerCLIPath                string              `json:"dockerCLIPath"`
	ImageSources                 []ImageSource       `json:"imageSources"`
}

type SidebarToolConfig struct {
	ID      string `json:"id"`
	Enabled bool   `json:"enabled"`
}

var defaultSidebarToolIDs = []string{"json", "time", "text", "base64", "diff", "jwt", "url", "image-manager"}

type ImageSource struct {
	ID                string `json:"id"`
	Name              string `json:"name"`
	Kind              string `json:"kind"`
	SSHHost           string `json:"sshHost"`
	SSHPort           int    `json:"sshPort"`
	SSHUsername       string `json:"sshUsername"`
	SSHPassword       string `json:"sshPassword"`
	SSHPrivateKey     string `json:"sshPrivateKey"`
	SSHPrivateKeyPath string `json:"sshPrivateKeyPath"`
	SSHKeyPassphrase  string `json:"sshKeyPassphrase"`
	RegistryURL       string `json:"registryURL"`
	RegistryUsername  string `json:"registryUsername"`
	RegistryPassword  string `json:"registryPassword"`
}

const localImageSourceID = "local"

func defaultImageSources() []ImageSource {
	return []ImageSource{{ID: localImageSourceID, Name: "本机", Kind: "local"}}
}

func defaultSidebarTools() []SidebarToolConfig {
	tools := make([]SidebarToolConfig, 0, len(defaultSidebarToolIDs))
	for _, id := range defaultSidebarToolIDs {
		tools = append(tools, SidebarToolConfig{ID: id, Enabled: true})
	}
	return tools
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
	return Config{TrayMatchEnabled: true, TrayMatchTools: []string{"json", "time", "text", "base64", "diff", "jwt", "url"}, AutoOverwrite: true, AutoCheckUpdates: true, Language: "zh-CN", SidebarMode: "full", SidebarTools: defaultSidebarTools(), ThemeMode: "dark", LightTheme: "default-light", DarkTheme: "default-dark", DiffClipboardTargetMode: "alternate", CodeEditorFontSize: 16, TimeResultOrder: []string{"local", "dateTime", "dateOnly", "timeOnly", "zonedIso8601", "rfc3339", "utc", "compact", "underscore", "unixSeconds", "unixMilliseconds", "unixNanoseconds"}, JsonAutoFormatOnFill: true, JsonAutoFormatOnFillMigrated: true, ImageSources: defaultImageSources()}
}

func normalizeThemeID(theme string, defaultID string, legacyID string) string {
	if theme == legacyID {
		return defaultID
	}
	if theme != defaultID {
		return defaultID
	}
	return theme
}

func stringSlicesEqual(a []string, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func sidebarToolsEqual(a []SidebarToolConfig, b []SidebarToolConfig) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func imageSourcesEqual(a []ImageSource, b []ImageSource) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

func validConfigValue(value string, maxLength int) bool {
	if value == "" || len(value) > maxLength {
		return false
	}
	for _, r := range value {
		if r == '\x00' || r == '\n' || r == '\r' || r == '\t' || r == ' ' || r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

func validTextValue(value string, maxLength int) bool {
	if value == "" || len(value) > maxLength {
		return false
	}
	for _, r := range value {
		if r == '\x00' || r == '\n' || r == '\r' || r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

func validSecretValue(value string, maxLength int) bool {
	if len(value) > maxLength {
		return false
	}
	return !strings.ContainsRune(value, '\x00')
}

func normalizeRegistryURL(value string) (string, bool) {
	value = strings.TrimSpace(value)
	u, err := url.Parse(value)
	if err != nil || u.Scheme != "https" || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return "", false
	}
	if u.Path != "" && u.Path != "/" {
		return "", false
	}
	u.Path = ""
	u.RawPath = ""
	return "https://" + strings.ToLower(u.Host), true
}

func validImageSourceID(value string) bool {
	if prefix, suffix, ok := strings.Cut(value, ":"); ok {
		if suffix == "" || (prefix != "ssh" && prefix != "registry") {
			return false
		}
		if prefix == "ssh" {
			return validSSHHost(suffix)
		}
		return validLegacySourceSuffix(suffix)
	}
	if !validConfigValue(value, 64) {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.' {
			continue
		}
		return false
	}
	return true
}

func validLegacySourceSuffix(value string) bool {
	if !validConfigValue(value, 60) {
		return false
	}
	for _, r := range value {
		if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || strings.ContainsRune("-_.", r) {
			continue
		}
		return false
	}
	return true
}

func normalizeImageSources(sources []ImageSource) []ImageSource {
	result := make([]ImageSource, 0, len(sources)+1)
	seen := make(map[string]bool, len(sources)+1)
	hasLocal := false
	for _, source := range sources {
		source.ID = strings.TrimSpace(source.ID)
		source.Name = strings.TrimSpace(source.Name)
		source.Kind = strings.TrimSpace(strings.ToLower(source.Kind))
		source.SSHHost = strings.TrimSpace(source.SSHHost)
		source.SSHUsername = strings.TrimSpace(source.SSHUsername)
		source.RegistryURL = strings.TrimSpace(source.RegistryURL)
		source.RegistryUsername = strings.TrimSpace(source.RegistryUsername)
		if source.Kind == "" && (source.ID == "" || source.ID == localImageSourceID) {
			source.Kind = "local"
		}
		switch source.Kind {
		case "local":
			if source.ID != localImageSourceID || seen[source.ID] {
				continue
			}
			if source.Name == "" {
				source.Name = "本机"
			}
			if !validTextValue(source.Name, 128) {
				continue
			}
			source.SSHHost = ""
			source.SSHPort = 0
			source.SSHUsername = ""
			source.SSHPassword = ""
			source.SSHPrivateKey = ""
			source.SSHPrivateKeyPath = ""
			source.SSHKeyPassphrase = ""
			source.RegistryURL = ""
			source.RegistryUsername = ""
			source.RegistryPassword = ""
			hasLocal = true
		case "ssh":
			if source.ID == localImageSourceID || !validImageSourceID(source.ID) || seen[source.ID] || !validSSHHost(source.SSHHost) || source.SSHPort < 0 || source.SSHPort > 65535 || (source.SSHUsername != "" && (!validConfigValue(source.SSHUsername, 256) || strings.HasPrefix(source.SSHUsername, "-"))) || !validSecretValue(source.SSHPassword, 4096) || !validSecretValue(source.SSHPrivateKey, 128<<10) || (source.SSHPrivateKeyPath != "" && (!validPathValue(source.SSHPrivateKeyPath, 4096) || strings.HasPrefix(source.SSHPrivateKeyPath, "-"))) || !validSecretValue(source.SSHKeyPassphrase, 4096) || (source.SSHKeyPassphrase != "" && source.SSHPrivateKey == "" && source.SSHPrivateKeyPath == "") {
				continue
			}
			if source.SSHPort == 0 {
				source.SSHPort = 22
			}
			if source.Name == "" {
				source.Name = source.SSHHost
			}
			if !validTextValue(source.Name, 128) {
				continue
			}
			source.RegistryURL = ""
			source.RegistryUsername = ""
			source.RegistryPassword = ""
		case "registry":
			var ok bool
			if source.ID == localImageSourceID || !validImageSourceID(source.ID) || seen[source.ID] {
				continue
			}
			source.RegistryURL, ok = normalizeRegistryURL(source.RegistryURL)
			if !ok || !validSecretValue(source.RegistryPassword, 4096) || (source.RegistryPassword != "" && source.RegistryUsername == "") || (source.RegistryUsername != "" && !validTextValue(source.RegistryUsername, 256)) {
				continue
			}
			if source.Name == "" {
				source.Name = source.RegistryURL
			}
			if !validTextValue(source.Name, 128) {
				continue
			}
			source.SSHHost = ""
			source.SSHPort = 0
			source.SSHUsername = ""
			source.SSHPassword = ""
			source.SSHPrivateKey = ""
			source.SSHPrivateKeyPath = ""
			source.SSHKeyPassphrase = ""
		default:
			continue
		}
		result = append(result, source)
		seen[source.ID] = true
	}
	if !hasLocal {
		result = append([]ImageSource{{ID: localImageSourceID, Name: "本机", Kind: "local"}}, result...)
	}
	return result
}

func normalizeDockerCLIPath(path string) string {
	path = strings.TrimSpace(path)
	if path == "" || !validPathValue(path, 4096) || strings.HasPrefix(path, "-") {
		return ""
	}
	return path
}

func normalizeConfig(cfg Config) Config {
	cfg.DockerCLIPath = normalizeDockerCLIPath(cfg.DockerCLIPath)
	cfg.ImageSources = normalizeImageSources(cfg.ImageSources)
	validSidebarTool := make(map[string]bool, len(defaultSidebarToolIDs))
	for _, id := range defaultSidebarToolIDs {
		validSidebarTool[id] = true
	}
	if cfg.SidebarTools == nil {
		cfg.SidebarTools = defaultSidebarTools()
	} else {
		tools := make([]SidebarToolConfig, 0, len(defaultSidebarToolIDs))
		seen := make(map[string]bool, len(defaultSidebarToolIDs))
		for _, tool := range cfg.SidebarTools {
			if validSidebarTool[tool.ID] && !seen[tool.ID] {
				tools = append(tools, tool)
				seen[tool.ID] = true
			}
		}
		for _, id := range defaultSidebarToolIDs {
			if !seen[id] {
				tools = append(tools, SidebarToolConfig{ID: id, Enabled: true})
			}
		}
		cfg.SidebarTools = tools
	}
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
		if len(matched) == 0 {
			matched = append([]string(nil), trayTools...)
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
	switch cfg.ThemeMode {
	case "light", "dark", "system":
	default:
		cfg.ThemeMode = "dark"
	}
	cfg.LightTheme = normalizeThemeID(cfg.LightTheme, "default-light", "modern-minimal-light")
	cfg.DarkTheme = normalizeThemeID(cfg.DarkTheme, "default-dark", "modern-minimal-dark")
	switch cfg.DiffClipboardTargetMode {
	case "alternate", "before", "after":
	default:
		cfg.DiffClipboardTargetMode = "alternate"
	}
	switch cfg.CodeEditorFontSize {
	case 12, 14, 16, 18:
	default:
		cfg.CodeEditorFontSize = 16
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
	if !cfg.JsonAutoFormatOnFillMigrated {
		cfg.JsonAutoFormatOnFill = true
		cfg.JsonAutoFormatOnFillMigrated = true
	}
	return cfg
}

func migrateLegacyTheme(cfg Config, legacyTheme string, hasThemeMode bool) Config {
	if hasThemeMode || legacyTheme == "" {
		return cfg
	}
	switch legacyTheme {
	case "light":
		cfg.ThemeMode = "light"
	case "dark":
		cfg.ThemeMode = "dark"
	case "default-light":
		cfg.ThemeMode = "light"
		cfg.LightTheme = "default-light"
	case "default-dark":
		cfg.ThemeMode = "dark"
		cfg.DarkTheme = "default-dark"
	case "modern-minimal-light":
		cfg.ThemeMode = "light"
		cfg.LightTheme = "default-light"
	case "modern-minimal-dark":
		cfg.ThemeMode = "dark"
		cfg.DarkTheme = "default-dark"
	}
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
		if err := json.Unmarshal(b, &cfg); err == nil {
			beforeNormalize := cfg
			var raw map[string]json.RawMessage
			_ = json.Unmarshal(b, &raw)
			var legacy struct {
				Theme string `json:"theme"`
			}
			_ = json.Unmarshal(b, &legacy)
			_, hasThemeMode := raw["themeMode"]
			_, hasLegacyTheme := raw["theme"]
			_, hasDockerCLIPath := raw["dockerCLIPath"]
			_, hasImageSources := raw["imageSources"]
			cfg = migrateLegacyTheme(cfg, legacy.Theme, hasThemeMode)

			cfg = normalizeConfig(cfg)
			if hasLegacyTheme || !hasDockerCLIPath || !hasImageSources || beforeNormalize.ThemeMode != cfg.ThemeMode || beforeNormalize.LightTheme != cfg.LightTheme || beforeNormalize.DarkTheme != cfg.DarkTheme || !stringSlicesEqual(beforeNormalize.TrayMatchTools, cfg.TrayMatchTools) || beforeNormalize.CodeEditorFontSize != cfg.CodeEditorFontSize || !sidebarToolsEqual(beforeNormalize.SidebarTools, cfg.SidebarTools) || !imageSourcesEqual(beforeNormalize.ImageSources, cfg.ImageSources) || beforeNormalize.DockerCLIPath != cfg.DockerCLIPath {
				if normalized, marshalErr := json.Marshal(cfg); marshalErr == nil {
					_ = writeConfigAtomically(path, normalized)
				}
			}
		}
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

func (s *ConfigService) Save(cfg Config) error {
	s.mu.Lock()
	cfg = normalizeConfig(cfg)
	b, err := json.Marshal(cfg)
	if err != nil {
		s.mu.Unlock()
		return err
	}
	if err := writeConfigAtomically(s.path, b); err != nil {
		s.mu.Unlock()
		return err
	}
	s.cfg = cfg
	onChange := s.onChange
	s.mu.Unlock()
	if onChange != nil {
		onChange(cfg)
	}
	return nil
}

func writeConfigAtomically(path string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(path), ".devutils-config-*")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer func() {
		_ = tmp.Close()
		_ = os.Remove(tmpPath)
	}()
	if err := tmp.Chmod(0o600); err != nil {
		return err
	}
	if _, err := tmp.Write(data); err != nil {
		return err
	}
	if err := tmp.Sync(); err != nil {
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpPath, path); err != nil {
		return err
	}
	return nil
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
	return s.enabledHistoryItemsLocked()
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
	items := s.enabledHistoryItemsLocked()
	total := len(items)
	if offset >= total {
		return HistoryPage{Items: []HistoryItem{}, Total: total}, nil
	}
	end := offset + limit
	if end > total {
		end = total
	}
	return HistoryPage{Items: items[offset:end], Total: total}, nil
}

type HistoryFilter struct {
	Tool string `json:"tool"`
	From int64  `json:"from"`
	To   int64  `json:"to"`
}

func (s *ConfigService) sidebarToolEnabledLocked(toolID string) bool {
	for _, tool := range s.cfg.SidebarTools {
		if tool.ID == toolID {
			return tool.Enabled
		}
	}
	return false
}

func (s *ConfigService) enabledHistoryItemsLocked() []HistoryItem {
	items := make([]HistoryItem, 0, len(s.history))
	for _, entry := range s.history {
		if s.sidebarToolEnabledLocked(entry.Item.Tool) {
			items = append(items, entry.Item)
		}
	}
	return items
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
	items := s.enabledHistoryItemsLocked()
	filtered := make([]HistoryItem, 0, len(items))
	for _, item := range items {
		if filter.Tool != "" && item.Tool != filter.Tool {
			continue
		}
		if filter.From != 0 || filter.To != 0 {
			t, err := time.Parse(time.RFC3339Nano, item.At)
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
		filtered = append(filtered, item)
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
			if !s.sidebarToolEnabledLocked(entry.Item.Tool) {
				return HistoryContent{}, errors.New("history entry not found")
			}
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
