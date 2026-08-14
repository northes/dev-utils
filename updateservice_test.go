package main

import (
	"testing"

	"github.com/wailsapp/wails/v3/pkg/updater"
	githubprovider "github.com/wailsapp/wails/v3/pkg/updater/providers/github"
)

func TestMatchGitHubUpdateAssetPrefersZipForCurrentArchitecture(t *testing.T) {
	assets := []githubprovider.ReleaseAsset{
		{Name: "DevUtils-0.2.0-darwin-arm64.dmg"},
		{Name: "DevUtils-0.2.0-darwin-amd64.zip"},
		{Name: "DevUtils-0.2.0-darwin-arm64.zip"},
	}
	got := matchGitHubUpdateAsset(updater.CheckRequest{Platform: "darwin", Arch: "arm64"}, assets)
	if got != 2 {
		t.Fatalf("期望选择 arm64 ZIP（索引 2），实际为 %d", got)
	}
}

func TestMatchGitHubUpdateAssetRejectsInstallerOnlyRelease(t *testing.T) {
	assets := []githubprovider.ReleaseAsset{{Name: "DevUtils-0.2.0-darwin-arm64.dmg"}}
	got := matchGitHubUpdateAsset(updater.CheckRequest{Platform: "darwin", Arch: "arm64"}, assets)
	if got != -1 {
		t.Fatalf("只有 DMG 时不应作为应用内更新包，实际为 %d", got)
	}
}
