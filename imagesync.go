package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/google/go-containerregistry/pkg/name"
	"github.com/google/go-containerregistry/pkg/v1/remote"
)

// WatchDockerImagesEvent 是 image-manager:watch-docker-images 事件负载。
// 字段与前端 ImageManagerTool 中的 WatchDockerImagesEvent 契约一一对应：
// 每个事件经单一 committer 顺序分配自增 revision；generation 在每次新的
// Watch run 建立或来源 fingerprint 变化时自增，前端据此丢弃过期事件并重建列表。
type WatchDockerImagesEvent struct {
	ClientID   string         `json:"clientID"`
	SourceID   string         `json:"sourceID"`
	Generation uint64         `json:"generation,omitempty"`
	Revision   uint64         `json:"revision,omitempty"`
	Kind       string         `json:"kind,omitempty"`
	Images     []DockerImage  `json:"images,omitempty"`
	Image      *DockerImage   `json:"image,omitempty"`
	ImageID    string         `json:"imageID,omitempty"`
	ImageIDs   []string       `json:"imageIDs,omitempty"`
	Status     *DockerStatus  `json:"status,omitempty"`
	Progress   *WatchProgress `json:"progress,omitempty"`
	IsUpdating *bool          `json:"isUpdating,omitempty"`
	Error      string         `json:"error,omitempty"`
}

// WatchProgress 是后台扫描进度，stage 取值见下方常量。
type WatchProgress struct {
	Scanned int    `json:"scanned,omitempty"`
	Total   int    `json:"total,omitempty"`
	Stage   string `json:"stage,omitempty"`
}

const (
	watchDockerImagesEventName = "image-manager:watch-docker-images"

	watchStageScanning = "scanning"
	watchStageDone     = "done"
	watchStageFailed   = "failed"

	watchEventKindSnapshot = "snapshot"
	watchEventKindCreate   = "create"
	watchEventKindUpdate   = "update"
	watchEventKindDelete   = "delete"

	watchInterRoundDelay = 10 * time.Second
	watchScanMaxDocker   = 50
	watchScanMaxRegistry = 200

	// watchRegistryCallTimeout 是单个 registry 调用（catalog 页/tags 列表）的预算。
	watchRegistryCallTimeout = 30 * time.Second
)

// watchScan 是某 sourceID+fingerprint 的权威完整列表缓存。
type watchScan struct {
	index map[string]DockerImage
}

// watchWorker 持有单个 watch run 的全部运行状态。
// 每个 WatchDockerImages 调用建立且仅建立一个 worker；新调用替换旧 worker
// （取消并等待旧 done）后发布自身，保证任意时刻至多一个活跃 run。
type watchWorker struct {
	service     *ImageService
	clientID    string
	sourceID    string
	ctx         context.Context
	cancel      context.CancelFunc
	done        chan struct{}
	stopBound   func() bool
	generation  uint64
	fingerprint string

	// emitMu 是唯一事件提交锁：revision 分配与事件同步发送都在锁内完成，
	// 保证任何并发数据路径（diff、detail 补全 worker、状态）的事件顺序单调。
	emitMu   sync.Mutex
	revision uint64
}

func (w *watchWorker) stop() {
	if w.cancel != nil {
		w.cancel()
	}
	if w.done != nil {
		<-w.done
	}
}

func (w *watchWorker) releaseBound() {
	if w.stopBound != nil {
		w.stopBound()
		w.stopBound = nil
	}
}

func watchSnapshotKey(sourceID, fingerprint string) string {
	return sourceID + "\x00" + fingerprint
}

// watchPreviousSnapshot 返回当前 sourceID+fingerprint 的权威缓存。
func (s *ImageService) watchPreviousSnapshot(worker *watchWorker, fingerprint string) (map[string]DockerImage, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.watchSnapshots == nil {
		s.watchSnapshots = make(map[string]*watchScan)
	}
	scan := s.watchSnapshots[watchSnapshotKey(worker.sourceID, fingerprint)]
	if scan != nil {
		return scan.index, true
	}
	return nil, false
}

func (s *ImageService) storeWatchSnapshot(worker *watchWorker, fingerprint string, index map[string]DockerImage) {
	s.mu.Lock()
	if s.watchSnapshots == nil {
		s.watchSnapshots = make(map[string]*watchScan)
	}
	s.watchSnapshots[watchSnapshotKey(worker.sourceID, fingerprint)] = &watchScan{index: index}
	s.mu.Unlock()
}

