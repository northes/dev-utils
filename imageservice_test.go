package main

import (
	"context"
	"errors"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func TestParseSSHConfigHosts(t *testing.T) {
	config := `# comments are ignored
Host build staging # inline comment
    HostName example.com
Host *.example.com
Host *
Host !excluded
Host build
Host=release
Host release? backup[ab]
`
	got := parseSSHConfigHosts(strings.NewReader(config))
	want := []SSHConfigHost{{Alias: "build"}, {Alias: "staging"}, {Alias: "release"}}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("SSH Host 解析结果为 %#v，期望 %#v", got, want)
	}
}

func writeSSHConfigTestFile(t *testing.T, path string, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatalf("创建 SSH 测试目录失败: %v", err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("写入 SSH 测试配置失败: %v", err)
	}
}

func TestGetSSHConfigHostsIncludesNestedGlobRelativeAndTokens(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	sshDir := filepath.Join(home, ".ssh")
	writeSSHConfigTestFile(t, filepath.Join(sshDir, "config"), `# main
Host direct
Include %h.conf
Include relative/first.conf
Include %d/.ssh/home.conf
Include ~/.ssh/home.conf
Include glob/*.conf
Host *.wildcard !excluded
`)
	writeSSHConfigTestFile(t, filepath.Join(sshDir, "direct.conf"), "Host from-direct\n")
	writeSSHConfigTestFile(t, filepath.Join(sshDir, "relative", "first.conf"), `Host first
Include nested/second.conf
Include nested/*.conf
`)
	writeSSHConfigTestFile(t, filepath.Join(sshDir, "relative", "nested", "second.conf"), `Host second
Include ../first.conf
`)
	writeSSHConfigTestFile(t, filepath.Join(sshDir, "home.conf"), "Host home\n")
	writeSSHConfigTestFile(t, filepath.Join(sshDir, "glob", "a.conf"), "Host glob-a\n")
	writeSSHConfigTestFile(t, filepath.Join(sshDir, "glob", "b.conf"), "Host glob-b\n")

	service := &ImageService{}
	got, err := service.GetSSHConfigHosts()
	if err != nil {
		t.Fatalf("解析带 Include 的 SSH 配置失败: %v", err)
	}
	want := []SSHConfigHost{
		{Alias: "direct"},
		{Alias: "from-direct"},
		{Alias: "first"},
		{Alias: "second"},
		{Alias: "home"},
		{Alias: "glob-a"},
		{Alias: "glob-b"},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Include 解析结果为 %#v，期望 %#v", got, want)
	}
}

func TestGetSSHConfigHostsReturnsErrorsForMissingOrUnreadableMainConfig(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	service := &ImageService{}
	if hosts, err := service.GetSSHConfigHosts(); err == nil || len(hosts) != 0 {
		t.Fatalf("主配置缺失时应返回错误和空结果，结果 %#v，错误 %v", hosts, err)
	}
	configPath := filepath.Join(home, ".ssh", "config")
	if err := os.MkdirAll(configPath, 0o700); err != nil {
		t.Fatalf("创建不可读配置测试路径失败: %v", err)
	}
	if hosts, err := service.GetSSHConfigHosts(); err == nil || len(hosts) != 0 {
		t.Fatalf("主配置读取失败时应返回错误和空结果，结果 %#v，错误 %v", hosts, err)
	}
}

