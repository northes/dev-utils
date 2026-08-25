package main

import "testing"

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
