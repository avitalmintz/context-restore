# Context Restore iOS Companion

This folder now includes a runnable SwiftUI iOS app target wired to `ContextRestoreIOSKit`.

## Current state
- Spec complete: `ios/docs/IOS_COMPANION_APP_SPEC.md`
- Swift package: `ios/app`
- Xcode app project: `ios/ContextRestoreiOS.xcodeproj`
- Backend sync API: `backend/`

## Open and run
1. Open `ios/ContextRestoreiOS.xcodeproj` in Xcode.
2. Choose an iOS Simulator and press Run.
3. In the app, go to `Settings` and set Backend URL + API token.

## Regenerate project (if needed)
- `ruby ios/scripts/generate_xcodeproj.rb`
