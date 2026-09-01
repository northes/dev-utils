package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	imageCommandTimeout   = 15 * time.Second
	imagePushTimeout      = 5 * time.Minute
	maxImageCommandOutput = 8 << 20
	maxDockerDeleteImages = 100
	maxSSHConfigFileSize  = 1 << 20
	maxSSHConfigFiles     = 128
	maxSSHConfigDepth     = 8
)

// SSHConfigHost 是 ~/.ssh/config 中可以直接交给系统 ssh 的 Host 别名。
type SSHConfigHost struct {
	Alias string `json:"alias"`
}

type DockerStatus struct {
	Available bool   `json:"available"`
	CLIPath   string `json:"cliPath"`
	Version   string `json:"version"`
	Error     string `json:"error"`
}

type DockerImage struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Size      string `json:"size"`
	SizeBytes int64  `json:"sizeBytes"`
	CreatedAt string `json:"createdAt"`
}

type DockerImageDetail struct {
	ID           string            `json:"id"`
	Name         string            `json:"name"`
	Tags         []string          `json:"tags"`
	Size         int64             `json:"size"`
	CreatedAt    string            `json:"createdAt"`
	Architecture string            `json:"architecture"`
	OS           string            `json:"os"`
	Labels       map[string]string `json:"labels"`
	Command      []string          `json:"command"`
	Entrypoint   []string          `json:"entrypoint"`
}

type DockerOperationResult struct {
	Success bool   `json:"success"`
	Image   string `json:"image"`
	Output  string `json:"output"`
	Error   string `json:"error"`
}

type DockerDeleteFailure struct {
	ImageID string `json:"imageID"`
	Error   string `json:"error"`
}

type DockerDeleteResult struct {
	Deleted []string              `json:"deleted"`
	Failed  []DockerDeleteFailure `json:"failed"`
}

type imageCommandRunner func(context.Context, string, ...string) ([]byte, error)

// ImageService 通过本机 docker CLI 和系统 ssh 管理镜像。
type ImageService struct {
	config *ConfigService
	runner imageCommandRunner
}

func NewImageService(config *ConfigService) *ImageService {
	return &ImageService{config: config, runner: runImageCommand}
}

func (s *ImageService) ServiceName() string { return "ImageService" }

func runImageCommand(ctx context.Context, name string, args ...string) ([]byte, error) {
	command := exec.CommandContext(ctx, name, args...)
	stdout := &limitedBuffer{limit: maxImageCommandOutput}
	stderr := &limitedBuffer{limit: maxImageCommandOutput}
	command.Stdout = stdout
	command.Stderr = stderr
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return stdout.Bytes(), ctx.Err()
		}
		if message := strings.TrimSpace(stderr.String()); message != "" {
			return stdout.Bytes(), fmt.Errorf("%w: %s", err, message)
		}
		return stdout.Bytes(), err
	}
	return stdout.Bytes(), nil
}

type limitedBuffer struct {
	bytes.Buffer
	limit int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	remaining := b.limit - b.Len()
	if remaining <= 0 {
		return 0, errors.New("command output exceeds limit")
	}
	if len(p) > remaining {
		_, _ = b.Buffer.Write(p[:remaining])
		return remaining, errors.New("command output exceeds limit")
	}
	return b.Buffer.Write(p)
}

func (s *ImageService) source(sourceID string) (ImageSource, string, error) {
	if s == nil || s.config == nil {
		return ImageSource{}, "", errors.New("镜像服务未配置")
	}
	config := normalizeConfig(s.config.Get())
	cliPath := config.DockerCLIPath
	if cliPath == "" {
		cliPath = "docker"
	}
	for _, source := range config.ImageSources {
		if source.ID == sourceID {
			if source.Kind == "local" {
				return source, cliPath, nil
			}
			if source.Kind == "ssh" && validSSHHost(source.SSHHost) {
				return source, cliPath, nil
			}
			return ImageSource{}, "", errors.New("镜像来源无效")
		}
	}
	return ImageSource{}, "", fmt.Errorf("镜像来源 %q 不存在", sourceID)
}

