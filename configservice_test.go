package main

import "testing"

func TestNormalizeConfigTheme(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "浅色", in: "light", want: "light"},
		{name: "深色", in: "dark", want: "dark"},
		{name: "旧墨色迁移为浅色", in: "ink", want: "light"},
		{name: "旧松绿色迁移为深色", in: "pine", want: "dark"},
		{name: "空值回退为深色", in: "", want: "dark"},
		{name: "未知值回退为深色", in: "custom", want: "dark"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got := normalizeConfig(Config{Theme: test.in}).Theme
			if got != test.want {
				t.Fatalf("主题规范化结果为 %q，期望 %q", got, test.want)
			}
		})
	}
}
