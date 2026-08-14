package main

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestUpdaterPreferencesFromConfigNormalizesValues(t *testing.T) {
	tests := []struct {
		name string
		cfg  Config
		want updaterPreferences
	}{
		{name: "英文亮色", cfg: Config{Language: "en-US", Theme: "light"}, want: updaterPreferences{Language: "en-US", Theme: "light"}},
		{name: "默认中文暗色", cfg: Config{Language: "invalid", Theme: "invalid"}, want: updaterPreferences{Language: "zh-CN", Theme: "dark"}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := updaterPreferencesFromConfig(test.cfg); got != test.want {
				t.Fatalf("updaterPreferencesFromConfig() = %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestConfigSaveNotifiesUpdaterPreferences(t *testing.T) {
	service := &ConfigService{path: filepath.Join(t.TempDir(), "config.json"), cfg: defaultConfig()}
	var received updaterPreferences
	service.setOnChange(func(cfg Config) { received = updaterPreferencesFromConfig(cfg) })
	service.Save(Config{Language: "en-US", Theme: "light"})
	if want := (updaterPreferences{Language: "en-US", Theme: "light"}); received != want {
		t.Fatalf("配置变更通知 = %#v, want %#v", received, want)
	}
}

func TestBuildUpdaterWindowInjectsLocaleAndTheme(t *testing.T) {
	resources, err := buildUpdaterWindow(updaterWindowHTML, Config{Language: "en-US", Theme: "light"})
	if err != nil {
		t.Fatal(err)
	}
	if resources.Title != "Software Update" {
		t.Fatalf("Title = %q, want %q", resources.Title, "Software Update")
	}
	for _, placeholder := range []string{"__DEVUTILS_UPDATER_TRANSLATIONS__", "__DEVUTILS_UPDATER_LANGUAGE__", "__DEVUTILS_UPDATER_THEME__"} {
		if strings.Contains(resources.HTML, placeholder) {
			t.Fatalf("更新窗口仍包含占位符 %s", placeholder)
		}
	}
	for _, content := range []string{`lang="en-US"`, `data-theme="light"`, `"zh-CN"`, `"en-US"`, `devutils:updater:preferences`} {
		if !strings.Contains(resources.HTML, content) {
			t.Fatalf("更新窗口缺少 %s", content)
		}
	}
}
