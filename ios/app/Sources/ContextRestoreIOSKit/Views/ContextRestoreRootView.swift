import SwiftUI

public struct ContextRestoreRootView: View {
    @StateObject private var viewModel: TaskFeedViewModel

    public init() {
        _viewModel = StateObject(wrappedValue: TaskFeedViewModel())
    }

    public var body: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.98, green: 0.96, blue: 0.93),
                    Color(red: 0.92, green: 0.95, blue: 0.92),
                    Color(red: 0.92, green: 0.95, blue: 0.98)
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
            .ignoresSafeArea()

            TabView {
                OverviewTabView(viewModel: viewModel)
                    .tabItem {
                        Label("Overview", systemImage: "tray.full")
                    }

                DetailedBriefsTabView(viewModel: viewModel)
                    .tabItem {
                        Label("Action Plan", systemImage: "checklist")
                    }

                SettingsTabView(viewModel: viewModel)
                    .tabItem {
                        Label("Settings", systemImage: "gearshape")
                    }
            }
            .tint(ContextUI.accent)
        }
        .task {
            await viewModel.registerDeviceIfNeeded(force: false)
            await viewModel.refresh(limit: 100)
        }
    }
}
