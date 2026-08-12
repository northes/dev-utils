package main

import (
	"embed"
	"encoding/json"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"time"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed assets/tray/*.png
var trayAssets embed.FS

type windowState struct {
	X int `json:"x"`
	Y int `json:"y"`
	W int `json:"w"`
	H int `json:"h"`
}

func windowStatePath() string {
	if dir, err := os.UserConfigDir(); err == nil {
		return filepath.Join(dir, "DevUtils", "window-state.json")
	}
	return filepath.Join(os.TempDir(), "devutils-window-state.json")
}

func loadWindowState() *windowState {
	b, err := os.ReadFile(windowStatePath())
	if err != nil {
		return nil
	}
	var s windowState
	if err := json.Unmarshal(b, &s); err != nil || s.W <= 0 || s.H <= 0 {
		return nil
	}
	return &s
}

func saveWindowState(s *windowState) {
	b, err := json.Marshal(s)
	if err != nil {
		return
	}
	p := windowStatePath()
	if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
		return
	}
	_ = os.WriteFile(p, b, 0o600)
}

const appName = "DevUtils"

func main() {
	saved := loadWindowState()
	width, height := 720, 520
	x, y := 0, 0
	if saved != nil {
		width, height = saved.W, saved.H
		x, y = saved.X, saved.Y
	}

	cfgService := NewConfigService()

	app := application.New(application.Options{
		Name:        appName,
		Description: "Local-first developer utility launcher",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Services: []application.Service{
			application.NewService(cfgService),
		},
		Mac: application.MacOptions{
			ActivationPolicy: application.ActivationPolicyAccessory,
		},
	})

	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             appName,
		Title:            appName,
		Width:            width,
		Height:           height,
		X:                x,
		Y:                y,
		InitialPosition:  application.WindowXY,
		MinWidth:         640,
		MinHeight:        440,
		DisableResize:    false,
		BackgroundColour: application.NewRGB(17, 17, 19),
		URL:              "/",
		Mac: application.MacWindow{
			Appearance: application.NSAppearanceNameDarkAqua,
			Backdrop:   application.MacBackdropTranslucent,
			// TitleBar: application.MacTitleBar{
			// 	AppearsTransparent: true,
			// 	Hide:               false,
			// 	HideTitle:          true,
			// 	FullSizeContent:    false,
			// },
			TitleBar: application.MacTitleBarHiddenInset,
			WebviewPreferences: application.MacWebviewPreferences{
				AllowsBackForwardNavigationGestures: application.Enabled,
			},
		},
	})

	var saveTimer *time.Timer
	persistBounds := func() {
		x, y := window.Position()
		w, h := window.Size()
		saved = &windowState{X: x, Y: y, W: w, H: h}
		if saveTimer != nil {
			saveTimer.Stop()
		}
		saveTimer = time.AfterFunc(400*time.Millisecond, func() { saveWindowState(saved) })
	}
	flushBounds := func() {
		if saveTimer != nil {
			saveTimer.Stop()
			saveTimer = nil
		}
		if saved != nil {
			saveWindowState(saved)
		}
	}
	window.RegisterHook(events.Common.WindowDidMove, func(*application.WindowEvent) { persistBounds() })
	window.RegisterHook(events.Common.WindowDidResize, func(*application.WindowEvent) { persistBounds() })
	app.OnShutdown(flushBounds)

	en := cfgService.Get().Language == "en-US"
	tray := app.SystemTray.New()
	if en {
		tray.SetTooltip("DevUtils — local dev tools")
	} else {
		tray.SetTooltip("DevUtils — 本地开发工具")
	}
	macTrayIcon, err := trayAssets.ReadFile("assets/tray/tray-mac-template.png")
	if err != nil {
		log.Fatal(err)
	}
	trayLight, err := trayAssets.ReadFile("assets/tray/tray-light.png")
	if err != nil {
		log.Fatal(err)
	}
	if runtime.GOOS == "darwin" {
		tray.SetTemplateIcon(macTrayIcon)
	} else {
		tray.SetIcon(trayLight)
	}
	showFromTray := func() {
		window.Show().Focus()
		window.SetAlwaysOnTop(false)
	}
	analyzeClipboard := func() {
		showFromTray()
		app.Event.Emit("tray:analyze")
	}

	menu := app.Menu.New()
	if en {
		menu.Add("Clipboard detection ready").SetEnabled(false)
	} else {
		menu.Add("剪贴板检测就绪").SetEnabled(false)
	}
	menu.AddSeparator()
	if en {
		menu.Add("Open DevUtils").OnClick(func(_ *application.Context) { analyzeClipboard() })
		menu.Add("Settings").OnClick(func(_ *application.Context) {
			showFromTray()
			app.Event.Emit("navigate", "settings")
		})
		menu.AddSeparator()
		menu.Add("Quit").OnClick(func(_ *application.Context) { app.Quit() })
	} else {
		menu.Add("打开 DevUtils").OnClick(func(_ *application.Context) { analyzeClipboard() })
		menu.Add("设置").OnClick(func(_ *application.Context) {
			showFromTray()
			app.Event.Emit("navigate", "settings")
		})
		menu.AddSeparator()
		menu.Add("退出").OnClick(func(_ *application.Context) { app.Quit() })
	}
	tray.AttachWindow(window).SetMenu(menu)
	tray.OnClick(func() { analyzeClipboard() })

	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		x, y := window.Position()
		w, h := window.Size()
		saveWindowState(&windowState{X: x, Y: y, W: w, H: h})
		window.Hide()
		event.Cancel()
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
