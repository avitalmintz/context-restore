import SwiftUI

public struct AIBriefingTabView: View {
    @ObservedObject private var viewModel: TaskFeedViewModel

    public init(viewModel: TaskFeedViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                let briefings = TaskInsightsEngine.aiBriefings(for: viewModel.activeTasks)

                LazyVStack(alignment: .leading, spacing: 12) {
                    ContextHeaderCard(
                        title: "AI Briefing",
                        subtitle: "Narrative summaries of what you were likely trying to do.",
                        icon: "sparkles"
                    )

                    if briefings.isEmpty {
                        Text("No active tasks yet.")
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contextCard(tint: ContextUI.accentSoft)
                    } else {
                        ForEach(briefings) { item in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(item.title)
                                        .font(.custom("Avenir Next Demi Bold", size: 18))
                                    Spacer()
                                    Text("\(item.confidencePct)%")
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 4)
                                        .background(ContextUI.accentSoft, in: Capsule())
                                }

                                Text(item.summary)
                                Text("Focus: \(item.nextFocus)")
                                    .foregroundStyle(.secondary)

                                Text(label(for: item.kind))
                                    .font(.caption.weight(.medium))
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contextCard()
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("AI Briefing")
            .refreshable {
                await viewModel.refresh(limit: 100)
            }
        }
    }

    private func label(for kind: InferredTaskKind) -> String {
        switch kind {
        case .shopping:
            return "Detected as shopping"
        case .research:
            return "Detected as research"
        case .travel:
            return "Detected as travel planning"
        case .news:
            return "Detected as news tracking"
        case .social:
            return "Detected as social/community"
        case .other:
            return "Detected as general task"
        }
    }
}