func validSSHHost(host string) bool {
	return validConfigValue(host, 255) && !strings.HasPrefix(host, "-")
}

func validPathValue(path string, maxLength int) bool {
	if path == "" || len(path) > maxLength {
		return false
	}
	for _, r := range path {
		if r == '\x00' || r == '\n' || r == '\r' || r < 0x20 || r == 0x7f {
			return false
		}
	}
	return true
}

func validImageReference(reference string) bool {
	if !validConfigValue(reference, 512) || strings.HasPrefix(reference, "-") {
		return false
	}
	return true
}

func shellQuote(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "'\"'\"'") + "'"
}

func shellJoin(args []string) string {
	quoted := make([]string, len(args))
	for i, arg := range args {
		quoted[i] = shellQuote(arg)
	}
	return strings.Join(quoted, " ")
}

func buildImageCommand(source ImageSource, cliPath string, dockerArgs ...string) (string, []string, error) {
	if !validPathValue(cliPath, 4096) || strings.HasPrefix(cliPath, "-") {
		return "", nil, errors.New("Docker CLI 路径无效")
	}
	if source.Kind == "local" {
		return cliPath, append([]string(nil), dockerArgs...), nil
	}
	if source.Kind != "ssh" || !validSSHHost(source.SSHHost) {
		return "", nil, errors.New("镜像来源无效")
	}
	remoteArgs := append([]string{cliPath}, dockerArgs...)
	return "ssh", []string{source.SSHHost, shellJoin(remoteArgs)}, nil
}

func (s *ImageService) runDocker(sourceID string, args []string, timeout time.Duration) ([]byte, error) {
	source, cliPath, err := s.source(sourceID)
	if err != nil {
		return nil, err
	}
	name, commandArgs, err := buildImageCommand(source, cliPath, args...)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	runner := s.runner
	if runner == nil {
		runner = runImageCommand
	}
	return runner(ctx, name, commandArgs...)
}

func (s *ImageService) GetSSHConfigHosts() ([]SSHConfigHost, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return []SSHConfigHost{}, fmt.Errorf("获取用户主目录失败: %w", err)
	}
	return parseSSHConfigFileTree(filepath.Join(home, ".ssh", "config"))
}

type sshConfigParseState struct {
	home         string
	hosts        []SSHConfigHost
	seenHosts    map[string]bool
	seenFiles    map[string]bool
	fileCount    int
	totalBytes   int64
	currentHosts []string
}

func parseSSHConfigFileTree(path string) ([]SSHConfigHost, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return []SSHConfigHost{}, fmt.Errorf("获取用户主目录失败: %w", err)
	}
	state := &sshConfigParseState{home: home, hosts: []SSHConfigHost{}, seenHosts: map[string]bool{}, seenFiles: map[string]bool{}}
	if err := state.parseFile(path, 0); err != nil {
		return []SSHConfigHost{}, err
	}
	return state.hosts, nil
}

func parseSSHConfigHosts(reader io.Reader) []SSHConfigHost {
	data, err := io.ReadAll(io.LimitReader(reader, maxSSHConfigFileSize))
	if err != nil {
		return []SSHConfigHost{}
	}
	return parseSSHConfigHostData(data)
}

func parseSSHConfigHostData(data []byte) []SSHConfigHost {
	result := make([]SSHConfigHost, 0)
	seen := make(map[string]bool)
	for _, line := range strings.Split(string(data), "\n") {
		key, values := parseSSHConfigDirective(line)
		if key != "host" {
			continue
		}
		for _, alias := range values {
			if !isConcreteSSHHostAlias(alias) || seen[alias] {
				continue
			}
			seen[alias] = true
			result = append(result, SSHConfigHost{Alias: alias})
		}
	}
	return result
}

