/*
   PicoLume
   Copyright (C) 2025 PicoLume Project

   This program is free software: you can redistribute it and/or modify
   it under the terms of the GNU General Public License as published by
   the Free Software Foundation, either version 3 of the License, or
   (at your option) any later version.

   This program is distributed in the hope that it will be useful,
   but WITHOUT ANY WARRANTY; without even the implied warranty of
   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
   GNU General Public License for more details.

   You should have received a copy of the GNU General Public License
   along with this program.  If not, see <https://www.gnu.org/licenses/>.

   -- Built with AI assistance. PicoLume is developed with help from tools like
      ChatGPT, Claude, and Gemini.
*/

package main

import (
	"embed"
	"io/fs"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

//go:embed all:frontend
var assets embed.FS

func getAssets() fs.FS {
	sub, err := fs.Sub(assets, "frontend")
	if err != nil {
		panic(err)
	}
	return sub
}

func main() {
	// Create an instance of the app structure
	app := NewApp()

	// Create application with options
	err := wails.Run(&options.App{
		Title:     "PicoLume Studio",
		Frameless: true,
		Windows: &windows.Options{
			DisableWindowIcon: true,
		},
		Width:  1280,
		Height: 800,
		AssetServer: &assetserver.Options{
			Assets: getAssets(),
		},
		BackgroundColour: &options.RGBA{R: 27, G: 38, B: 54, A: 1},
		OnStartup:        app.startup,
		Bind: []interface{}{
			app,
		},

		WindowStartState: options.Maximised,
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
