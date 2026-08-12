cask "project-ambient" do
  version "0.1.0-alpha"
  sha256 "2298999e838d3c24241cdb3c57ff4e9fb5f6adb5963bd6d1998ec7d52883b2eb"

  url "https://github.com/MeekPhills/project-ambient/releases/download/v#{version}/Project-Ambient-#{version}.zip"
  name "Project Ambient"
  desc "Local-first, power-aware wallpaper channels for macOS"
  homepage "https://project-ambient.meekphillies.chatgpt.site"

  depends_on macos: ">= :sonoma"
  depends_on arch: :arm64

  app "Project Ambient/Project Ambient.app"
  binary "Project Ambient/ambientctl"

  zap trash: [
    "~/Library/Application Support/Project Ambient",
    "~/Library/Preferences/io.projectambient.mac.plist",
  ]

  caveats <<~EOS
    This alpha is not signed or notarized. Gatekeeper may block it.
    Do not disable Gatekeeper or remove quarantine attributes; build from source
    until a signed Project Ambient release is available.
  EOS
end
