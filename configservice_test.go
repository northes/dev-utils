package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

func TestDefaultConfigTheme(t *testing.T) {
	cfg := defaultConfig()
	if cfg.ThemeMode != "dark" || cfg.LightTheme != "default-light" || cfg.DarkTheme != "default-dark" {
		t.Fatalf("默认主题配置为 %#v，期望暗色、default-light、default-dark", cfg)
	}
}

func TestConfigIgnoresLegacyDiffHighlightMode(t *testing.T) {
	cfg := defaultConfig()
	if err := json.Unmarshal([]byte(`{"diffHighlightMode":"word","language":"en-US"}`), &cfg); err != nil {
		t.Fatalf("解码含旧 diffHighlightMode 的配置失败: %v", err)
	}
	if cfg.Language != "en-US" {
		t.Fatalf("解码旧配置时应保留其他字段，语言为 %q", cfg.Language)
	}
}

func TestConfigServiceSaveOmitsLegacyDiffHighlightMode(t *testing.T) {
	root := t.TempDir()
	service := &ConfigService{path: filepath.Join(root, "config.json"), cfg: normalizeConfig(defaultConfig())}

	if err := service.Save(defaultConfig()); err != nil {
		t.Fatalf("保存配置失败: %v", err)
	}
	b, err := os.ReadFile(service.path)
	if err != nil {
		t.Fatalf("读取保存后的配置失败: %v", err)
	}
	var saved map[string]json.RawMessage
	if err := json.Unmarshal(b, &saved); err != nil {
		t.Fatalf("保存后的配置不是有效 JSON: %v", err)
	}
	if _, ok := saved["diffHighlightMode"]; ok {
		t.Fatal("保存后的配置不应包含 diffHighlightMode")
	}
}

func TestNormalizeConfigTheme(t *testing.T) {
	tests := []struct {
		name string
		in   Config
		want Config
	}{
		{name: "保留浅色模式", in: Config{ThemeMode: "light", LightTheme: "default-light", DarkTheme: "default-dark"}, want: Config{ThemeMode: "light", LightTheme: "default-light", DarkTheme: "default-dark"}},
		{name: "保留深色模式", in: Config{ThemeMode: "dark", LightTheme: "default-light", DarkTheme: "default-dark"}, want: Config{ThemeMode: "dark", LightTheme: "default-light", DarkTheme: "default-dark"}},
		{name: "保留系统模式", in: Config{ThemeMode: "system", LightTheme: "default-light", DarkTheme: "default-dark"}, want: Config{ThemeMode: "system", LightTheme: "default-light", DarkTheme: "default-dark"}},
		{name: "迁移 Modern Minimal 主题", in: Config{ThemeMode: "system", LightTheme: "modern-minimal-light", DarkTheme: "modern-minimal-dark"}, want: Config{ThemeMode: "system", LightTheme: "default-light", DarkTheme: "default-dark"}},
		{name: "未知模式回退为深色", in: Config{ThemeMode: "custom"}, want: Config{ThemeMode: "dark", LightTheme: "default-light", DarkTheme: "default-dark"}},
		{name: "非法浅色主题回退", in: Config{ThemeMode: "light", LightTheme: "default-dark", DarkTheme: "default-dark"}, want: Config{ThemeMode: "light", LightTheme: "default-light", DarkTheme: "default-dark"}},
		{name: "非法深色主题回退", in: Config{ThemeMode: "dark", LightTheme: "default-light", DarkTheme: "default-light"}, want: Config{ThemeMode: "dark", LightTheme: "default-light", DarkTheme: "default-dark"}},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := normalizeConfig(test.in)
			if got.ThemeMode != test.want.ThemeMode || got.LightTheme != test.want.LightTheme || got.DarkTheme != test.want.DarkTheme {
				t.Fatalf("主题规范化结果为 %#v，期望 %#v", got, test.want)
			}
		})
	}
}

func TestNormalizeConfigTrayMatchTools(t *testing.T) {
	defaultTools := []string{"json", "time", "text", "base64", "diff", "jwt", "url"}
	tests := []struct {
		name string
		in   []string
		want []string
	}{
		{name: "保留有效工具并过滤无效项", in: []string{"json", "unknown", "json", "url"}, want: []string{"json", "url"}},
		{name: "无效项回退到默认工具", in: []string{"unknown", "image"}, want: defaultTools},
		{name: "空数组回退到默认工具", in: []string{}, want: defaultTools},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			cfg := defaultConfig()
			cfg.TrayMatchTools = test.in
			cfg.URLTrayMatchMigrated = true
			got := normalizeConfig(cfg).TrayMatchTools
			if len(got) != len(test.want) {
				t.Fatalf("规范化后的托盘工具为 %#v，期望 %#v", got, test.want)
			}
			for i := range got {
				if got[i] != test.want[i] {
					t.Fatalf("规范化后的托盘工具为 %#v，期望 %#v", got, test.want)
				}
			}
		})
	}
}

