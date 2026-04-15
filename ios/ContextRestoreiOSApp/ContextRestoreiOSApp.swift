import SwiftUI
import ContextRestoreIOSKit
import UIKit
import UserNotifications

final class ContextRestoreAppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }
}

@main
struct ContextRestoreiOSApp: App {
    @UIApplicationDelegateAdaptor(ContextRestoreAppDelegate.self) private var appDelegate

    var body: some Scene {
        WindowGroup {
            ContextRestoreRootView()
        }
    }
}
