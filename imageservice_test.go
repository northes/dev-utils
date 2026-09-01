package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"
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

func TestNormalizeImageSourcesMigratesCLIAndRegistryCredentials(t *testing.T) {
	cfg := Config{DockerCLIPath: "/custom/docker", ImageSources: []ImageSource{
		{ID: "remote", Name: "远端", Kind: "ssh", SSHHost: "host.example", SSHUsername: "dev", SSHPassword: "secret"},
		{ID: "registry", Name: "仓库", Kind: "registry", RegistryURL: "HTTPS://Registry.Example/", RegistryUsername: "user", RegistryPassword: "secret"},
		{ID: "unsafe", Kind: "registry", RegistryURL: "http://registry.example"},
	}}
	got := normalizeConfig(cfg)
	if got.DockerCLIPath != "/custom/docker" || len(got.ImageSources) != 3 {
		t.Fatalf("来源迁移结果为 %#v", got)
	}
	if got.ImageSources[0].ID != "local" {
		t.Fatalf("本机来源未固定在首位: %#v", got.ImageSources)
	}
	if got.ImageSources[1].SSHPort != 22 || got.ImageSources[2].RegistryURL != "https://registry.example" {
		t.Fatalf("来源默认值或 HTTPS 规范化错误: %#v", got.ImageSources)
	}
	if _, _, err := (&ImageService{config: &ConfigService{cfg: got}}).source("remote"); err != nil {
		t.Fatalf("SSH 来源不应被拒绝: %v", err)
	}
	_, cli, err := (&ImageService{config: &ConfigService{cfg: got}}).source("remote")
	if err != nil || cli != "docker" {
		t.Fatalf("SSH 来源 CLI 为 %q，错误 %v", cli, err)
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
	if !status.Available || commandName != "ssh" || !reflect.DeepEqual(commandArgs, []string{"-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "--", "dev-box", "'docker' '--version'"}) {
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
	if remoteName != "ssh" || !reflect.DeepEqual(remoteArgs, []string{"-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes", "--", "dev-box", "'/opt/My Docker/docker' 'image' 'inspect' 'a'\"'\"'b'"}) {
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

func TestListDockerImagesAggregatesTagsByImageID(t *testing.T) {
	config := &ConfigService{cfg: normalizeConfig(defaultConfig())}
	service := &ImageService{config: config, runner: func(_ context.Context, _ string, _ ...string) ([]byte, error) {
		return []byte("{" + `"ID":"sha256:same","Repository":"repo","Tag":"one","Size":"1MB"` + "}\n{" + `"ID":"sha256:same","Repository":"repo","Tag":"two","Size":"1MB"` + "}\n"), nil
	}}
	images, err := service.ListDockerImages("local")
	if err != nil || len(images) != 1 || len(images[0].Tags) != 2 {
		t.Fatalf("镜像标签聚合结果为 %#v，错误 %v", images, err)
	}
}

func TestRegistryListDetailAndDeleteUseDigest(t *testing.T) {
	configBlob := []byte(`{"architecture":"amd64","os":"linux","created":"2026-01-01T00:00:00Z","config":{"Labels":{"app":"demo"},"Cmd":["run"],"Entrypoint":["/bin/demo"]}}`)
	configHash := sha256.Sum256(configBlob)
	configDigest := "sha256:" + hex.EncodeToString(configHash[:])
	manifest := []byte(fmt.Sprintf(`{"schemaVersion":2,"mediaType":"application/vnd.oci.image.manifest.v1+json","config":{"mediaType":"application/vnd.oci.image.config.v1+json","digest":%q,"size":%d},"layers":[]}`, configDigest, len(configBlob)))
	hash := sha256.Sum256(manifest)
	digest := "sha256:" + hex.EncodeToString(hash[:])
	var deletedPath string
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		username, password, ok := r.BasicAuth()
		if !ok || username != "user" || password != "password" {
			w.Header().Set("WWW-Authenticate", `Basic realm="registry"`)
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		switch r.Method + " " + r.URL.Path {
		case "GET /v2/":
			w.WriteHeader(http.StatusOK)
		case "GET /v2/_catalog":
			_ = json.NewEncoder(w).Encode(map[string]any{"repositories": []string{"repo"}})
		case "GET /v2/repo/tags/list":
			_ = json.NewEncoder(w).Encode(map[string]any{"name": "repo", "tags": []string{"latest", "stable"}})
		case "HEAD /v2/repo/manifests/latest", "HEAD /v2/repo/manifests/stable":
			w.Header().Set("Docker-Content-Digest", digest)
			w.Header().Set("Content-Length", strconv.Itoa(len(manifest)))
			w.Header().Set("Content-Type", "application/vnd.oci.image.manifest.v1+json")
		case "GET /v2/repo/manifests/" + digest:
			w.Header().Set("Docker-Content-Digest", digest)
			w.Header().Set("Content-Type", "application/vnd.oci.image.manifest.v1+json")
			_, _ = w.Write(manifest)
		case "GET /v2/repo/blobs/" + configDigest:
			_, _ = w.Write(configBlob)
		case "DELETE /v2/repo/manifests/" + digest:
			deletedPath = r.URL.Path
			w.WriteHeader(http.StatusAccepted)
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer server.Close()
	defer server.Client().CloseIdleConnections()
	config := &ConfigService{cfg: normalizeConfig(Config{ImageSources: []ImageSource{{ID: "reg", Kind: "registry", RegistryURL: server.URL, RegistryUsername: "user", RegistryPassword: "password"}}})}
	service := NewImageService(config)
	service.cacheDir = t.TempDir()
	service.registryTransport = server.Client().Transport
	images, err := service.ListDockerImages("reg")
	if err != nil || len(images) != 1 || len(images[0].Tags) != 2 || images[0].Digest != digest {
		t.Fatalf("Registry 列表为 %#v，错误 %v", images, err)
	}
	status := service.GetDockerStatus("reg")
	if !status.Available || status.Version != "Registry" {
		t.Fatalf("Registry 状态为 %#v", status)
	}
	detail, err := service.InspectDockerImage("reg", images[0].ID)
	if err != nil || detail.Manifest == nil || detail.Digest != digest || detail.Architecture != "amd64" || detail.Labels["app"] != "demo" {
		t.Fatalf("Registry 详情为 %#v，错误 %v", detail, err)
	}
	result := service.DeleteDockerImages("reg", []string{images[0].ID})
	if len(result.Deleted) != 1 || deletedPath != "/v2/repo/manifests/"+digest {
		t.Fatalf("Registry 删除结果为 %#v，路径为 %q", result, deletedPath)
	}
	service.shutdown()
}

func TestImageDetailCacheIsolatedAndInvalidated(t *testing.T) {
	imageID := "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	config := &ConfigService{path: filepath.Join(t.TempDir(), "config.json"), cfg: normalizeConfig(Config{DockerCLIPath: "docker-a", ImageSources: []ImageSource{{ID: "local", Kind: "local"}}})}
	calls := 0
	service := NewImageService(config)
	service.cacheDir = t.TempDir()
	service.runner = func(_ context.Context, name string, args ...string) ([]byte, error) {
		t.Logf("runner %s %#v", name, args)
		calls++
		if len(args) >= 2 && args[0] == "image" && args[1] == "inspect" {
			return []byte(`[{"Id":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","RepoTags":["repo:latest"]}]`), nil
		}
		return []byte("deleted"), nil
	}
	if _, err := service.InspectDockerImage("local", imageID); err != nil {
		t.Fatalf("首次读取详情失败: %v", err)
	}
	if _, err := service.InspectDockerImage("local", imageID); err != nil {
		t.Fatalf("缓存读取详情失败: %v", err)
	}
	if calls != 1 {
		t.Fatalf("详情缓存未命中，调用次数为 %d", calls)
	}
	fingerprint := imageSourceFingerprint(config.Get().ImageSources[0], config.Get().DockerCLIPath)
	service.updateImageInventory("local", fingerprint, config.Get().ImageSources[0], []DockerImage{{ID: imageID, Name: "repo", Tags: []string{"repo:updated"}}})
	updated, err := service.InspectDockerImage("local", imageID)
	if err != nil || updated.Name != "repo" || !reflect.DeepEqual(updated.Tags, []string{"repo:updated"}) {
		t.Fatalf("缓存详情未使用最新 inventory: %#v，错误 %v", updated, err)
	}
	changed := config.Get()
	changed.DockerCLIPath = "docker-b"
	if err := config.Save(changed); err != nil {
		t.Fatalf("切换来源配置失败: %v", err)
	}
	if _, err := service.InspectDockerImage("local", imageID); err != nil {
		t.Fatalf("来源切换后读取详情失败: %v", err)
	}
	if _, ok := service.currentInventory("local", fingerprint, imageID, ""); ok {
		t.Fatal("来源 fingerprint 变化后仍保留旧 inventory")
	}
	if calls != 2 {
		t.Fatalf("来源切换后错误复用旧缓存，调用次数为 %d", calls)
	}
	deleted := service.DeleteDockerImages("local", []string{imageID})
	if len(deleted.Deleted) != 1 {
		t.Fatalf("删除缓存镜像失败: %#v", deleted)
	}
	if _, err := service.InspectDockerImage("local", imageID); err != nil {
		t.Fatalf("删除后重新读取详情失败: %v", err)
	}
	if calls != 4 {
		t.Fatalf("删除后缓存未失效，调用次数为 %d", calls)
	}
	badCache := filepath.Join(t.TempDir(), "not-a-directory")
	if err := os.WriteFile(badCache, []byte("x"), 0o600); err != nil {
		t.Fatalf("创建缓存写入失败测试文件失败: %v", err)
	}
	service.cacheDir = badCache
	if _, err := service.InspectDockerImage("local", imageID); err != nil {
		t.Fatalf("缓存写入失败不应影响网络详情: %v", err)
	}
	service.shutdown()
}

func TestImageCacheCleanupRemovesDeletedSource(t *testing.T) {
	root := t.TempDir()
	config := &ConfigService{path: filepath.Join(root, "config.json"), cfg: normalizeConfig(Config{ImageSources: []ImageSource{{ID: "ssh:old", Kind: "ssh", SSHHost: "old-host"}}})}
	service := NewImageService(config)
	service.cacheDir = filepath.Join(root, "image-cache")
	source, cliPath, fingerprint, err := service.sourceSnapshot("ssh:old")
	if err != nil {
		t.Fatalf("读取待删除来源失败: %v", err)
	}
	imageID := "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	if err := service.saveImageCache("ssh:old", fingerprint, imageID, "", DockerImageDetail{ID: imageID}); err != nil {
		t.Fatalf("写入来源缓存失败: %v", err)
	}
	if source.Kind != "ssh" || cliPath != "docker" || len(service.cacheFiles()) != 1 {
		t.Fatalf("来源缓存初始状态错误")
	}
	service.updateImageInventory("ssh:old", fingerprint, source, []DockerImage{{ID: imageID, Name: "old", Tags: []string{"old:latest"}}})
	if err := config.Save(Config{}); err != nil {
		t.Fatalf("删除来源配置失败: %v", err)
	}
	service.cleanupImageCache()
	if len(service.cacheFiles()) != 0 {
		t.Fatalf("来源删除后仍保留缓存: %#v", service.cacheFiles())
	}
	if _, ok := service.currentInventory("ssh:old", fingerprint, imageID, ""); ok {
		t.Fatal("来源删除后仍保留内存 inventory")
	}
	service.shutdown()
}

func TestPrewarmGenerationCancelsRefreshAndSourceSwitch(t *testing.T) {
	config := &ConfigService{path: filepath.Join(t.TempDir(), "config.json"), cfg: normalizeConfig(Config{ImageSources: []ImageSource{
		{ID: "local", Kind: "local"},
		{ID: "remote", Kind: "ssh", SSHHost: "dev-box"},
	}})}
	service := NewImageService(config)
	defer service.shutdown()
	local, localCLI, localFingerprint, err := service.sourceSnapshot("local")
	if err != nil {
		t.Fatalf("读取本地来源失败: %v", err)
	}
	firstToken, firstContext := service.beginListRequest("local")
	if !service.setListFingerprint(firstToken, localFingerprint) {
		t.Fatal("首次请求未设置 fingerprint")
	}
	service.schedulePrewarm("local", local, localCLI, localFingerprint, nil, firstToken, firstContext)
	service.mu.Lock()
	first := service.prewarmGenerations["local"]
	service.mu.Unlock()
	if first == nil {
		t.Fatal("首次刷新未创建 generation")
	}
	firstNumber := first.number
	changed := config.Get()
	changed.DockerCLIPath = "docker-b"
	if err := config.Save(changed); err != nil {
		t.Fatalf("修改本地来源失败: %v", err)
	}
	_, changedCLI, changedFingerprint, err := service.sourceSnapshot("local")
	if err != nil {
		t.Fatalf("读取修改后的本地来源失败: %v", err)
	}
	secondToken, secondContext := service.beginListRequest("local")
	if !service.setListFingerprint(secondToken, changedFingerprint) {
		t.Fatal("刷新请求未设置 fingerprint")
	}
	service.schedulePrewarm("local", local, changedCLI, changedFingerprint, nil, secondToken, secondContext)
	select {
	case <-first.ctx.Done():
	case <-time.After(time.Second):
		t.Fatal("来源刷新未取消旧 generation")
	}
	service.mu.Lock()
	second := service.prewarmGenerations["local"]
	service.mu.Unlock()
	if second == nil || second.number <= firstNumber || second.fingerprint != changedFingerprint {
		t.Fatalf("来源刷新 generation 错误: %#v", second)
	}
	remote, remoteCLI, remoteFingerprint, err := service.sourceSnapshot("remote")
	if err != nil {
		t.Fatalf("读取 SSH 来源失败: %v", err)
	}
	remoteToken, remoteContext := service.beginListRequest("remote")
	if !service.setListFingerprint(remoteToken, remoteFingerprint) {
		t.Fatal("SSH 请求未设置 fingerprint")
	}
	service.schedulePrewarm("remote", remote, remoteCLI, remoteFingerprint, nil, remoteToken, remoteContext)
	service.mu.Lock()
	active := service.activeSourceID
	localGeneration := service.prewarmGenerations["local"]
	service.mu.Unlock()
	if active != "remote" || localGeneration != nil {
		t.Fatalf("来源切换后 generation 未正确淘汰: active=%q local=%#v", active, localGeneration)
	}
}

func TestListRequestTokenPreventsSlowSourceFromOverwritingFastSource(t *testing.T) {
	config := &ConfigService{cfg: normalizeConfig(Config{ImageSources: []ImageSource{
		{ID: "local", Kind: "local"},
		{ID: "remote", Kind: "ssh", SSHHost: "dev-box"},
	}})}
	service := NewImageService(config)
	service.cacheDir = t.TempDir()
	defer service.shutdown()
	started := make(chan struct{})
	release := make(chan struct{})
	service.runner = func(ctx context.Context, name string, args ...string) ([]byte, error) {
		isList := len(args) >= 2 && args[0] == "image" && args[1] == "ls"
		if name == "ssh" && len(args) > 0 {
			isList = strings.Contains(args[len(args)-1], "'image' 'ls'")
		}
		if isList {
			if name == "docker" {
				close(started)
				<-release
				return []byte(`{"ID":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","Repository":"slow","Tag":"latest"}`), nil
			}
			return []byte(`{"ID":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","Repository":"fast","Tag":"latest"}`), nil
		}
		return []byte(`[]`), nil
	}
	var slowImages, fastImages []DockerImage
	var slowErr, fastErr error
	done := make(chan struct{})
	go func() {
		slowImages, slowErr = service.ListDockerImages("local")
		close(done)
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("慢来源列表请求未开始")
	}
	fastImages, fastErr = service.ListDockerImages("remote")
	close(release)
	<-done
	if fastErr != nil || len(fastImages) != 1 || fastImages[0].Name != "fast:latest" {
		t.Fatalf("快速来源列表错误: %#v，错误 %v", fastImages, fastErr)
	}
	if slowErr == nil || len(slowImages) != 1 {
		t.Fatalf("慢来源应因 token 过期返回取消错误: %#v，错误 %v", slowImages, slowErr)
	}
	remote, _, remoteFingerprint, err := service.sourceSnapshot("remote")
	if err != nil {
		t.Fatalf("读取快速来源失败: %v", err)
	}
	if inventory, ok := service.currentInventory("remote", remoteFingerprint, "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ""); !ok || inventory.Name != "fast:latest" || remote.Kind != "ssh" {
		t.Fatalf("快速来源 inventory 未保留: %#v，存在=%t", inventory, ok)
	}
	if _, ok := service.currentInventory("local", imageSourceFingerprint(ImageSource{ID: "local", Kind: "local"}, "docker"), "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ""); ok {
		t.Fatal("慢来源覆盖了快速来源后的 inventory")
	}
}

func TestSameSourceOldListCannotOverwriteNewerList(t *testing.T) {
	config := &ConfigService{cfg: normalizeConfig(Config{ImageSources: []ImageSource{{ID: "local", Kind: "local"}}})}
	service := NewImageService(config)
	service.cacheDir = t.TempDir()
	defer service.shutdown()
	started := make(chan struct{})
	release := make(chan struct{})
	var calls int32
	service.runner = func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if len(args) >= 2 && args[0] == "image" && args[1] == "ls" {
			if atomic.AddInt32(&calls, 1) == 1 {
				close(started)
				<-release
				return []byte(`{"ID":"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","Repository":"old","Tag":"latest"}`), nil
			}
			return []byte(`{"ID":"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","Repository":"new","Tag":"latest"}`), nil
		}
		return []byte(`[]`), nil
	}
	var oldImages []DockerImage
	var oldErr error
	done := make(chan struct{})
	go func() {
		oldImages, oldErr = service.ListDockerImages("local")
		close(done)
	}()
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("首次同源列表请求未开始")
	}
	newImages, newErr := service.ListDockerImages("local")
	close(release)
	<-done
	if newErr != nil || len(newImages) != 1 || newImages[0].Name != "new:latest" {
		t.Fatalf("新同源列表错误: %#v，错误 %v", newImages, newErr)
	}
	if oldErr == nil || len(oldImages) != 1 {
		t.Fatalf("旧同源列表应被 token 淘汰: %#v，错误 %v", oldImages, oldErr)
	}
	fingerprint := imageSourceFingerprint(config.Get().ImageSources[0], "docker")
	if inventory, ok := service.currentInventory("local", fingerprint, "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", ""); !ok || inventory.Name != "new:latest" {
		t.Fatalf("新同源 inventory 未保留: %#v，存在=%t", inventory, ok)
	}
	if _, ok := service.currentInventory("local", fingerprint, "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", ""); ok {
		t.Fatal("旧同源请求覆盖了新 inventory")
	}
}

func TestCancelledPrewarmReleasesPermitForNewSource(t *testing.T) {
	config := &ConfigService{cfg: normalizeConfig(Config{ImageSources: []ImageSource{
		{ID: "local", Kind: "local"},
		{ID: "remote", Kind: "ssh", SSHHost: "dev-box"},
	}})}
	service := NewImageService(config)
	service.cacheDir = t.TempDir()
	defer service.shutdown()
	started := make(chan struct{})
	remoteStarted := make(chan struct{})
	service.runner = func(ctx context.Context, name string, args ...string) ([]byte, error) {
		isInspect := len(args) >= 3 && args[0] == "image" && args[1] == "inspect"
		if name == "ssh" && len(args) > 0 {
			isInspect = strings.Contains(args[len(args)-1], "'image' 'inspect'")
		}
		if !isInspect {
			return []byte(`[]`), nil
		}
		if name == "docker" {
			close(started)
			<-ctx.Done()
			return nil, ctx.Err()
		}
		close(remoteStarted)
		return []byte(fmt.Sprintf(`[{"Id":%q}]`, args[2])), nil
	}
	local, localCLI, localFingerprint, err := service.sourceSnapshot("local")
	if err != nil {
		t.Fatalf("读取本地来源失败: %v", err)
	}
	localToken, localCtx := service.beginListRequest("local")
	if !service.setListFingerprint(localToken, localFingerprint) {
		t.Fatal("本地请求未设置 fingerprint")
	}
	service.schedulePrewarm("local", local, localCLI, localFingerprint, []DockerImage{{ID: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}, localToken, localCtx)
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("本地预热未开始")
	}
	service.beginListRequest("remote")
	remoteImage := "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
	done := make(chan error, 1)
	go func() {
		_, inspectErr := service.InspectDockerImage("remote", remoteImage)
		done <- inspectErr
	}()
	select {
	case <-remoteStarted:
	case <-time.After(time.Second):
		t.Fatal("取消本地预热后新来源未及时获得详情 permit")
	}
	select {
	case inspectErr := <-done:
		if inspectErr != nil {
			t.Fatalf("新来源详情失败: %v", inspectErr)
		}
	case <-time.After(time.Second):
		t.Fatal("新来源详情未完成")
	}
}

func TestImageDetailConcurrencyIsBoundedAcrossRequests(t *testing.T) {
	imageSource := ImageSource{ID: "local", Kind: "local"}
	config := &ConfigService{cfg: normalizeConfig(Config{ImageSources: []ImageSource{imageSource}})}
	service := NewImageService(config)
	service.cacheDir = t.TempDir()
	defer service.shutdown()
	var active, maximum int32
	started := make(chan struct{}, imageDetailConcurrency+1)
	release := make(chan struct{})
	service.runner = func(_ context.Context, _ string, args ...string) ([]byte, error) {
		if len(args) < 3 || args[0] != "image" || args[1] != "inspect" {
			return nil, errors.New("unexpected command")
		}
		current := atomic.AddInt32(&active, 1)
		for {
			old := atomic.LoadInt32(&maximum)
			if current <= old || atomic.CompareAndSwapInt32(&maximum, old, current) {
				break
			}
		}
		started <- struct{}{}
		<-release
		atomic.AddInt32(&active, -1)
		return []byte(fmt.Sprintf(`[{"Id":%q}]`, args[2])), nil
	}
	var wg sync.WaitGroup
	for i := 0; i < imageDetailConcurrency*2; i++ {
		imageID := fmt.Sprintf("sha256:%064x", i+1)
		wg.Add(1)
		go func(imageID string) {
			defer wg.Done()
			if _, err := service.InspectDockerImage("local", imageID); err != nil {
				t.Errorf("读取镜像详情失败: %v", err)
			}
		}(imageID)
	}
	for i := 0; i < imageDetailConcurrency; i++ {
		select {
		case <-started:
		case <-time.After(time.Second):
			t.Fatal("详情请求未达到并发上限")
		}
	}
	select {
	case <-started:
		t.Fatal("详情请求超过服务级并发上限")
	case <-time.After(50 * time.Millisecond):
	}
	if got := atomic.LoadInt32(&maximum); got > imageDetailConcurrency {
		t.Fatalf("详情最大并发为 %d，超过 %d", got, imageDetailConcurrency)
	}
	close(release)
	wg.Wait()
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
