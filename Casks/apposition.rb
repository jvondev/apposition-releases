cask "apposition" do
  version "1.1.5"
  sha256 :no_check

  url "https://github.com/jvondev/apposition-releases/releases/download/v#{version}/Apposition-#{version}-universal.dmg"
  name "Apposition"
  desc "A smart digital workspace to organize web apps, accounts, and tasks in one place"
  homepage "https://github.com/jvondev/apposition-releases"

  auto_updates true

  app "Apposition.app"

  zap trash: [
    "~/Library/Application Support/Apposition",
    "~/Library/Logs/Apposition",
    "~/Library/Preferences/com.jvondev.apposition.app.plist",
    "~/Library/Saved Application State/com.jvondev.apposition.app.savedState",
  ]
end
