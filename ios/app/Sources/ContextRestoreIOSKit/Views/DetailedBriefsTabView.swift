import SwiftUI

public struct DetailedBriefsTabView: View {
    @ObservedObject private var viewModel: TaskFeedViewModel

    public init(viewModel: TaskFeedViewModel) {
        self.viewModel = viewModel
    }

    public var body: some View {
        NavigationStack {
            ScrollView {
                let briefs = TaskInsightsEngine.detailedBriefs(for: viewModel.activeTasks)

                LazyVStack(alignment: .leading, spacing: 12) {
                    ContextHeaderCard(
                        title: "Action Plan",
                        subtitle: "Decision context and concrete steps to finish tasks.",
                        icon: "checklist"
                    )

                    if briefs.isEmpty {
                        Text("No action plans yet.")
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contextCard(tint: ContextUI.accentSoft)
                    } else {
                        ForEach(briefs) { brief in
                            VStack(alignment: .leading, spacing: 10) {
                                Text(brief.title)
                                    .font(.custom("Avenir Next Demi Bold", size: 18))

                                Text(brief.objective)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)

                                Text("Intent: \(brief.intentLabel)")
                                    .font(.footnote.weight(.semibold))

                                Text(brief.decisionSnapshot)
                                    .font(.footnote)

                                if !brief.whyTimeline.isEmpty {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("Why This Exists")
                                            .font(.subheadline.weight(.semibold))
                                        ForEach(brief.whyTimeline, id: \.self) { line in
                                            Text("• \(line)")
                                                .font(.footnote)
                                        }
                                    }
                                }

                                if !brief.findings.isEmpty {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("What We Detected")
                                            .font(.subheadline.weight(.semibold))
                                        ForEach(brief.findings, id: \.self) { line in
                                            Text("• \(line)")
                                                .font(.footnote)
                                        }
                                    }
                                }

                                if !brief.topPages.isEmpty {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("Best Next Pages")
                                            .font(.subheadline.weight(.semibold))
                                        ForEach(brief.topPages) { page in
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(page.title)
                                                    .font(.footnote)
                                                    .lineLimit(2)
                                                Text("\(page.state.capitalized) • \(page.domain) • interest \(Int(page.interestScore.rounded()))")
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                            }
                                        }
                                    }
                                }

                                if !brief.finishPlan.isEmpty {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("Finish Plan")
                                            .font(.subheadline.weight(.semibold))
                                        ForEach(brief.finishPlan, id: \.self) { line in
                                            Text("• \(line)")
                                                .font(.footnote)
                                        }
                                    }
                                }

                                Text("Close rule: \(brief.closureHint)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contextCard()
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Action Plan")
            .refreshable {
                await viewModel.refresh(limit: 100)
            }
        }
    }
}
