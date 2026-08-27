package main

import (
	"errors"
	"fmt"
	"os"

	"github.com/wailsapp/wails/v3/pkg/application"
)

// FileService 提供需要原生文件对话框的文件操作。
type FileService struct{}

func NewFileService() *FileService { return &FileService{} }

func (s *FileService) ServiceName() string { return "FileService" }

// SaveText 打开原生保存对话框，并将文本以 UTF-8 写入用户选择的路径。
// 返回实际保存路径；用户取消时返回空路径和 nil error。
func (s *FileService) SaveText(content string, filename string) (string, error) {
	app := application.Get()
	if app == nil || app.Dialog == nil {
		return "", errors.New("应用尚未初始化")
	}

	dialog := app.Dialog.SaveFile().
		SetFilename(filename).
		CanCreateDirectories(true).
		AllowsOtherFileTypes(true).
		AddFilter("JSON", "*.json").
		AddFilter("XML", "*.xml").
		AddFilter("TOML", "*.toml").
		AddFilter("YAML", "*.yaml;*.yml").
		AddFilter("CSV", "*.csv")
	if window := app.Window.Current(); window != nil {
		dialog.AttachToWindow(window)
	}

	path, err := dialog.PromptForSingleSelection()
	if err != nil {
		return "", fmt.Errorf("选择保存路径: %w", err)
	}
	if path == "" {
		return "", nil
	}

	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		return "", fmt.Errorf("写入文件 %q: %w", path, err)
	}
	return path, nil
}