func TestNormalizeConfigEditorFontSize(t *testing.T) {
	tests := []struct {
		in   int
		want int
	}{
		{in: 12, want: 12},
		{in: 14, want: 14},
		{in: 16, want: 16},
		{in: 18, want: 18},
		{in: 10, want: 16},
		{in: 11, want: 16},
		{in: 13, want: 16},
		{in: 15, want: 16},
		{in: 17, want: 16},
		{in: 19, want: 16},
		{in: 24, want: 16},
	}
	for _, test := range tests {
		cfg := defaultConfig()
		cfg.CodeEditorFontSize = test.in
		if got := normalizeConfig(cfg).CodeEditorFontSize; got != test.want {
			t.Fatalf("字号 %d 规范化为 %d，期望 %d", test.in, got, test.want)
		}
	}
}

func TestNormalizeConfigKeepsTrayToolsWhenURLMigrationIsComplete(t *testing.T) {
	cfg := defaultConfig()
	cfg.TrayMatchTools = []string{"invalid"}
	cfg.URLTrayMatchMigrated = true
	got := normalizeConfig(cfg)
	if len(got.TrayMatchTools) == 0 {
		t.Fatal("URL 迁移完成后无效托盘工具不应规范化为空数组")
	}
	for _, id := range got.TrayMatchTools {
		switch id {
		case "json", "time", "text", "base64", "diff", "jwt", "url":
		default:
			t.Fatalf("规范化后的托盘工具包含无效项 %q", id)
		}
	}
}

func TestMigrateLegacyTheme(t *testing.T) {
	base := defaultConfig()
	tests := []struct {
		name  string
		in    string
		mode  string
		light string
		dark  string
	}{
		{name: "旧浅色", in: "light", mode: "light", light: "default-light", dark: "default-dark"},
		{name: "旧深色", in: "dark", mode: "dark", light: "default-light", dark: "default-dark"},
		{name: "默认浅色主题", in: "default-light", mode: "light", light: "default-light", dark: "default-dark"},
		{name: "默认深色主题", in: "default-dark", mode: "dark", light: "default-light", dark: "default-dark"},
		{name: "Modern Minimal 浅色主题", in: "modern-minimal-light", mode: "light", light: "default-light", dark: "default-dark"},
		{name: "Modern Minimal 深色主题", in: "modern-minimal-dark", mode: "dark", light: "default-light", dark: "default-dark"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := migrateLegacyTheme(base, test.in, false)
			if got.ThemeMode != test.mode || got.LightTheme != test.light || got.DarkTheme != test.dark {
				t.Fatalf("迁移后的主题配置为 %#v，期望模式 %q、浅色 %q、深色 %q", got, test.mode, test.light, test.dark)
			}
		})
	}
}

func TestConfigServicePersistsNormalizedThemeIDs(t *testing.T) {
	root := t.TempDir()
	service := &ConfigService{path: filepath.Join(root, "config.json"), cfg: normalizeConfig(defaultConfig())}
	cfg := defaultConfig()
	cfg.LightTheme = "modern-minimal-light"
	cfg.DarkTheme = "modern-minimal-dark"

	if err := service.Save(cfg); err != nil {
		t.Fatalf("保存旧主题配置失败: %v", err)
	}
	b, err := os.ReadFile(service.path)
	if err != nil {
		t.Fatalf("读取迁移后的配置失败: %v", err)
	}
	var saved Config
	if err := json.Unmarshal(b, &saved); err != nil {
		t.Fatalf("迁移后的配置不是有效 JSON: %v", err)
	}
	if saved.LightTheme != "default-light" || saved.DarkTheme != "default-dark" {
		t.Fatalf("保存后的主题 ID 为 %#v，期望 default-light 和 default-dark", saved)
	}
}