func (w *watchWorker) setFingerprint(fingerprint string) bool {
	w.emitMu.Lock()
	defer w.emitMu.Unlock()
	if w.fingerprint == fingerprint {
		return false
	}
	if w.fingerprint != "" {
		w.generation++
		w.revision = 0
	}
	w.fingerprint = fingerprint
	return true
}

func watchImagesFromIndex(index map[string]DockerImage) []DockerImage {
	images := make([]DockerImage, 0, len(index))
	for _, image := range index {
		images = append(images, image)
	}
	sort.Slice(images, func(i, j int) bool { return images[i].ID < images[j].ID })
	return images
}

// startWatchRun 取消并等待旧 run 退出，随后完整初始化并发布新 worker。
// 调用方随后启动 watchLoop 并阻塞直到 ctx 取消或 run 结束。
func (s *ImageService) startWatchRun(ctx context.Context, clientID, sourceID string) (*watchWorker, error) {
	if s == nil {
		return nil, errors.New("镜像服务未配置")
	}
	if ctx == nil {
		return nil, errors.New("无效的调用上下文")
	}
	s.watchStartMu.Lock()
	defer s.watchStartMu.Unlock()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	s.mu.Lock()
	old := s.watchWorker
	s.mu.Unlock()
	if old != nil {
		// 发布前取消并等待旧 run 完全退出，保证任意时刻至多一个活跃 run。
		old.stop()
	}
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	runCtx, runCancel := context.WithCancel(s.serviceContext())
	worker := &watchWorker{
		service:   s,
		clientID:  clientID,
		sourceID:  sourceID,
		ctx:       runCtx,
		cancel:    runCancel,
		done:      make(chan struct{}),
		stopBound: context.AfterFunc(ctx, runCancel),
	}
	if err := runCtx.Err(); err != nil {
		worker.releaseBound()
		close(worker.done)
		return nil, err
	}
	s.mu.Lock()
	s.watchGeneration++
	worker.generation = s.watchGeneration
	s.watchWorker = worker
	s.mu.Unlock()
	return worker, nil
}

// stopWatch 由 shutdown 调用，摘除并等待当前 run 退出。
func (s *ImageService) stopWatch() {
	s.mu.Lock()
	worker := s.watchWorker
	s.watchWorker = nil
	s.mu.Unlock()
	if worker != nil {
		worker.stop()
	}
}

// WatchDockerImages 是长生命周期、可取消的 Wails 绑定方法。
// 阻塞直到调用方 ctx 取消或本 run 被替换/服务关闭；返回 nil 表示正常结束。
func (s *ImageService) WatchDockerImages(ctx context.Context, sourceID string, clientID string) error {
	if s == nil {
		return errors.New("镜像服务未配置")
	}
	if sourceID == "" || clientID == "" {
		return errors.New("sourceID 与 clientID 不能为空")
	}
	if err := ctx.Err(); err != nil {
		return nil
	}
	worker, err := s.startWatchRun(ctx, clientID, sourceID)
	if err != nil {
		return nil
	}
	go s.watchLoop(worker)
	select {
	case <-ctx.Done():
		// 调用方取消：若本 run 仍是当前 run 则等待其退出。
		s.mu.Lock()
		current := s.watchWorker
		s.mu.Unlock()
		if current == worker {
			worker.stop()
		}
		return nil
	case <-worker.done:
		return nil
	}
}

// watchLoop 是非重入循环：上一轮完成后再等待 watchInterRoundDelay 秒。
func (s *ImageService) watchLoop(worker *watchWorker) {
	defer worker.releaseBound()
	defer close(worker.done)
	s.logWatch(worker, "watch 循环启动")
	for {
		if err := worker.ctx.Err(); err != nil {
			return
		}
		s.runWatchRound(worker)
		timer := time.NewTimer(watchInterRoundDelay)
		select {
		case <-worker.ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
		}
	}
}