func parseSSHConfigDirective(line string) (string, []string) {
	if index := strings.IndexByte(line, '#'); index >= 0 {
		line = line[:index]
	}
	fields := strings.Fields(line)
	if len(fields) == 0 {
		return "", nil
	}
	key := strings.ToLower(fields[0])
	if strings.HasPrefix(key, "host=") {
		fields = append([]string{"host", fields[0][len("host="):]}, fields[1:]...)
		key = "host"
	}
	if strings.HasPrefix(key, "include=") {
		fields = append([]string{"include", fields[0][len("include="):]}, fields[1:]...)
		key = "include"
	}
	if len(fields) < 2 {
		return key, nil
	}
	return key, fields[1:]
}

func isConcreteSSHHostAlias(alias string) bool {
	return !strings.ContainsAny(alias, "*?![") && validSSHHost(alias)
}

func (s *sshConfigParseState) parseFile(path string, depth int) error {
	if depth > maxSSHConfigDepth {
		return fmt.Errorf("SSH 配置 Include 嵌套超过限制（最大 %d 层）", maxSSHConfigDepth)
	}
	canonicalPath, err := canonicalSSHConfigPath(path)
	if err != nil {
		return fmt.Errorf("解析 SSH 配置文件 %q 失败: %w", path, err)
	}
	if s.seenFiles[canonicalPath] {
		return nil
	}
	if s.fileCount >= maxSSHConfigFiles {
		return fmt.Errorf("SSH 配置 Include 文件数量超过限制（最大 %d 个）", maxSSHConfigFiles)
	}
	info, err := os.Stat(canonicalPath)
	if err != nil {
		return fmt.Errorf("读取 SSH 配置文件 %q 失败: %w", canonicalPath, err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("SSH 配置路径 %q 不是普通文件", canonicalPath)
	}
	if info.Size() > maxSSHConfigFileSize {
		return fmt.Errorf("SSH 配置文件 %q 超过大小限制", canonicalPath)
	}
	file, err := os.Open(canonicalPath)
	if err != nil {
		return fmt.Errorf("读取 SSH 配置文件 %q 失败: %w", canonicalPath, err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxSSHConfigFileSize+1))
	if err != nil {
		return fmt.Errorf("读取 SSH 配置文件 %q 失败: %w", canonicalPath, err)
	}
	if len(data) > maxSSHConfigFileSize {
		return fmt.Errorf("SSH 配置文件 %q 超过大小限制", canonicalPath)
	}
	s.totalBytes += int64(len(data))
	if s.totalBytes > int64(maxSSHConfigFileSize)*maxSSHConfigFiles {
		return errors.New("SSH 配置总读取大小超过限制")
	}
	s.seenFiles[canonicalPath] = true
	s.fileCount++
	for _, line := range strings.Split(string(data), "\n") {
		key, values := parseSSHConfigDirective(line)
		switch key {
		case "host":
			s.currentHosts = nil
			for _, alias := range values {
				if !isConcreteSSHHostAlias(alias) {
					continue
				}
				s.currentHosts = append(s.currentHosts, alias)
				if !s.seenHosts[alias] {
					s.seenHosts[alias] = true
					s.hosts = append(s.hosts, SSHConfigHost{Alias: alias})
				}
			}
		case "include":
			for _, pattern := range values {
				matches, err := s.expandInclude(pattern, filepath.Dir(canonicalPath))
				if err != nil {
					return err
				}
				for _, match := range matches {
					if err := s.parseFile(match, depth+1); err != nil {
						return err
					}
				}
			}
		}
	}
	return nil
}

func canonicalSSHConfigPath(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		return filepath.Clean(resolved), nil
	}
	return filepath.Clean(abs), nil
}