func TestConfigServiceMigratesThemesOnLoad(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", root)
	path := configPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("创建配置目录失败: %v", err)
	}
	legacy := `{"themeMode":"system","lightTheme":"modern-minimal-light","darkTheme":"modern-minimal-dark"}`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatalf("写入旧主题配置失败: %v", err)
	}

	service := NewConfigService()
	cfg := service.Get()
	if cfg.LightTheme != "default-light" || cfg.DarkTheme != "default-dark" {
		t.Fatalf("加载后的主题 ID 为 %#v，期望 default-light 和 default-dark", cfg)
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取持久化主题配置失败: %v", err)
	}
	var saved Config
	if err := json.Unmarshal(b, &saved); err != nil {
		t.Fatalf("持久化主题配置不是有效 JSON: %v", err)
	}
	if saved.LightTheme != "default-light" || saved.DarkTheme != "default-dark" {
		t.Fatalf("持久化后的主题 ID 为 %#v，期望 default-light 和 default-dark", saved)
	}
}

func TestConfigServiceMigratesLegacyThemeFieldOnLoad(t *testing.T) {
	for _, test := range []struct {
		name  string
		theme string
		mode  string
	}{
		{name: "Modern Minimal 浅色", theme: "modern-minimal-light", mode: "light"},
		{name: "Modern Minimal 深色", theme: "modern-minimal-dark", mode: "dark"},
	} {
		t.Run(test.name, func(t *testing.T) {
			root := t.TempDir()
			t.Setenv("HOME", root)
			path := configPath()
			if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
				t.Fatalf("创建配置目录失败: %v", err)
			}
			legacy := fmt.Sprintf(`{"theme":%q}`, test.theme)
			if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
				t.Fatalf("写入遗留 Theme 配置失败: %v", err)
			}

			service := NewConfigService()
			cfg := service.Get()
			if cfg.ThemeMode != test.mode || cfg.LightTheme != "default-light" || cfg.DarkTheme != "default-dark" {
				t.Fatalf("遗留 Theme 迁移结果为 %#v，期望模式 %q 和默认主题", cfg, test.mode)
			}
			b, err := os.ReadFile(path)
			if err != nil {
				t.Fatalf("读取迁移后的配置失败: %v", err)
			}
			var saved map[string]json.RawMessage
			if err := json.Unmarshal(b, &saved); err != nil {
				t.Fatalf("迁移后的配置不是有效 JSON: %v", err)
			}
			if _, ok := saved["theme"]; ok {
				t.Fatal("迁移后的配置不应保留遗留 theme 字段")
			}
			for _, key := range []string{"themeMode", "lightTheme", "darkTheme"} {
				if _, ok := saved[key]; !ok {
					t.Fatalf("迁移后的配置缺少 canonical 字段 %q", key)
				}
			}
			var savedConfig Config
			if err := json.Unmarshal(b, &savedConfig); err != nil {
				t.Fatalf("迁移后的 canonical 配置无法解码: %v", err)
			}
			if savedConfig.ThemeMode != test.mode || savedConfig.LightTheme != "default-light" || savedConfig.DarkTheme != "default-dark" {
				t.Fatalf("磁盘中的 canonical 主题配置为 %#v，期望模式 %q 和默认主题", savedConfig, test.mode)
			}
		})
	}
}

func TestConfigServicePersistsNormalizedTrayToolsOnLoad(t *testing.T) {
	root := t.TempDir()
	t.Setenv("HOME", root)
	path := configPath()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("创建配置目录失败: %v", err)
	}
	legacy := `{"trayMatchTools":["invalid"],"urlTrayMatchMigrated":true,"codeEditorFontSize":13}`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatalf("写入遗留配置失败: %v", err)
	}

	service := NewConfigService()
	if got := service.Get().TrayMatchTools; len(got) == 0 {
		t.Fatal("加载后的托盘工具不应为空")
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("读取规范化后的配置失败: %v", err)
	}
	var saved Config
	if err := json.Unmarshal(b, &saved); err != nil {
		t.Fatalf("规范化后的配置不是有效 JSON: %v", err)
	}
	if len(saved.TrayMatchTools) == 0 || saved.CodeEditorFontSize != 16 {
		t.Fatalf("持久化后的托盘工具或字号不合法: %#v", saved)
	}
}