// runWatchRound 执行一轮扫描与 diff。CLI/status 操作都从 worker.ctx 派生并带 timeout。
func (s *ImageService) runWatchRound(worker *watchWorker) {
	source, cliPath, fingerprint, err := s.sourceSnapshot(worker.sourceID)
	if err == nil && worker.setFingerprint(fingerprint) {
		cached, _ := s.watchPreviousSnapshot(worker, fingerprint)
		s.emitWatchEvent(worker, s.watchSnapshotEvent(worker, watchImagesFromIndex(cached)))
	}
	status := DockerStatus{CLIPath: cliPath}
	if err == nil {
		status = s.sourceConnectionStatusContext(worker.ctx, source, cliPath)
	}
	s.emitWatchEvent(worker, s.watchScanningEvent(worker, &status))
	if err != nil {
		s.failWatchRound(worker, err)
		return
	}
	ctx, cancel := context.WithCancel(worker.ctx)
	defer cancel()
	var images []DockerImage
	var index map[string]DockerImage
	if source.Kind == "registry" {
		prev, _ := s.watchPreviousSnapshot(worker, fingerprint)
		result, scanErr := s.scanRegistryFlow(ctx, worker, source, prev)
		if scanErr != nil {
			s.failWatchRound(worker, scanErr)
			return
		}
		images = result.images
		index = result.index
	} else {
		images, err = s.scanDockerSource(ctx, worker, source, cliPath)
		if err != nil {
			s.failWatchRound(worker, err)
			return
		}
		index = indexImages(images)
		// 同一 generation 内做精准 diff，generation 变化时发 snapshot。
		s.diffWatchRound(worker, fingerprint, images)
	}
	if worker.ctx.Err() != nil {
		return
	}
	// 扫描成功才更新权威缓存与 inventory（供详情缓存 Name/Tags 补充）。
	s.storeWatchSnapshot(worker, fingerprint, index)
	s.updateImageInventory(worker.sourceID, fingerprint, source, images)
	if worker.ctx.Err() != nil {
		return
	}
	doneEvent := s.watchStateEvent(worker, watchStageDone, len(images), len(images), "")
	doneEvent.Status = &status
	s.emitWatchEvent(worker, doneEvent)
}

// diffWatchRound 计算上一轮与本轮差异并推送精准事件（Docker/SSH 源）。
func (s *ImageService) diffWatchRound(worker *watchWorker, fingerprint string, images []DockerImage) {
	previous, hasPrevious := s.watchPreviousSnapshot(worker, fingerprint)
	current := indexImages(images)
	var events []WatchDockerImagesEvent
	if hasPrevious {
		for id, old := range previous {
			if _, ok := current[id]; !ok {
				events = append(events, s.watchDeleteEvent(worker, id))
			} else if !dockerImagesEqual(old, current[id]) {
				image := current[id]
				events = append(events, s.watchImageEvent(worker, watchEventKindUpdate, &image))
			}
		}
		for id, image := range current {
			if _, ok := previous[id]; !ok {
				events = append(events, s.watchImageEvent(worker, watchEventKindCreate, &image))
			}
		}
	} else {
		events = append(events, s.watchSnapshotEvent(worker, images))
	}
	for _, event := range events {
		s.emitWatchEvent(worker, event)
	}
}

// scanWatchSource 分别扫描 Docker 与 Registry 来源。
func (s *ImageService) scanWatchSource(ctx context.Context, worker *watchWorker, source ImageSource, cliPath string) ([]DockerImage, error) {
	if source.Kind == "registry" {
		return nil, errors.New("registry 来源走 scanRegistryFlow")
	}
	return s.scanDockerSource(ctx, worker, source, cliPath)
}

// scanDockerSource 通过 Docker CLI 查询本地/SSH 镜像。
func (s *ImageService) scanDockerSource(ctx context.Context, worker *watchWorker, source ImageSource, cliPath string) ([]DockerImage, error) {
	commandCtx, cancel := context.WithTimeout(ctx, imageCommandTimeout)
	defer cancel()
	output, err := s.runDockerSnapshotContext(commandCtx, source, cliPath, []string{"image", "ls", "--no-trunc", "--format", "{{json .}}"})
	if err != nil {
		return nil, redactImageError(err, source)
	}
	byID := make(map[string]int)
	images := make([]DockerImage, 0, watchScanMaxDocker)
	for _, rawLine := range strings.Split(string(output), "\n") {
		line := strings.TrimSpace(rawLine)
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
		if index, ok := byID[item.ID]; ok {
			if name != "" && !containsString(images[index].Tags, name) {
				images[index].Tags = append(images[index].Tags, name)
			}
			continue
		}
		byID[item.ID] = len(images)
		images = append(images, DockerImage{ID: item.ID, Name: name, Tags: []string{name}, Size: item.Size, SizeBytes: parseDockerImageSize(item.Size), CreatedAt: item.CreatedAt})
	}
	sort.Slice(images, func(i, j int) bool { return images[i].ID < images[j].ID })
	return images, nil
}