func (s *sshConfigParseState) expandInclude(pattern string, baseDir string) ([]string, error) {
	if pattern == "" || len(pattern) > maxSSHConfigFileSize {
		return nil, errors.New("SSH Include 路径无效")
	}
	hosts := s.currentHosts
	if len(hosts) == 0 && strings.Contains(pattern, "%h") {
		hosts = []string{"*"}
	}
	if len(hosts) == 0 {
		hosts = []string{""}
	}
	matches := make([]string, 0)
	seen := make(map[string]bool)
	for _, host := range hosts {
		includePath := strings.ReplaceAll(pattern, "%d", s.home)
		includePath = strings.ReplaceAll(includePath, "%h", host)
		if includePath == "~" {
			includePath = s.home
		} else if strings.HasPrefix(includePath, "~/") {
			includePath = filepath.Join(s.home, includePath[2:])
		}
		if !filepath.IsAbs(includePath) {
			includePath = filepath.Join(baseDir, includePath)
		}
		if len(includePath) > maxSSHConfigFileSize {
			return nil, errors.New("SSH Include 路径过长")
		}
		globMatches, err := filepath.Glob(includePath)
		if err != nil {
			return nil, fmt.Errorf("解析 SSH Include 路径 %q 失败: %w", pattern, err)
		}
		for _, match := range globMatches {
			canonical, err := canonicalSSHConfigPath(match)
			if err != nil {
				return nil, fmt.Errorf("解析 SSH Include 文件 %q 失败: %w", match, err)
			}
			if !seen[canonical] {
				seen[canonical] = true
				matches = append(matches, match)
			}
		}
	}
	return matches, nil
}

func (s *ImageService) GetDockerStatus(sourceID string) DockerStatus {
	_, cliPath, err := s.source(sourceID)
	status := DockerStatus{CLIPath: cliPath}
	if err != nil {
		status.Error = err.Error()
		return status
	}
	output, err := s.runDocker(sourceID, []string{"--version"}, imageCommandTimeout)
	if err != nil {
		status.Error = err.Error()
		return status
	}
	status.Available = true
	status.Version = strings.TrimSpace(string(output))
	return status
}

type dockerImageListJSON struct {
	ID         string `json:"ID"`
	Repository string `json:"Repository"`
	Tag        string `json:"Tag"`
	Size       string `json:"Size"`
	CreatedAt  string `json:"CreatedAt"`
}

func parseDockerImageSize(value string) int64 {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0
	}
	for i := len(value); i > 0; i-- {
		numberPart := strings.TrimSpace(value[:i])
		unit := strings.ToLower(strings.TrimSpace(value[i:]))
		multiplier, ok := map[string]float64{
			"b":   1,
			"kb":  1000,
			"mb":  1000 * 1000,
			"gb":  1000 * 1000 * 1000,
			"tb":  1000 * 1000 * 1000 * 1000,
			"kib": 1 << 10,
			"mib": 1 << 20,
			"gib": 1 << 30,
			"tib": 1 << 40,
		}[unit]
		if !ok {
			continue
		}
		number, err := strconv.ParseFloat(numberPart, 64)
		if err != nil || math.IsNaN(number) || math.IsInf(number, 0) {
			continue
		}
		if number < 0 {
			return 0
		}
		bytes := number * multiplier
		if bytes >= float64(math.MaxInt64) {
			return 0
		}
		return int64(math.Round(bytes))
	}
	return 0
}

func (s *ImageService) ListDockerImages(sourceID string) ([]DockerImage, error) {
	output, err := s.runDocker(sourceID, []string{"image", "ls", "--no-trunc", "--format", "{{json .}}"}, imageCommandTimeout)
	if err != nil {
		return nil, err
	}
	images := make([]DockerImage, 0)
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var item dockerImageListJSON
		if err := json.Unmarshal([]byte(line), &item); err != nil {
			return nil, fmt.Errorf("解析 Docker 镜像列表失败: %w", err)
		}
		name := item.Repository
		if item.Tag != "" {
			name += ":" + item.Tag
		}
		images = append(images, DockerImage{ID: item.ID, Name: name, Size: item.Size, SizeBytes: parseDockerImageSize(item.Size), CreatedAt: item.CreatedAt})
	}
	return images, nil
}

