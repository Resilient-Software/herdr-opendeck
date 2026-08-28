// Package render builds SVG key images for Stream Deck keys.
package render

import (
	"fmt"
	"net/url"
	"strings"

	"github.com/ThomasRooney/herdr-opendeck/internal/herdr"
)

// Palette (Catppuccin Mocha, matching Herdr's default theme family).
const (
	colBg      = "#1e1e2e"
	colSurface = "#313244"
	colText    = "#cdd6f4"
	colSubtext = "#a6adc8"
	colRed     = "#f38ba8"
	colYellow  = "#f9e2af"
	colGreen   = "#a6e3a1"
	colBlue    = "#89b4fa"
	colOverlay = "#6c7086"
)

func statusColor(status herdr.AgentStatus) string {
	switch status {
	case herdr.StatusBlocked:
		return colRed
	case herdr.StatusWorking:
		return colYellow
	case herdr.StatusDone:
		return colGreen
	case herdr.StatusIdle:
		return colBlue
	default:
		return colOverlay
	}
}

func esc(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	return s
}

func wrap(label string, maxChars int) []string {
	runes := []rune(label)
	if len(runes) <= maxChars {
		return []string{label}
	}
	break_ := maxChars
	for i := maxChars; i > maxChars/2; i-- {
		if runes[i-1] == ' ' || runes[i-1] == '-' || runes[i-1] == '_' {
			break_ = i
			break
		}
	}
	first := strings.TrimRight(string(runes[:break_]), " -_")
	rest := []rune(strings.TrimLeft(string(runes[break_:]), " "))
	if len(rest) > maxChars {
		rest = append(rest[:maxChars-1], '…')
	}
	return []string{first, string(rest)}
}

func PaneTile(pane herdr.Pane, focused bool, overflow int) string {
	color := statusColor(pane.AgentStatus)
	var b strings.Builder
	b.WriteString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">`)
	fmt.Fprintf(&b, `<rect width="144" height="144" fill="%s"/>`, colBg)
	fmt.Fprintf(&b, `<rect width="144" height="14" fill="%s"/>`, color)
	if focused {
		fmt.Fprintf(&b, `<rect x="3" y="3" width="138" height="138" fill="none" stroke="%s" stroke-width="6"/>`, color)
	}
	lines := wrap(pane.DisplayLabel(), 11)
	if len(lines) == 1 {
		fmt.Fprintf(&b, `<text x="72" y="76" fill="%s" font-family="sans-serif" font-size="22" font-weight="600" text-anchor="middle">%s</text>`, colText, esc(lines[0]))
	} else {
		fmt.Fprintf(&b, `<text x="72" y="64" fill="%s" font-family="sans-serif" font-size="20" font-weight="600" text-anchor="middle">%s</text>`, colText, esc(lines[0]))
		fmt.Fprintf(&b, `<text x="72" y="88" fill="%s" font-family="sans-serif" font-size="20" font-weight="600" text-anchor="middle">%s</text>`, colText, esc(lines[1]))
	}
	footer := string(pane.AgentStatus)
	if pane.Agent != "" {
		footer = pane.Agent + " · " + footer
	}
	fmt.Fprintf(&b, `<text x="72" y="126" fill="%s" font-family="sans-serif" font-size="16" text-anchor="middle">%s</text>`, colSubtext, esc(footer))
	if overflow > 0 {
		fmt.Fprintf(&b, `<rect x="96" y="20" width="44" height="26" rx="6" fill="%s"/>`, colSurface)
		fmt.Fprintf(&b, `<text x="118" y="39" fill="%s" font-family="sans-serif" font-size="16" font-weight="700" text-anchor="middle">+%d</text>`, colText, overflow)
	}
	b.WriteString(`</svg>`)
	return "data:image/svg+xml," + url.PathEscape(b.String())
}

// The whole key background carries the state: green when the workspace is
// focused, yellow when an agent is working, red when an agent is blocked,
// plain otherwise. Text mirrors how Herdr names the workspace, plus where it
// is operating: repository and branch.
func SpaceTile(space herdr.Workspace, info herdr.GitInfo) string {
	background := colBg
	foreground := colText
	subForeground := colSubtext
	switch {
	case space.Focused:
		background, foreground, subForeground = colGreen, colBg, colSurface
	case space.AgentStatus == herdr.StatusBlocked:
		background, foreground, subForeground = colRed, colBg, colSurface
	case space.AgentStatus == herdr.StatusWorking:
		background, foreground, subForeground = colYellow, colBg, colSurface
	}
	label := space.Label
	if label == "" {
		label = fmt.Sprintf("Space %d", space.Number)
	}
	var b strings.Builder
	b.WriteString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">`)
	fmt.Fprintf(&b, `<rect width="144" height="144" fill="%s"/>`, background)
	fmt.Fprintf(&b, `<text x="10" y="28" fill="%s" font-family="sans-serif" font-size="17" font-weight="700">%d</text>`, subForeground, space.Number)
	fmt.Fprintf(&b, `<text x="72" y="62" fill="%s" font-family="sans-serif" font-size="20" font-weight="600" text-anchor="middle">%s</text>`, foreground, esc(truncate(label, 13)))
	if info.Repo != "" {
		fmt.Fprintf(&b, `<text x="72" y="92" fill="%s" font-family="sans-serif" font-size="16" text-anchor="middle">%s</text>`, subForeground, esc(truncate(info.Repo, 15)))
	}
	if info.Branch != "" {
		fmt.Fprintf(&b, `<text x="72" y="116" fill="%s" font-family="sans-serif" font-size="16" text-anchor="middle">⎇ %s</text>`, subForeground, esc(truncate(info.Branch, 14)))
	}
	b.WriteString(`</svg>`)
	return "data:image/svg+xml," + url.PathEscape(b.String())
}

func truncate(s string, maxChars int) string {
	runes := []rune(s)
	if len(runes) <= maxChars {
		return s
	}
	return string(runes[:maxChars-1]) + "…"
}

func EmptyTile() string {
	svg := fmt.Sprintf(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><rect width="144" height="144" fill="%s"/><circle cx="72" cy="72" r="7" fill="%s"/></svg>`,
		colBg, colSurface)
	return "data:image/svg+xml," + url.PathEscape(svg)
}

func DisconnectedTile() string {
	svg := fmt.Sprintf(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><rect width="144" height="144" fill="%s"/><text x="72" y="66" fill="%s" font-family="sans-serif" font-size="18" text-anchor="middle">herdr</text><text x="72" y="90" fill="%s" font-family="sans-serif" font-size="18" text-anchor="middle">offline</text></svg>`,
		colBg, colOverlay, colOverlay)
	return "data:image/svg+xml," + url.PathEscape(svg)
}
