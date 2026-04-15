import SwiftUI

public struct SettingsTabView: View {
    @ObservedObject private var viewModel: TaskFeedViewModel
    @State private var isRegistering: Bool = false
    @State private var isRefreshing: Bool = false
    @State private var isSavingNotifications: Bool = false
    @State private var isSendingTestNotification: Bool = false
    @State private var iosReminderEnabled: Bool = false
    @State private var iosReminderTime: Date = Date()
    @FocusState private var focusedField: Field?

    private enum Field {
        case baseURL
        case token
        case deviceLabel
    }

    public init(viewModel: TaskFeedViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(
                    colors: [
                        Color(red: 0.98, green: 0.96, blue: 0.93),
                        Color(red: 0.92, green: 0.95, blue: 0.98)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                Form {
                    Section {
                        ContextHeaderCard(
                            title: "Settings",
                            subtitle: "Sync, notifications, and device controls.",
                            icon: "gearshape"
                        )
                        .listRowInsets(EdgeInsets(top: 8, leading: 0, bottom: 8, trailing: 0))
                        .listRowBackground(Color.clear)
                    }

                    Section("Cloud Sync") {
                        TextField("Backend URL", text: baseURLBinding)
                            .focused($focusedField, equals: .baseURL)
                            .iosURLInputStyle()

                        SecureField("API token", text: tokenBinding)
                            .focused($focusedField, equals: .token)
                            .iosPlainInputStyle()

                        TextField("Device label", text: labelBinding)
                            .focused($focusedField, equals: .deviceLabel)

                        if !viewModel.config.deviceId.isEmpty {
                            LabeledContent("Device ID", value: viewModel.config.deviceId)
                                .font(.caption)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                    }

                    Section("iPhone Notifications") {
                        Toggle("Enable daily iPhone reminder", isOn: $iosReminderEnabled)
                        DatePicker(
                            "Reminder time",
                            selection: $iosReminderTime,
                            displayedComponents: .hourAndMinute
                        )
                        .datePickerStyle(.compact)

                        Button {
                            Task {
                                focusedField = nil
                                isSavingNotifications = true
                                let components = Calendar.current.dateComponents([.hour, .minute], from: iosReminderTime)
                                await viewModel.saveNotificationSettings(
                                    enabled: iosReminderEnabled,
                                    hour: components.hour ?? 20,
                                    minute: components.minute ?? 0
                                )
                                isSavingNotifications = false
                            }
                        } label: {
                            if isSavingNotifications {
                                HStack {
                                    ProgressView()
                                    Text("Saving schedule...")
                                }
                            } else {
                                Text("Save iPhone Reminder Schedule")
                            }
                        }
                        Button {
                            Task {
                                focusedField = nil
                                isSendingTestNotification = true
                                await viewModel.sendTestNotification()
                                isSendingTestNotification = false
                            }
                        } label: {
                            if isSendingTestNotification {
                                HStack {
                                    ProgressView()
                                    Text("Scheduling test...")
                                }
                            } else {
                                Text("Send Test Notification (5s)")
                            }
                        }
                    }

                    Section("Help") {
                        Text("Use the same Backend URL and API token as your Chrome extension settings. For iOS Simulator use http://127.0.0.1:8787.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    if !viewModel.errorMessage.isEmpty {
                        Section("Last Error") {
                            Text(viewModel.errorMessage)
                                .font(.footnote)
                                .foregroundStyle(.red)
                        }
                    }
                }
                .scrollContentBackground(.hidden)
            }
            .navigationTitle("Settings")
            .scrollDismissesKeyboard(.interactively)
            .toolbar {
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") {
                        focusedField = nil
                    }
                }
            }
            .safeAreaInset(edge: .bottom) {
                actionBar
            }
        }
        .task {
            iosReminderEnabled = viewModel.notificationSettings.enabled
            iosReminderTime = Self.dateFrom(hour: viewModel.notificationSettings.hour, minute: viewModel.notificationSettings.minute)
        }
    }

    private var actionBar: some View {
        HStack(spacing: 12) {
            Button {
                Task {
                    focusedField = nil
                    isRegistering = true
                    await viewModel.registerDeviceIfNeeded(force: true)
                    isRegistering = false
                }
            } label: {
                if isRegistering {
                    HStack(spacing: 6) {
                        ProgressView()
                        Text("Registering...")
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    Text("Register Device")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(!viewModel.hasConfiguredBackend || isRegistering || isRefreshing)

            Button {
                Task {
                    focusedField = nil
                    isRefreshing = true
                    await viewModel.refresh(limit: 100)
                    isRefreshing = false
                }
            } label: {
                if isRefreshing {
                    HStack(spacing: 6) {
                        ProgressView()
                        Text("Refreshing...")
                    }
                    .frame(maxWidth: .infinity)
                } else {
                    Text("Refresh")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.bordered)
            .disabled(!viewModel.hasConfiguredBackend || isRegistering || isRefreshing)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private var baseURLBinding: Binding<String> {
        Binding(
            get: { viewModel.config.baseURL },
            set: { value in
                var config = viewModel.config
                config.baseURL = value
                viewModel.config = config
            }
        )
    }

    private var tokenBinding: Binding<String> {
        Binding(
            get: { viewModel.config.apiToken },
            set: { value in
                var config = viewModel.config
                config.apiToken = value
                viewModel.config = config
            }
        )
    }

    private var labelBinding: Binding<String> {
        Binding(
            get: { viewModel.config.deviceLabel },
            set: { value in
                var config = viewModel.config
                config.deviceLabel = value
                viewModel.config = config
            }
        )
    }

    private static func dateFrom(hour: Int, minute: Int) -> Date {
        var components = Calendar.current.dateComponents([.year, .month, .day], from: Date())
        components.hour = min(23, max(0, hour))
        components.minute = min(59, max(0, minute))
        return Calendar.current.date(from: components) ?? Date()
    }
}

private extension View {
    @ViewBuilder
    func iosURLInputStyle() -> some View {
#if os(iOS)
        self
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled(true)
            .keyboardType(.URL)
#else
        self
#endif
    }

    @ViewBuilder
    func iosPlainInputStyle() -> some View {
#if os(iOS)
        self
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled(true)
#else
        self
#endif
    }
}