type dockerImageInspectJSON struct {
	ID           string   `json:"Id"`
	RepoTags     []string `json:"RepoTags"`
	Size         int64    `json:"Size"`
	Created      string   `json:"Created"`
	Architecture string   `json:"Architecture"`
	OS           string   `json:"Os"`
	Config       struct {
		Labels     map[string]string `json:"Labels"`
		Cmd        []string          `json:"Cmd"`
		Entrypoint []string          `json:"Entrypoint"`
	} `json:"Config"`
}

func (s *ImageService) InspectDockerImage(sourceID string, imageID string) (DockerImageDetail, error) {
	if !validImageReference(imageID) {
		return DockerImageDetail{}, errors.New("镜像 ID 无效")
	}
	output, err := s.runDocker(sourceID, []string{"image", "inspect", imageID}, imageCommandTimeout)
	if err != nil {
		return DockerImageDetail{}, err
	}
	var entries []dockerImageInspectJSON
	if err := json.Unmarshal(output, &entries); err != nil {
		return DockerImageDetail{}, fmt.Errorf("解析 Docker 镜像详情失败: %w", err)
	}
	if len(entries) == 0 {
		return DockerImageDetail{}, errors.New("Docker 镜像详情为空")
	}
	item := entries[0]
	tags := append([]string(nil), item.RepoTags...)
	name := ""
	if len(tags) > 0 {
		name = tags[0]
	}
	return DockerImageDetail{ID: item.ID, Name: name, Tags: tags, Size: item.Size, CreatedAt: item.Created, Architecture: item.Architecture, OS: item.OS, Labels: item.Config.Labels, Command: item.Config.Cmd, Entrypoint: item.Config.Entrypoint}, nil
}

func (s *ImageService) PushDockerImage(sourceID string, image string) (DockerOperationResult, error) {
	result := DockerOperationResult{Image: image}
	if !validImageReference(image) {
		result.Error = "镜像引用无效"
		return result, errors.New(result.Error)
	}
	output, err := s.runDocker(sourceID, []string{"image", "push", image}, imagePushTimeout)
	result.Output = string(output)
	if err != nil {
		result.Error = err.Error()
		return result, nil
	}
	result.Success = true
	return result, nil
}

func (s *ImageService) DeleteDockerImages(sourceID string, imageIDs []string) DockerDeleteResult {
	result := DockerDeleteResult{Deleted: []string{}, Failed: []DockerDeleteFailure{}}
	seen := make(map[string]bool)
	ids := make([]string, 0, len(imageIDs))
	for _, imageID := range imageIDs {
		imageID = strings.TrimSpace(imageID)
		if seen[imageID] {
			continue
		}
		seen[imageID] = true
		ids = append(ids, imageID)
	}
	if len(ids) > maxDockerDeleteImages {
		for _, imageID := range ids[maxDockerDeleteImages:] {
			result.Failed = append(result.Failed, DockerDeleteFailure{ImageID: imageID, Error: "超过镜像删除数量限制"})
		}
		ids = ids[:maxDockerDeleteImages]
	}
	for _, imageID := range ids {
		if !validImageReference(imageID) {
			result.Failed = append(result.Failed, DockerDeleteFailure{ImageID: imageID, Error: "镜像 ID 无效"})
			continue
		}
		_, err := s.runDocker(sourceID, []string{"image", "rm", imageID}, imageCommandTimeout)
		if err != nil {
			result.Failed = append(result.Failed, DockerDeleteFailure{ImageID: imageID, Error: err.Error()})
			continue
		}
		result.Deleted = append(result.Deleted, imageID)
	}
	return result
}