// watchRegistryResult 是一轮 registry 流式扫描的结果。
type watchRegistryResult struct {
	index  map[string]DockerImage
	images []DockerImage
}

// scanRegistryFlow 流式处理 catalog/repo/tags，并保持详情补全与 catalog 并发流水：
//   - repo tags 成功后立即对 base 对象做精确 create/tag-delete 并更新 cur；
//   - 详情补全走独立 worker 池（imageDetailConcurrency），只在实际变化时 emit update；
//     detail 失败保留历史元数据（用 prev 覆盖，避免退化覆盖 digest）；
//   - repo 级 delete 只在 catalog 完整成功（无截断、无错误）后执行；
//   - 任何截断/异常整体返回错误，禁止一切 delete。
func (s *ImageService) scanRegistryFlow(ctx context.Context, worker *watchWorker, source ImageSource, prev map[string]DockerImage) (*watchRegistryResult, error) {
	registry, err := registryEndpoint(source)
	if err != nil {
		return nil, err
	}
	options := s.registryOptions(ctx, source)
	puller, err := remote.NewPuller(options...)
	if err != nil {
		return nil, fmt.Errorf("创建 Registry 客户端失败: %w", redactRegistryError(err, source))
	}
	cur := make(map[string]DockerImage)
	catalogRepos := make(map[string]bool)
	pendingDeletes := make([]string, 0)
	var mu sync.Mutex
	jobs := make(chan DockerImage, imageDetailConcurrency*4)
	var detailWG sync.WaitGroup
	for i := 0; i < imageDetailConcurrency; i++ {
		detailWG.Add(1)
		go func() {
			defer detailWG.Done()
			for base := range jobs {
				s.registryDetailWorker(ctx, worker, source, puller, prev, base, cur, &mu)
			}
		}()
	}
	scanErr := func() error {
		const pageSize = 100
		last := ""
		scanned := 0
		for {
			if scanned >= watchScanMaxRegistry {
				return errors.New("Registry 仓库数量达到 watch 上限，目录截断")
			}
			page, err := s.registryCatalogPage(ctx, registry, last, pageSize, options)
			if err != nil {
				return fmt.Errorf("枚举 Registry 仓库失败: %w", redactRegistryError(err, source))
			}
			if len(page) == 0 {
				return nil
			}
			if len(page) > pageSize {
				return errors.New("Registry 目录页异常，扫描非权威")
			}
			scanned += len(page)
			for _, repositoryName := range page {
				repo, repoErr := registryRepository(source, repositoryName)
				if repoErr != nil {
					continue
				}
				callCtx, callCancel := context.WithTimeout(ctx, watchRegistryCallTimeout)
				tags, tagsErr := puller.List(callCtx, repo)
				callCancel()
				if tagsErr != nil {
					return fmt.Errorf("枚举 Registry 仓库 %q 的标签失败: %w", repositoryName, redactRegistryError(tagsErr, source))
				}
				if len(tags) > maxRegistryTags {
					return fmt.Errorf("Registry 仓库 %q 的标签数量超过限制，扫描非权威", repositoryName)
				}
				mu.Lock()
				catalogRepos[repositoryName] = true
				mu.Unlock()
				s.commitRegistryRepo(worker, jobs, repositoryName, tags, prev, cur, &mu, &pendingDeletes)
			}
			if len(page) < pageSize {
				return nil
			}
			next := page[len(page)-1]
			if next == last {
				return errors.New("Registry 仓库目录分页未前进，扫描非权威")
			}
			last = next
		}
	}()
	close(jobs)
	detailWG.Wait()
	if scanErr != nil {
		return nil, scanErr
	}
	// catalog 与所有 tags 均成功后，才提交本轮积累的删除。
	mu.Lock()
	for id, img := range prev {
		if !catalogRepos[img.Repository] {
			pendingDeletes = append(pendingDeletes, id)
		}
	}
	mu.Unlock()
	for _, id := range pendingDeletes {
		s.emitWatchEvent(worker, s.watchDeleteEvent(worker, id))
	}
	// detail 补全失败的条目保留历史元数据（prev 覆盖 base），防止 digest 退化。
	mu.Lock()
	for id, img := range cur {
		if img.Digest == "" {
			if previous, ok := prev[id]; ok {
				cur[id] = previous
			}
		}
	}
	result := make([]DockerImage, 0, len(cur))
	for _, image := range cur {
		result = append(result, image)
	}
	sort.Slice(result, func(i, j int) bool { return result[i].ID < result[j].ID })
	mu.Unlock()
	return &watchRegistryResult{index: cur, images: result}, nil
}

