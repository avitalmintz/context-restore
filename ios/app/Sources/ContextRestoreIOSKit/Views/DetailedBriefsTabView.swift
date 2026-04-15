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
                        title: "Detailed Briefs",
                        subtitle: "Structured breakdowns with top pages and missing checks.",
                        icon: "doc.text.magnifyingglass"
                    )

                    if briefs.isEmpty {
                        Text("No detailed briefs yet.")
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contextCard(tint: ContextUI.accentSoft)
                    } else {
                        ForEach(briefs) { brief in
                            VStack(alignment: .leading, spacing: 10) {
                                Text(brief.title)
                                    .font(.custom("Avenir Next Demi Bold", size: 18))

                                Text(brief.headline)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)

                                if !brief.observations.isEmpty {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("Observations")
                                            .font(.subheadline.weight(.semibold))
                                        ForEach(brief.observations, id: \.self) { line in
                                            Text("• \(line)")
                                                .font(.footnote)
                                        }
                                    }
                                }

                                if !brief.topPages.isEmpty {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("Top Pages")
                                            .font(.subheadline.weight(.semibold))
                                        ForEach(brief.topPages) { page in
                                            VStack(alignment: .leading, spacing: 2) {
                                                Text(page.title)
                                                    .font(.footnote)
                                                    .lineLimit(2)
                                                Text("\(page.state.capitalized) • \(page.domain) • score \(Int(page.interestScore.rounded()))")
                                                    .font(.caption)
                                                    .foregroundStyle(.secondary)
                                            }
                                        }
                                    }
                                }

                                if !brief.missingChecks.isEmpty {
                                    VStack(alignment: .leading, spacing: 6) {
                                        Text("Missing Checks")
                                            .font(.subheadline.weight(.semibold))
                                        ForEach(brief.missingChecks, id: \.self) { line in
                                            Text("• \(line)")
                                                .font(.footnote)
                                                .foregroundStyle(.orange)
                                        }
                                    }
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contextCard()
                        }
                    }
                }
                .padding()
            }
            .navigationTitle("Detailed Briefs")
            .refreshable {
                await viewModel.refresh(limit: 100)
            }
        }
    }
}
