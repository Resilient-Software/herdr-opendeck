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
	colOverlay = "#6c7086"
)

type TileOpts struct {
	Dim       bool
	Footer    string
	FooterRed bool
}

func esc(s string) string {
	s = strings.ReplaceAll(s, "&", "&amp;")
	s = strings.ReplaceAll(s, "<", "&lt;")
	s = strings.ReplaceAll(s, ">", "&gt;")
	return s
}

func truncate(s string, maxChars int) string {
	runes := []rune(s)
	if len(runes) <= maxChars {
		return s
	}
	return string(runes[:maxChars-1]) + "…"
}

func dataURL(svg string) string {
	return "data:image/svg+xml," + url.PathEscape(svg)
}

// The whole key background carries the state: green when the workspace is
// focused, yellow when an agent is working, red when an agent is blocked,
// plain otherwise, with the lifecycle word in the footer when the background
// is plain. Text mirrors how Herdr names the workspace, plus where it is
// operating: repository and branch.
func SpaceTile(space herdr.Workspace, info herdr.GitInfo, opt TileOpts) string {
	background, foreground, sub := colBg, colText, colSubtext
	plain := true
	if !opt.Dim {
		switch {
		case space.Focused:
			background, foreground, sub, plain = colGreen, colBg, colSurface, false
		case space.AgentStatus == herdr.StatusBlocked:
			background, foreground, sub, plain = colRed, colBg, colSurface, false
		case space.AgentStatus == herdr.StatusWorking:
			background, foreground, sub, plain = colYellow, colBg, colSurface, false
		}
	}
	label := space.Label
	if label == "" {
		label = fmt.Sprintf("Space %d", space.Number)
	}
	footer := opt.Footer
	if footer == "" && plain && !opt.Dim {
		footer = strings.ToUpper(string(space.AgentStatus))
	}
	footerColor := sub
	if opt.FooterRed {
		footerColor = colRed
	}
	var b strings.Builder
	b.WriteString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">`)
	fmt.Fprintf(&b, `<rect width="144" height="144" fill="%s"/>`, background)
	if opt.Dim {
		b.WriteString(`<g opacity="0.45">`)
	}
	fmt.Fprintf(&b, `<text x="10" y="26" fill="%s" font-family="sans-serif" font-size="16" font-weight="700">%d</text>`, sub, space.Number)
	fmt.Fprintf(&b, `<text x="72" y="58" fill="%s" font-family="sans-serif" font-size="20" font-weight="600" text-anchor="middle">%s</text>`, foreground, esc(truncate(label, 13)))
	if info.Repo != "" {
		fmt.Fprintf(&b, `<text x="72" y="84" fill="%s" font-family="sans-serif" font-size="15" text-anchor="middle">%s</text>`, sub, esc(truncate(info.Repo, 16)))
	}
	if info.Branch != "" {
		fmt.Fprintf(&b, `<text x="72" y="106" fill="%s" font-family="sans-serif" font-size="15" text-anchor="middle">⎇ %s</text>`, sub, esc(truncate(info.Branch, 15)))
	}
	if opt.Dim {
		b.WriteString(`</g>`)
	}
	if footer != "" {
		fmt.Fprintf(&b, `<text x="72" y="132" fill="%s" font-family="sans-serif" font-size="13" text-anchor="middle">%s</text>`, footerColor, esc(footer))
	}
	b.WriteString(`</svg>`)
	return dataURL(b.String())
}

// PagerTile draws one of the two pager controls: a large arrow with the page
// indicator below. accent highlights the arrow when the focused space lies in
// its direction; dim marks it inert while offline.
func PagerTile(left bool, current, total int, accent, dim bool) string {
	arrow := "→"
	if left {
		arrow = "←"
	}
	arrowColor := colText
	if accent {
		arrowColor = colGreen
	}
	var b strings.Builder
	b.WriteString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">`)
	fmt.Fprintf(&b, `<rect width="144" height="144" fill="%s"/>`, colBg)
	if dim {
		b.WriteString(`<g opacity="0.45">`)
	}
	fmt.Fprintf(&b, `<text x="72" y="82" fill="%s" font-family="sans-serif" font-size="58" font-weight="700" text-anchor="middle">%s</text>`, arrowColor, arrow)
	fmt.Fprintf(&b, `<text x="72" y="124" fill="%s" font-family="sans-serif" font-size="18" text-anchor="middle">%d/%d</text>`, colSubtext, current, total)
	if dim {
		b.WriteString(`</g>`)
	}
	b.WriteString(`</svg>`)
	return dataURL(b.String())
}

func EmptyTile() string {
	return dataURL(fmt.Sprintf(
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144"><rect width="144" height="144" fill="%s"/><circle cx="72" cy="72" r="7" fill="%s"/></svg>`,
		colBg, colSurface))
}

func messageTile(lines []string, color string) string {
	var b strings.Builder
	b.WriteString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">`)
	fmt.Fprintf(&b, `<rect width="144" height="144" fill="%s"/>`, colBg)
	y := 78 - 14*(len(lines)-1)
	for _, line := range lines {
		fmt.Fprintf(&b, `<text x="72" y="%d" fill="%s" font-family="sans-serif" font-size="17" font-weight="600" text-anchor="middle">%s</text>`, y, color, esc(line))
		y += 28
	}
	b.WriteString(`</svg>`)
	return dataURL(b.String())
}

func NewSpaceTile(dim bool) string {
	var b strings.Builder
	b.WriteString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 144 144">`)
	fmt.Fprintf(&b, `<rect width="144" height="144" fill="%s"/>`, colBg)
	if dim {
		b.WriteString(`<g opacity="0.45">`)
	}
	fmt.Fprintf(&b, `<text x="72" y="86" fill="%s" font-family="sans-serif" font-size="64" font-weight="600" text-anchor="middle">+</text>`, colGreen)
	fmt.Fprintf(&b, `<text x="72" y="124" fill="%s" font-family="sans-serif" font-size="15" text-anchor="middle">NEW SPACE</text>`, colSubtext)
	if dim {
		b.WriteString(`</g>`)
	}
	b.WriteString(`</svg>`)
	return dataURL(b.String())
}

func ConnectingTile() string {
	return messageTile([]string{"HERDR", "CONNECTING"}, colOverlay)
}

func NoSpacesTile() string {
	return messageTile([]string{"NO SPACES", "OPEN HERDR"}, colOverlay)
}

func OfflineTile() string {
	return messageTile([]string{"HERDR", "OFFLINE"}, colRed)
}
