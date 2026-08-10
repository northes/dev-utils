package main

import (
	"embed"
	"log"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
)

//go:embed all:frontend/dist
var assets embed.FS

//go:embed assets/tray/*.png
var trayAssets embed.FS

func main() {
	app := application.New(application.Options{
		Name:        "DevUtils",
		Description: "Local-first developer utility launcher",
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ActivationPolicy: application.ActivationPolicyAccessory,
		},
	})

	window := app.Window.NewWithOptions(application.WebviewWindowOptions{
		Name:             "DevUtils",
		Title:            "DevUtils",
		Width:            720,
		Height:           520,
		MinWidth:         640,
		MinHeight:        440,
		DisableResize:    false,
		BackgroundColour: application.NewRGB(17, 17, 19),
		URL:              "/",
		Mac: application.MacWindow{
			Appearance: application.NSAppearanceNameDarkAqua,
			Backdrop:   application.MacBackdropTranslucent,
			TitleBar: application.MacTitleBar{
				AppearsTransparent: true,
				Hide:               false,
				HideTitle:          false,
				FullSizeContent:    false,
			},
		},
	})

	tray := app.SystemTray.New()
	tray.SetTooltip("DevUtils — 本地开发工具")
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
	menu := app.Menu.New()
	menu.Add("剪贴板检测就绪").SetEnabled(false)
	menu.AddSeparator()
	menu.Add("打开 DevUtils").OnClick(func(_ *application.Context) { tray.ShowWindow() })
	menu.Add("设置").OnClick(func(_ *application.Context) {
		tray.ShowWindow()
		app.Event.Emit("navigate", "settings")
	})
	menu.AddSeparator()
	menu.Add("退出").OnClick(func(_ *application.Context) { app.Quit() })
	tray.AttachWindow(window).WindowOffset(5).SetMenu(menu)

	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		window.Hide()
		event.Cancel()
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
