package layout

import (
	"reflect"
	"testing"
)

func TestAssignmentStableSlots(t *testing.T) {
	var a Assignment
	got := a.Update([]string{"w1", "w2", "w3"})
	if !reflect.DeepEqual(got, []string{"w1", "w2", "w3"}) {
		t.Fatalf("initial fill: %v", got)
	}
	got = a.Update([]string{"w9", "w2", "w3"})
	if !reflect.DeepEqual(got, []string{"w2", "w3", "w9"}) {
		t.Fatalf("survivors must compact before additions append: %v", got)
	}
	got = a.Update([]string{"w9", "w2", "w3"})
	if !reflect.DeepEqual(got, []string{"w2", "w3", "w9"}) {
		t.Fatalf("unchanged input must not shuffle: %v", got)
	}
}

func TestAssignmentRemovalCompacts(t *testing.T) {
	var a Assignment
	a.Update([]string{"w1", "w2", "w3", "w4"})
	got := a.Update([]string{"w1", "w4"})
	if !reflect.DeepEqual(got, []string{"w1", "w4"}) {
		t.Fatalf("removals must compact: %v", got)
	}
}

func TestPagerActivation(t *testing.T) {
	if PagerActive(14, 14) {
		t.Fatal("14 spaces on 14 keys needs no pager")
	}
	if !PagerActive(15, 14) {
		t.Fatal("15 spaces on 14 keys needs a pager")
	}
	if PagerActive(3, 2) {
		t.Fatal("two keys cannot host the two-key pager")
	}
}

func TestPaging(t *testing.T) {
	keys := 14
	spaces := 15
	active := PagerActive(spaces, keys)
	size := PageSize(keys, active)
	if size != 12 {
		t.Fatalf("page size with two-key pager: %d", size)
	}
	if count := PageCount(spaces, size); count != 2 {
		t.Fatalf("page count: %d", count)
	}
	if start, end := VisibleRange(1, size, spaces); start != 12 || end != 15 {
		t.Fatalf("second page range: [%d, %d)", start, end)
	}
	if PageOf(14, size) != 1 {
		t.Fatalf("space 14 must live on page 1")
	}
}

func TestClamp(t *testing.T) {
	if Clamp(-1, 3) != 0 || Clamp(5, 3) != 2 || Clamp(1, 3) != 1 {
		t.Fatal("clamp bounds")
	}
}