// registryCatalogPage 对单次 catalog 分页调用设 timeout。
func (s *ImageService) registryCatalogPage(ctx context.Context, registry name.Registry, last string, pageSize int, options []remote.Option) ([]string, error) {
	callCtx, cancel := context.WithTimeout(ctx, watchRegistryCallTimeout)
	defer cancel()
	callOptions := make([]remote.Option, 0, len(options)+1)
	callOptions = append(callOptions, options...)
	callOptions = append(callOptions, remote.WithContext(callCtx))
	return remote.CatalogPage(registry, last, pageSize, callOptions...)
}

// commitRegistryRepo 在 repo tags 成功后原子提交该 repo 的 base 对象：
//   - 新 tag（prev 无）→ create(base)；已有 tag 不在此降级，交给 detail 判定；
//   - 该 repo 内 prev 有而 cur 无的 tag → delete（该 repo tags 已成功，权威）；
//   - 所有 base 进入 cur 并送入详情补全池。
func (s *ImageService) commitRegistryRepo(worker *watchWorker, jobs chan<- DockerImage, repositoryName string, tags []string, prev map[string]DockerImage, cur map[string]DockerImage, mu *sync.Mutex, pendingDeletes *[]string) {
	mu.Lock()
	var baseList []DockerImage
	repoIDs := make(map[string]bool)
	for _, tag := range tags {
		if !validRegistryTag(tag) {
			continue
		}
		id := registryTagImageID(repositoryName, tag)
		base := DockerImage{ID: id, Name: id, Tags: []string{id}, Repository: repositoryName}
		cur[id] = base
		baseList = append(baseList, base)
		repoIDs[id] = true
	}
	tagDeletes := make([]string, 0)
	creates := make([]DockerImage, 0, len(baseList))
	for id, img := range prev {
		if img.Repository == repositoryName && !repoIDs[id] {
			tagDeletes = append(tagDeletes, id)
		}
	}
	for _, base := range baseList {
		if _, ok := prev[base.ID]; !ok {
			creates = append(creates, base)
		}
	}
	mu.Unlock()
	*pendingDeletes = append(*pendingDeletes, tagDeletes...)
	for _, base := range creates {
		image := base
		s.emitWatchEvent(worker, s.watchImageEvent(worker, watchEventKindCreate, &image))
	}
	// 送详情补全池（流水：不等待 catalog 全部读完）。
	for _, base := range baseList {
		select {
		case <-worker.ctx.Done():
			return
		case jobs <- base:
		}
	}
}

// registryDetailWorker 从池中取 base 补全详情；只在实际变化时 emit update。
func (s *ImageService) registryDetailWorker(ctx context.Context, worker *watchWorker, source ImageSource, puller *remote.Puller, prev map[string]DockerImage, base DockerImage, cur map[string]DockerImage, mu *sync.Mutex) {
	metadata, err := s.fetchRegistryImageMetadata(ctx, source, base.ID, puller)
	if err != nil {
		if !errors.Is(err, context.Canceled) && !errors.Is(err, context.DeadlineExceeded) {
			log.Printf("Registry 镜像元数据加载失败 image=%s: %v", base.ID, redactRegistryError(err, source))
		}
		return
	}
	detail := DockerImage{
		ID:         base.ID,
		Name:       metadata.ImageID,
		Tags:       []string{metadata.ImageID},
		Repository: base.Repository,
		Digest:     metadata.Digest,
		MediaType:  metadata.MediaType,
		SizeType:   metadata.SizeType,
		Size:       metadata.Size,
		SizeBytes:  metadata.SizeBytes,
		CreatedAt:  metadata.CreatedAt,
	}
	var shouldEmit bool
	func() {
		mu.Lock()
		defer mu.Unlock()
		previous, hasPrev := prev[base.ID]
		if hasPrev && dockerImagesEqual(previous, detail) {
			// 与历史权威值一致，无实际变化：仅保持 cur 完整，不 emit。
			cur[base.ID] = detail
			return
		}
		if existing, ok := cur[base.ID]; ok && dockerImagesEqual(existing, detail) {
			return
		}
		cur[base.ID] = detail
		shouldEmit = true
	}()
	if shouldEmit {
		// 在 mu 之外发送 update，避免持锁回调。
		image := detail
		s.emitWatchEvent(worker, s.watchImageEvent(worker, watchEventKindUpdate, &image))
	}
}

