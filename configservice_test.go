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

func TestNormalizeConfigTheme(t *testing.T) {
	tests := []struct {
		name string
		in   Config
		want Config
	}{
		{name: "保留浅色模式", in: Config{ThemeMode: "light", LightTheme: "default-light", DarkTheme: "default-dark"}, want: Config{ThemeMode: "light", LightTheme: "default-light", DarkTheme: "default-dark"}},
		{name: "保留深色模式", in: Config{ThemeMode: "dark", LightTheme: "default-light", DarkTheme: "default-dark"}, want: Config{ThemeMode: "dark", LightTheme: "default-light", DarkTheme: "default-dark"}},
		{name: "保留系统模式", in: Config{ThemeMode: "system", LightTheme: "default-light", DarkTheme: "default-dark"}, want: Config{ThemeMode: "system", LightTheme: "default-light", DarkTheme: "default-dark"}},
		{name: "保留 Modern Minimal 主题", in: Config{ThemeMode: "system", LightTheme: "modern-minimal-light", DarkTheme: "modern-minimal-dark"}, want: Config{ThemeMode: "system", LightTheme: "modern-minimal-light", DarkTheme: "modern-minimal-dark"}},
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

func TestMigrateLegacyTheme(t *testing.T) {
	base := defaultConfig()
	tests := []struct {
		name string
		in   string
		mode string
	}{
		{name: "旧浅色", in: "light", mode: "light"},
		{name: "旧深色", in: "dark", mode: "dark"},
		{name: "默认浅色主题", in: "default-light", mode: "light"},
		{name: "默认深色主题", in: "default-dark", mode: "dark"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := migrateLegacyTheme(base, test.in, false)
			if got.ThemeMode != test.mode {
				t.Fatalf("主题模式为 %q，期望 %q", got.ThemeMode, test.mode)
			}
		})
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
