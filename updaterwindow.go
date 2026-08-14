package main

import (
	"encoding/json"
	"fmt"
	"strings"
)

const updaterPreferencesEvent = "devutils:updater:preferences"

type updaterWindowResources struct {
	HTML  string
	Title string
}

type updaterLocaleFile struct {
	UpdaterWindow map[string]string `json:"updaterWindow"`
}

type updaterPreferences struct {
	Language string `json:"language"`
	Theme    string `json:"theme"`
}

func updaterPreferencesFromConfig(cfg Config) updaterPreferences {
	language := cfg.Language
	if language != "en-US" {
		language = "zh-CN"
	}
	theme := cfg.Theme
	if theme != "light" {
		theme = "dark"
	}
	return updaterPreferences{Language: language, Theme: theme}
}

func buildUpdaterWindow(template string, cfg Config) (updaterWindowResources, error) {
	translations := make(map[string]map[string]string, 2)
	requiredKeys := []string{"windowTitle", "checkingTitle", "checkingStatus", "availableTitle", "noReleaseNotes", "upToDateTitle", "upToDateStatus", "downloadingTitle", "preparingDownload", "downloaded", "downloadProgress", "verifyingTitle", "verifyingStatus", "installingTitle", "installingStatus", "readyTitle", "readyFallback", "errorTitle", "errorFallback", "skip", "remind", "close", "install", "restart", "retry"}
	for _, language := range []string{"zh-CN", "en-US"} {
		path := "frontend/src/locales/" + language + ".json"
		data, err := updaterLocaleAssets.ReadFile(path)
		if err != nil {
			return updaterWindowResources{}, fmt.Errorf("读取更新窗口翻译 %s: %w", language, err)
		}
		var locale updaterLocaleFile
		if err := json.Unmarshal(data, &locale); err != nil {
			return updaterWindowResources{}, fmt.Errorf("解析更新窗口翻译 %s: %w", language, err)
		}
		if len(locale.UpdaterWindow) == 0 {
			return updaterWindowResources{}, fmt.Errorf("更新窗口翻译 %s 为空", language)
		}
		for _, key := range requiredKeys {
			if locale.UpdaterWindow[key] == "" {
				return updaterWindowResources{}, fmt.Errorf("更新窗口翻译 %s 缺少 %s", language, key)
			}
		}
		translations[language] = locale.UpdaterWindow
	}
	encoded, err := json.Marshal(translations)
	if err != nil {
		return updaterWindowResources{}, fmt.Errorf("编码更新窗口翻译: %w", err)
	}
	preferences := updaterPreferencesFromConfig(cfg)
	html := strings.ReplaceAll(template, "__DEVUTILS_UPDATER_TRANSLATIONS__", string(encoded))
	html = strings.ReplaceAll(html, "__DEVUTILS_UPDATER_LANGUAGE__", preferences.Language)
	html = strings.ReplaceAll(html, "__DEVUTILS_UPDATER_THEME__", preferences.Theme)
	return updaterWindowResources{HTML: html, Title: translations[preferences.Language]["windowTitle"]}, nil
}