// indexImages 以 ID 为键建立镜像索引。
func indexImages(images []DockerImage) map[string]DockerImage {
	result := make(map[string]DockerImage, len(images))
	for _, image := range images {
		result[image.ID] = image
	}
	return result
}

// dockerImagesEqual 比较 diff 相关的可展示字段。
func dockerImagesEqual(a, b DockerImage) bool {
	if a.ID != b.ID || a.Name != b.Name || a.Repository != b.Repository || a.Digest != b.Digest || a.MediaType != b.MediaType || a.SizeType != b.SizeType || a.SizeBytes != b.SizeBytes || a.CreatedAt != b.CreatedAt {
		return false
	}
	return stringSlicesEqual(a.Tags, b.Tags)
}

func (s *ImageService) logWatch(worker *watchWorker, message string) {
	log.Printf("[image-watch] source=%s client=%s generation=%d revision=%d %s", worker.sourceID, worker.clientID, worker.generation, worker.revision, message)
}

func (s *ImageService) failWatchRound(worker *watchWorker, err error) {
	if worker.ctx.Err() != nil {
		return
	}
	s.logWatch(worker, "扫描失败: "+err.Error())
	s.emitWatchEvent(worker, s.watchStateEvent(worker, watchStageFailed, 0, 0, err.Error()))
}

func (s *ImageService) watchStateEvent(worker *watchWorker, stage string, scanned, total int, errorMessage string) WatchDockerImagesEvent {
	return WatchDockerImagesEvent{
		ClientID:   worker.clientID,
		SourceID:   worker.sourceID,
		IsUpdating: boolPtr(stage != watchStageDone && stage != watchStageFailed),
		Progress:   &WatchProgress{Scanned: scanned, Total: total, Stage: stage},
		Error:      errorMessage,
	}
}

// watchScanningEvent 推送后台更新中状态，携带版本与 CLI 路径。
func (s *ImageService) watchScanningEvent(worker *watchWorker, status *DockerStatus) WatchDockerImagesEvent {
	return WatchDockerImagesEvent{
		ClientID:   worker.clientID,
		SourceID:   worker.sourceID,
		Status:     status,
		IsUpdating: boolPtr(true),
		Progress:   &WatchProgress{Scanned: 0, Total: 0, Stage: watchStageScanning},
	}
}

func (s *ImageService) watchSnapshotEvent(worker *watchWorker, images []DockerImage) WatchDockerImagesEvent {
	return WatchDockerImagesEvent{
		ClientID: worker.clientID,
		SourceID: worker.sourceID,
		Kind:     watchEventKindSnapshot,
		Images:   append([]DockerImage(nil), images...),
	}
}

func (s *ImageService) watchImageEvent(worker *watchWorker, kind string, image *DockerImage) WatchDockerImagesEvent {
	return WatchDockerImagesEvent{
		ClientID: worker.clientID,
		SourceID: worker.sourceID,
		Kind:     kind,
		Image:    image,
	}
}

func (s *ImageService) watchDeleteEvent(worker *watchWorker, imageID string) WatchDockerImagesEvent {
	return WatchDockerImagesEvent{
		ClientID: worker.clientID,
		SourceID: worker.sourceID,
		Kind:     watchEventKindDelete,
		ImageID:  imageID,
		ImageIDs: []string{imageID},
	}
}

// emitWatchEvent 是唯一事件提交入口：emitMu 保护下顺序分配 revision 并同步发送。
func (s *ImageService) emitWatchEvent(worker *watchWorker, event WatchDockerImagesEvent) {
	worker.emitMu.Lock()
	worker.revision++
	event.Generation = worker.generation
	event.Revision = worker.revision
	s.emitEvent(watchDockerImagesEventName, event)
	worker.emitMu.Unlock()
}

func boolPtr(value bool) *bool { return &value }
