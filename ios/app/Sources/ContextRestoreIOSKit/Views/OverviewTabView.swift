import SwiftUI

public struct OverviewTabView: View {
    @ObservedObject private var viewModel: TaskFeedViewModel
    @Environment(\.openURL) private var openURL

    @State private var renameTarget: TaskItem?
    @State private var resumeTarget: TaskItem?
    @State private var renameText: String = ""

    public init(viewModel: TaskFeedViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    ContextHeaderCard(
                        title: "Today’s Context",
                        subtitle: "Quickly return to what mattered without reopening tab chaos.",
                        icon: "sparkles.rectangle.stack"
                    )
                    controlsCard

                    if !viewModel.errorMessage.isEmpty {
                        ErrorBannerView(message: viewModel.errorMessage)
                    }

                    if viewModel.activeTasks.isEmpty {
                        emptyState
                    } else {
                        ForEach(viewModel.activeTasks) { task in
                            TaskCardView(
                                task: task,
                                onResume: {
                                    resumeTarget = task
                                },
                                onRename: {
                                    renameText = task.title
                                    renameTarget = task
                                },
                                onToggleDone: {
                                    Task {
                                        await viewModel.markDone(task: task, done: task.status != "done")
                                    }
                                },
                                onDeleteTaskContext: {
                                    Task {
                                        await viewModel.deleteTaskContext(task: task)
                                    }
                                }
                            )
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Overview")
            .refreshable {
                await viewModel.refresh(limit: 100)
            }
        }
        .confirmationDialog(
            resumeTarget == nil ? "Resume Task" : "Resume “\(resumeTarget?.title ?? "")”",
            isPresented: Binding(
                get: { resumeTarget != nil },
                set: { presenting in
                    if !presenting {
                        resumeTarget = nil
                    }
                }
            ),
            titleVisibility: .visible
        ) {
            if let task = resumeTarget {
                Button("Open top page (Safari)") {
                    Task { await openTaskPages(task, maxCount: 1, preferChrome: false) }
                }
                Button("Open top 3 pages (Safari)") {
                    Task { await openTaskPages(task, maxCount: 3, preferChrome: false) }
                }
                Button("Open top page (Chrome)") {
                    Task { await openTaskPages(task, maxCount: 1, preferChrome: true) }
                }
                Button("Open top 3 pages (Chrome)") {
                    Task { await openTaskPages(task, maxCount: 3, preferChrome: true) }
                }
                Button("Cancel", role: .cancel) {}
            }
        }
        .sheet(item: $renameTarget) { task in
            RenameTaskSheet(
                taskTitle: task.title,
                renameText: $renameText,
                onCancel: {
                    renameTarget = nil
                },
                onSave: {
                    Task {
                        await viewModel.rename(task: task, title: renameText)
                        renameTarget = nil
                    }
                }
            )
            .presentationDetents([.height(220)])
        }
    }

    private func openTaskPages(_ task: TaskItem, maxCount: Int, preferChrome: Bool) async {
        let urls = task.pages
            .prefix(max(1, maxCount))
            .compactMap { URL(string: $0.url) }

        guard !urls.isEmpty else {
            return
        }

        for (index, url) in urls.enumerated() {
            await openPreferredURL(url, preferChrome: preferChrome)
            if index < urls.count - 1 {
                try? await Task.sleep(nanoseconds: 250_000_000)
            }
        }

        resumeTarget = nil
    }

    private func openPreferredURL(_ url: URL, preferChrome: Bool) async {
        if preferChrome, let chromeURL = chromeURL(from: url) {
            let openedInChrome = await withCheckedContinuation { continuation in
                openURL(chromeURL) { accepted in
                    continuation.resume(returning: accepted)
                }
            }
            if openedInChrome {
                return
            }
        }

        await withCheckedContinuation { continuation in
            openURL(url) { _ in
                continuation.resume(returning: ())
            }
        }
    }

    private func chromeURL(from url: URL) -> URL? {
        guard let scheme = url.scheme?.lowercased() else {
            return nil
        }
        let chromeScheme: String
        if scheme == "https" {
            chromeScheme = "googlechromes"
        } else if scheme == "http" {
            chromeScheme = "googlechrome"
        } else {
            return nil
        }

        var components = URLComponents(url: url, resolvingAgainstBaseURL: false)
        components?.scheme = chromeScheme
        return components?.url
    }

    private var controlsCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("Tasks")
                    .font(.custom("Avenir Next Demi Bold", size: 18))
                Spacer()
                if viewModel.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
            }