func TestGetSSHConfigHostsAllowsConfigWithoutConcreteAliases(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	writeSSHConfigTestFile(t, filepath.Join(home, ".ssh", "config"), "Host * !excluded\n")
	got, err := (&ImageService{}).GetSSHConfigHosts()
	if err != nil {
		t.Fatalf("没有可导入别名的配置不应报错: %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Fatalf("没有可导入别名时应返回空数组，得到 %#v", got)
	}
}

func TestNormalizeConfigImageSourcesAndSidebarMigration(t *testing.T) {
	cfg := Config{
		SidebarTools: []SidebarToolConfig{{ID: "time", Enabled: false}, {ID: "time", Enabled: true}, {ID: "unknown", Enabled: true}},
		ImageSources: []ImageSource{
			{ID: "remote", Name: "远端", Kind: "ssh", SSHHost: "dev-box"},
			{ID: "remote", Name: "重复", Kind: "ssh", SSHHost: "other"},
			{ID: "bad", Name: "坏地址", Kind: "ssh", SSHHost: "bad host"},
			{ID: "bad-prefix", Name: "非法前缀", Kind: "ssh", SSHHost: "-dev-box"},
			{ID: "local-other", Name: "其他本地", Kind: "local", SSHHost: "ignored"},
			{ID: "not-local", Name: "本地", Kind: "local"},
		},
	}
	got := normalizeConfig(cfg)
	if len(got.ImageSources) != 2 || got.ImageSources[0].ID != localImageSourceID || got.ImageSources[1].ID != "remote" {
		t.Fatalf("镜像来源规范化结果为 %#v", got.ImageSources)
	}
	local := got.ImageSources[0]
	if local.ID != "local" || local.Kind != "local" || local.SSHHost != "" || local.Name != "本机" {
		t.Fatalf("本地来源未规范化为唯一标准来源: %#v", local)
	}
	if len(got.SidebarTools) != len(defaultSidebarToolIDs) {
		t.Fatalf("侧栏工具迁移结果为 %#v", got.SidebarTools)
	}
	for _, tool := range got.SidebarTools {
		if tool.ID == "time" && tool.Enabled {
			t.Fatal("规范化不应重置用户手动关闭的工具")
		}
		if tool.ID == "image-manager" && !tool.Enabled {
			t.Fatal("迁移后的 image-manager 应默认启用")
		}
	}
}

func TestGetDockerStatusUsesCLIWithoutDaemon(t *testing.T) {
	config := &ConfigService{cfg: normalizeConfig(Config{ImageSources: []ImageSource{
		{ID: localImageSourceID, Kind: "local"},
		{ID: "remote", Name: "远端", Kind: "ssh", SSHHost: "dev-box"},
	}})}
	var commandName string
	var commandArgs []string
	service := &ImageService{
		config: config,
		runner: func(_ context.Context, name string, args ...string) ([]byte, error) {
			commandName = name
			commandArgs = append([]string(nil), args...)
			return []byte("Docker version 27.0.0, build deadbeef\n"), nil
		},
	}
	status := service.GetDockerStatus("local")
	if !status.Available || status.Version != "Docker version 27.0.0, build deadbeef" {
		t.Fatalf("Docker CLI 状态为 %#v", status)
	}
	if commandName != "docker" || !reflect.DeepEqual(commandArgs, []string{"--version"}) {
		t.Fatalf("Docker 状态命令为 %q %#v，期望 docker --version", commandName, commandArgs)
	}
	status = service.GetDockerStatus("remote")
	if !status.Available || commandName != "ssh" || !reflect.DeepEqual(commandArgs, []string{"dev-box", "'docker' '--version'"}) {
		t.Fatalf("远程 Docker 状态命令为 %#v %#v，状态为 %#v", commandName, commandArgs, status)
	}
}

func TestBuildImageCommandLocalAndSSH(t *testing.T) {
	localName, localArgs, err := buildImageCommand(ImageSource{ID: "local", Kind: "local"}, "/opt/My Docker/docker", "image", "ls", "--format", "{{json .}}")
	if err != nil {
		t.Fatalf("构造本地命令失败: %v", err)
	}
	if localName != "/opt/My Docker/docker" || !reflect.DeepEqual(localArgs, []string{"image", "ls", "--format", "{{json .}}"}) {
		t.Fatalf("本地命令为 %q %#v", localName, localArgs)
	}

	remoteName, remoteArgs, err := buildImageCommand(ImageSource{ID: "remote", Kind: "ssh", SSHHost: "dev-box"}, "/opt/My Docker/docker", "image", "inspect", "a'b")
	if err != nil {
		t.Fatalf("构造远程命令失败: %v", err)
	}
	if remoteName != "ssh" || !reflect.DeepEqual(remoteArgs, []string{"dev-box", "'/opt/My Docker/docker' 'image' 'inspect' 'a'\"'\"'b'"}) {
		t.Fatalf("远程命令为 %q %#v", remoteName, remoteArgs)
	}
}

func TestDeleteDockerImagesDeduplicatesAndReturnsPartialResults(t *testing.T) {
	config := &ConfigService{cfg: normalizeConfig(Config{ImageSources: []ImageSource{{ID: "local", Kind: "local"}}})}
	var calls [][]string
	service := &ImageService{
		config: config,
		runner: func(_ context.Context, name string, args ...string) ([]byte, error) {
			calls = append(calls, append([]string{name}, args...))
			if len(args) == 3 && args[2] == "bad" {
				return nil, errors.New("not found")
			}
			return []byte("deleted"), nil
		},
	}
	result := service.DeleteDockerImages("local", []string{"one", "one", "bad", "two"})
	if !reflect.DeepEqual(result.Deleted, []string{"one", "two"}) {
		t.Fatalf("成功删除结果为 %#v", result.Deleted)
	}
	if len(result.Failed) != 1 || result.Failed[0].ImageID != "bad" {
		t.Fatalf("失败删除结果为 %#v", result.Failed)
	}
	if len(calls) != 3 {
		t.Fatalf("删除命令调用次数为 %d，期望 3", len(calls))
	}
	for _, call := range calls {
		if !reflect.DeepEqual(call[:2], []string{"docker", "image"}) || call[2] != "rm" {
			t.Fatalf("删除命令参数不正确: %#v", call)
		}
	}
}

func TestListAndInspectDockerImagesUseStructuredOutput(t *testing.T) {
	config := &ConfigService{cfg: normalizeConfig(defaultConfig())}
	service := &ImageService{
		config: config,
		runner: func(_ context.Context, _ string, args ...string) ([]byte, error) {
			if args[1] == "ls" {
				return []byte(`{"ID":"sha256:long","Repository":"repo","Tag":"latest","Size":"10MB","CreatedAt":"now"}` + "\n"), nil
			}
			return []byte(`[{"Id":"sha256:long","RepoTags":["repo:latest"],"Size":10,"Created":"2026-01-01T00:00:00Z","Architecture":"arm64","Os":"linux","Config":{"Labels":{"a":"b"},"Cmd":["run"],"Entrypoint":["/bin/sh"]}}]`), nil
		},
	}
	images, err := service.ListDockerImages("local")
	if err != nil || len(images) != 1 || images[0].Name != "repo:latest" || images[0].SizeBytes != 10*1000*1000 {
		t.Fatalf("镜像列表为 %#v，错误 %v", images, err)
	}
	detail, err := service.InspectDockerImage("local", "sha256:long")
	if err != nil || detail.ID != "sha256:long" || detail.Architecture != "arm64" || detail.Labels["a"] != "b" {
		t.Fatalf("镜像详情为 %#v，错误 %v", detail, err)
	}
}

func TestParseDockerImageSize(t *testing.T) {
	tests := map[string]int64{
		"1B":        1,
		"1KB":       1000,
		"1kB":       1000,
		"1KiB":      1024,
		"1.5MB":     1500000,
		"2MiB":      2 * (1 << 20),
		"3GB":       3 * 1000 * 1000 * 1000,
		"4GiB":      4 * (1 << 30),
		"5TB":       5 * 1000 * 1000 * 1000 * 1000,
		"6TiB":      6 * (1 << 40),
		" 7.5 MiB ": int64(math.Round(7.5 * (1 << 20))),
		"N/A":       0,
		"unknown":   0,
	}
	for input, want := range tests {
		if got := parseDockerImageSize(input); got != want {
			t.Errorf("大小 %q 解析为 %d，期望 %d", input, got, want)
		}
	}
}
