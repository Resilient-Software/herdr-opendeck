// Package layout holds the pure key-assignment and paging logic so it can be
// tested without a device or a Herdr session.
package layout

// Assignment keeps surviving workspace IDs in their existing slots between
// polls: removals compact, additions append in the order given.
type Assignment struct {
	ids []string
}

func (a *Assignment) Update(live []string) []string {
	liveSet := make(map[string]bool, len(live))
	for _, id := range live {
		liveSet[id] = true
	}
	kept := make([]string, 0, len(live))
	seen := make(map[string]bool, len(live))
	for _, id := range a.ids {
		if liveSet[id] && !seen[id] {
			kept = append(kept, id)
			seen[id] = true
		}
	}
	for _, id := range live {
		if !seen[id] {
			kept = append(kept, id)
			seen[id] = true
		}
	}
	a.ids = kept
	return kept
}

// The pager takes the last two keys: a left arrow and a right arrow.
func PagerActive(spaces, keys int) bool {
	return keys > 2 && spaces > keys
}

func PageSize(keys int, pagerActive bool) int {
	if pagerActive {
		return keys - 2
	}
	return keys
}

func PageCount(spaces, pageSize int) int {
	if pageSize <= 0 || spaces <= 0 {
		return 1
	}
	return (spaces + pageSize - 1) / pageSize
}

func Clamp(page, pageCount int) int {
	if page < 0 {
		return 0
	}
	if page >= pageCount {
		return pageCount - 1
	}
	return page
}

func PageOf(index, pageSize int) int {
	if pageSize <= 0 || index < 0 {
		return 0
	}
	return index / pageSize
}

// VisibleRange returns the [start, end) slice bounds of spaces on a page.
func VisibleRange(page, pageSize, spaces int) (int, int) {
	start := page * pageSize
	if start > spaces {
		start = spaces
	}
	end := start + pageSize
	if end > spaces {
		end = spaces
	}
	return start, end
}
