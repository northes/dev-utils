package main

import (
	"embed"
	"log"
	"runtime"

	"github.com/wailsapp/wails/v3/pkg/application"
	"github.com/wailsapp/wails/v3/pkg/events"
	"github.com/wailsapp/wails/v3/pkg/icons"
)

//go:embed all:frontend/dist
var assets embed.FS

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
		Width:            600,
		Height:           420,
		MinWidth:         520,
		MinHeight:        380,
		DisableResize:    false,
		BackgroundColour: application.NewRGB(17, 17, 19),
		URL:              "/",
		Mac: application.MacWindow{
			InvisibleTitleBarHeight: 48,
			Backdrop:                application.MacBackdropTranslucent,
			TitleBar:                application.MacTitleBarHiddenInset,
		},
	})

	tray := app.SystemTray.New()
	tray.SetTooltip("DevUtils — local developer tools")
	if runtime.GOOS == "darwin" {
		tray.SetTemplateIcon(icons.SystrayMacTemplate)
	} else {
		tray.SetIcon(icons.SystrayLight)
	}
	menu := app.Menu.New()
	menu.Add("Clipboard detection ready").SetEnabled(false)
	menu.AddSeparator()
	menu.Add("Open DevUtils").OnClick(func(_ *application.Context) { tray.ShowWindow() })
	menu.Add("Settings").OnClick(func(_ *application.Context) {
		tray.ShowWindow()
		app.Event.Emit("navigate", "settings")
	})
	menu.AddSeparator()
	menu.Add("Quit").OnClick(func(_ *application.Context) { app.Quit() })
	tray.AttachWindow(window).WindowOffset(5).SetMenu(menu)

	window.RegisterHook(events.Common.WindowClosing, func(event *application.WindowEvent) {
		window.Hide()
		event.Cancel()
	})

	if err := app.Run(); err != nil {
		log.Fatal(err)
	}
}
