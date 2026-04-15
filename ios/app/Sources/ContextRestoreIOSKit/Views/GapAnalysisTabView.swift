import SwiftUI

public struct GapAnalysisTabView: View {
    @ObservedObject private var viewModel: TaskFeedViewModel

    public init(viewModel: TaskFeedViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                let gaps = TaskInsightsEngine.gapItems(for: viewModel.activeTasks)

                LazyVStack(alignment: .leading, spacing: 12) {
                    ContextHeaderCard(
                        title: "Gap Analysis",
                        subtitle: "What you might have missed before making decisions.",
                        icon: "exclamationmark.triangle"
                    )

                    if gaps.isEmpty {
                        Text("No obvious gaps detected right now.")
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contextCard(tint: ContextUI.accentSoft)
                    } else {
                        ForEach(gaps) { gap in
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(gap.taskTitle)
                                        .font(.custom("Avenir Next Demi Bold", size: 18))
                                    Spacer()
                                    Text(severityLabel(gap.severity))
                                        .font(.caption.weight(.semibold))
                                        .padding(.horizontal, 8)
                                        .padding(.vertical, 4)
                                        .background(severityColor(gap.severity).opacity(0.2), in: Capsule())
                                }

                                Text(gap.message)
                                Text("Action: \(gap.suggestedAction)")
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contextCard(tint: severityColor(gap.severity).opacity(0.35))
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Gap Analysis")
            .refreshable {
                await viewModel.refresh(limit: 100)
            }
        }
    }

    private func severityLabel(_ severity: Int) -> String {
        switch severity {
        case 3...:
            return "High"
        case 2:
            return "Medium"
        default:
            return "Low"
        }
    }

    private func severityColor(_ severity: Int) -> Color {
        switch severity {
        case 3...:
            return .red
        case 2:
            return .orange
        default:
            return .yellow
        }
    }
}
