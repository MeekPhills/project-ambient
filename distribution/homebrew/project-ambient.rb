cask "project-ambient" do
  version "0.1.0-alpha"
  sha256 "REPLACE_WITH_RELEASE_SHA256"

  url "https://github.com/MeekPhills/project-ambient/releases/download/v#{version}/Project-Ambient-#{version}.zip"
  name "Project Ambient"
  desc "Local-first, power-aware wallpaper channels for macOS"
  homepage "https://github.com/MeekPhills/project-ambient"

  depends_on macos: ">= :sonoma"

  app "Project Ambient.app"

  zap trash: [
    "~/Library/Application Support/Project Ambient",
    "~/Library/Preferences/com.projectambient.app.plist",
  ]
end