            Toggle("Show completed", isOn: $viewModel.includeDone)

            HStack(spacing: 10) {
                Button {
                    Task {
                        await viewModel.refresh(limit: 100)
                    }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)

                Button {
                    Task {
                        await viewModel.registerDeviceIfNeeded(force: true)
                    }
                } label: {
                    Label("Register Device", systemImage: "iphone.and.arrow.forward")
                }
                .buttonStyle(.bordered)
            }
        }
        .contextCard()
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("No tasks yet")
                .font(.custom("Avenir Next Demi Bold", size: 18))
            Text("Browse on desktop with sync enabled, then pull to refresh.")
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contextCard(tint: ContextUI.accentSoft)
    }
}

private struct TaskCardView: View {
    let task: TaskItem
    let onResume: () -> Void
    let onRename: () -> Void
    let onToggleDone: () -> Void
    let onDeleteTaskContext: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 8) {
                Text(task.title)
                    .font(.custom("Avenir Next Demi Bold", size: 18))
                Spacer()
                StatusChip(status: task.status)
            }

            Text(task.briefing)
                .foregroundStyle(.secondary)

            Text("Next: \(task.nextAction)")
                .font(.subheadline)

            HStack(spacing: 10) {
                StatPill(label: "Pages", value: "\(task.stats.pageCount)")
                StatPill(label: "Read", value: "\(task.stats.readCount)")
                StatPill(label: "Skimmed", value: "\(task.stats.skimmedCount)")
                StatPill(label: "Closed", value: "\(task.stats.bouncedCount)")
            }

            if !task.pages.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(task.pages.prefix(3))) { page in
                        HStack(alignment: .top, spacing: 8) {
                            Text(page.state.capitalized)
                                .font(.caption.weight(.semibold))
                                .padding(.horizontal, 6)
                                .padding(.vertical, 3)
                                .background(.quaternary, in: Capsule())

                            VStack(alignment: .leading, spacing: 2) {
                                Text(page.title)
                                    .font(.footnote)
                                    .lineLimit(2)
                                Text(page.domain)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                        }
                    }
                }
            }

            HStack(spacing: 10) {
                Button("Resume…", action: onResume)
                    .buttonStyle(.borderedProminent)

                Button("Rename", action: onRename)
                    .buttonStyle(.bordered)

                Button(task.status == "done" ? "Reopen" : "Mark Done", action: onToggleDone)
                    .buttonStyle(.bordered)

                Button("Delete Context", role: .destructive, action: onDeleteTaskContext)
                    .buttonStyle(.bordered)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .contextCard(tint: task.status.lowercased() == "done" ? .green.opacity(0.35) : ContextUI.accentSoft)
    }
}

private struct RenameTaskSheet: View {
    let taskTitle: String
    @Binding var renameText: String
    let onCancel: () -> Void
    let onSave: () -> Void

    var body: some View {
        NavigationStack {
            Form {
                Section("Rename Task") {
                    Text(taskTitle)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    TextField("Task title", text: $renameText)
                }
            }
            .navigationTitle("Rename")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel", action: onCancel)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: onSave)
                        .disabled(renameText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}

private struct ErrorBannerView: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.circle.fill")
                .foregroundStyle(.red)
            Text(message)
                .font(.footnote)
                .foregroundStyle(.primary)
            Spacer()
        }
        .padding(12)
        .background(Color.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
}

private struct StatPill: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.subheadline.weight(.semibold))
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(ContextUI.accentSoft.opacity(0.65), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
}

private struct StatusChip: View {
    let status: String

    var body: some View {
        let done = status.lowercased() == "done"
        Text(done ? "Done" : "Active")
            .font(.caption.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .foregroundStyle(done ? Color.green : ContextUI.accent)
            .background(done ? Color.green.opacity(0.16) : ContextUI.accentSoft, in: Capsule())
    }
}