func TestHistoryAccessHonorsDisabledSidebarTool(t *testing.T) {
	root := t.TempDir()
	service := &ConfigService{
		path:        filepath.Join(root, "config.json"),
		historyPath: filepath.Join(root, "history.json"),
		historyDir:  filepath.Join(root, "history-data"),
		cfg:         normalizeConfig(defaultConfig()),
	}

	enabledItem, err := service.AppendHistory(HistoryEntry{
		Tool:   "json",
		Input:  "enabled input",
		Output: "enabled output",
	})
	if err != nil {
		t.Fatalf("追加启用工具历史失败: %v", err)
	}
	disabledItem, err := service.AppendHistory(HistoryEntry{
		Tool:   "time",
		Input:  "disabled input",
		Output: "disabled output",
	})
	if err != nil {
		t.Fatalf("追加待禁用工具历史失败: %v", err)
	}

	cfg := service.Get()
	for i := range cfg.SidebarTools {
		if cfg.SidebarTools[i].ID == "time" {
			cfg.SidebarTools[i].Enabled = false
		}
	}
	if err := service.Save(cfg); err != nil {
		t.Fatalf("保存禁用工具配置失败: %v", err)
	}

	history := service.GetHistory()
	if len(history) != 1 || history[0].ID != enabledItem.ID {
		t.Fatalf("GetHistory 未过滤禁用工具历史: %#v", history)
	}
	page, err := service.GetHistoryPage(0, 20)
	if err != nil {
		t.Fatalf("分页查询历史失败: %v", err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ID != enabledItem.ID {
		t.Fatalf("GetHistoryPage 未过滤禁用工具历史: %#v", page)
	}

	page, err = service.QueryHistory(0, 20, HistoryFilter{})
	if err != nil {
		t.Fatalf("查询历史失败: %v", err)
	}
	if page.Total != 1 || len(page.Items) != 1 || page.Items[0].ID != enabledItem.ID {
		t.Fatalf("禁用工具历史仍可查询: %#v", page)
	}

	page, err = service.QueryHistory(0, 20, HistoryFilter{Tool: "time"})
	if err != nil {
		t.Fatalf("按禁用工具查询历史失败: %v", err)
	}
	if page.Total != 0 || len(page.Items) != 0 {
		t.Fatalf("按禁用工具查询应返回空结果: %#v", page)
	}

	content, err := service.GetHistoryContent(disabledItem.ID)
	if err == nil || err.Error() != "history entry not found" {
		t.Fatalf("读取禁用工具历史错误为 %v，期望 history entry not found", err)
	}
	if content != (HistoryContent{}) {
		t.Fatalf("禁用工具历史不应返回内容: %#v", content)
	}

	content, err = service.GetHistoryContent(enabledItem.ID)
	if err != nil {
		t.Fatalf("读取启用工具历史失败: %v", err)
	}
	if content.Input != "enabled input" || content.Output != "enabled output" {
		t.Fatalf("启用工具历史内容错误: %#v", content)
	}
}

func TestConfigServiceSaveConcurrentWrites(t *testing.T) {
	root := t.TempDir()
	service := &ConfigService{
		path: filepath.Join(root, "config.json"),
		cfg:  normalizeConfig(defaultConfig()),
	}

	const saveCount = 32
	configs := make([]Config, saveCount)
	for i := range configs {
		configs[i] = defaultConfig()
		configs[i].Language = fmt.Sprintf("test-language-%d", i)
	}

	var wg sync.WaitGroup
	errs := make(chan error, saveCount)
	for _, cfg := range configs {
		wg.Add(1)
		go func(cfg Config) {
			defer wg.Done()
			errs <- service.Save(cfg)
		}(cfg)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("并发保存配置失败: %v", err)
		}
	}

	b, err := os.ReadFile(service.path)
	if err != nil {
		t.Fatalf("读取保存后的配置失败: %v", err)
	}
	var saved Config
	if err := json.Unmarshal(b, &saved); err != nil {
		t.Fatalf("并发保存后的配置不是有效 JSON: %v", err)
	}
	for _, cfg := range configs {
		if saved.Language == cfg.Language {
			info, err := os.Stat(service.path)
			if err != nil {
				t.Fatalf("获取配置文件信息失败: %v", err)
			}
			if info.Mode().Perm() != 0o600 {
				t.Fatalf("配置文件权限为 %o，期望 600", info.Mode().Perm())
			}
			return
		}
	}
	t.Fatalf("保存后的配置不是任一完整快照: %#v", saved)
}

func TestConfigServiceSavePropagatesWriteError(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, "config-target")
	if err := os.Mkdir(path, 0o700); err != nil {
		t.Fatalf("创建保存错误测试目录失败: %v", err)
	}
	service := &ConfigService{path: path, cfg: normalizeConfig(defaultConfig())}

	if err := service.Save(defaultConfig()); err == nil {
		t.Fatal("保存到目录时应返回错误")
	}
}
