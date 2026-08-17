package main

import "testing"

func TestNormalizeConfigTheme(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "默认浅色", in: "default-light", want: "default-light"},
		{name: "默认深色", in: "default-dark", want: "default-dark"},
		{name: "旧浅色名称回退为深色", in: "light", want: "default-dark"},
		{name: "旧深色名称回退为深色", in: "dark", want: "default-dark"},
		{name: "未知墨色主题回退为深色", in: "ink", want: "default-dark"},
		{name: "未知松绿色主题回退为深色", in: "pine", want: "default-dark"},
		{name: "空值回退为深色", in: "", want: "default-dark"},
		{name: "未知值回退为深色", in: "custom", want: "default-dark"},
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
