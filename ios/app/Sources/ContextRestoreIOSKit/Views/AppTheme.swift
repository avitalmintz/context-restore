import SwiftUI

enum ContextUI {
    static let accent = Color(red: 0.09, green: 0.46, blue: 0.31)
    static let accentSoft = Color(red: 0.85, green: 0.93, blue: 0.88)
    static let ink = Color(red: 0.12, green: 0.14, blue: 0.13)
    static let mutedInk = Color(red: 0.32, green: 0.35, blue: 0.33)
}

struct ContextCardModifier: ViewModifier {
    var tint: Color

    func body(content: Content) -> some View {
        content
            .padding(14)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(.white.opacity(0.78))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .stroke(tint.opacity(0.45), lineWidth: 1)
            )
            .shadow(color: Color.black.opacity(0.06), radius: 12, x: 0, y: 6)
    }
}

extension View {
    func contextCard(tint: Color = Color(red: 0.83, green: 0.87, blue: 0.83)) -> some View {
        modifier(ContextCardModifier(tint: tint))
    }
}

struct ContextHeaderCard: View {
    let title: String
    let subtitle: String
    let icon: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: icon)
                .font(.title3.weight(.semibold))
                .foregroundStyle(ContextUI.accent)
                .frame(width: 32, height: 32)
                .background(ContextUI.accentSoft, in: RoundedRectangle(cornerRadius: 10, style: .continuous))

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.custom("Avenir Next Demi Bold", size: 18))
                    .foregroundStyle(ContextUI.ink)
                Text(subtitle)
                    .font(.custom("Avenir Next", size: 14))
                    .foregroundStyle(ContextUI.mutedInk)
            }

            Spacer()
        }
        .contextCard(tint: ContextUI.accentSoft)
    }
}

