package vmangos

import (
	"reflect"
	"strings"
	"testing"
)

func TestPageChainFollowsNextPage(t *testing.T) {
	links := map[int]int{245: 0, 10: 11, 11: 12, 12: 0, 20: 21, 21: 20, 30: 31}
	cases := map[int][]int{
		245: {245},
		10:  {10, 11, 12},
		11:  {11, 12},
		20:  {20, 21}, // a loop stops where it comes back
		30:  {30},     // a next page the table lacks ends it
		99:  nil,      // a first page the table lacks: no pages
		0:   nil,
	}
	for first, want := range cases {
		if got := pageChain(links, first); !reflect.DeepEqual(got, want) {
			t.Errorf("pageChain(%d) = %v, want %v", first, got, want)
		}
	}
	long := map[int]int{}
	for i := 1; i <= maxPages+10; i++ {
		long[i] = i + 1
	}
	if got := pageChain(long, 1); len(got) != maxPages {
		t.Errorf("a long chain stops at %d pages, got %d", maxPages, len(got))
	}
}

func TestPagesSQLRewritesInPlace(t *testing.T) {
	const upsert = "INSERT INTO `page_text` (`entry`, `text`, `next_page`) VALUES "
	const tail = " ON DUPLICATE KEY UPDATE `text` = VALUES(`text`), `next_page` = VALUES(`next_page`);"
	sql, changed, err := pagesSQL(10, []int{10, 11}, []string{"One", "Two's\nline"})
	if err != nil {
		t.Fatal(err)
	}
	want := upsert + "(10, 'One', 11)" + tail + "\n" + upsert + `(11, 'Two\'s\nline', 0)` + tail
	if sql != want {
		t.Fatalf("got\n%s\nwant\n%s", sql, want)
	}
	if !reflect.DeepEqual(changed, []int{10, 11}) {
		t.Fatalf("changed %v", changed)
	}

	// More pages: the new ones come after the last page in use, chained on from the old last page.
	sql, changed, err = pagesSQL(10, []int{10}, []string{"One", "Two", "Three"})
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(sql, "\n")
	if len(lines) != 4 || !strings.HasPrefix(lines[0], "SET @page = GREATEST(") || !strings.HasSuffix(lines[0], ", 10);") ||
		lines[1] != upsert+"(10, 'One', @page + 1)"+tail || lines[2] != upsert+"(@page + 1, 'Two', @page + 2)"+tail || lines[3] != upsert+"(@page + 2, 'Three', 0)"+tail {
		t.Fatalf("got\n%s", sql)
	}
	if !reflect.DeepEqual(changed, []int{10}) {
		t.Fatalf("changed %v", changed)
	}

	// Fewer pages: the last page ends the text and the dropped ones go unless something reads them.
	sql, _, err = pagesSQL(10, []int{10, 11, 12}, []string{"Only"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, upsert+"(10, 'Only', 0)") || !strings.Contains(sql, "DELETE FROM `page_text` WHERE `entry` IN (11, 12) AND") ||
		!strings.Contains(sql, "WHERE `entry` NOT IN (10, 11, 12)) `x`") || !strings.Contains(sql, "`page_text` FROM `item_template`") {
		t.Fatalf("got\n%s", sql)
	}
}

func TestPagesSQLMakesANewText(t *testing.T) {
	// A copy (or a first text): the first page takes the entry the object was pointed at.
	sql, changed, err := pagesSQL(2975, nil, []string{"A", "B"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(sql, "VALUES (2975, 'A', @page + 1)") || !strings.Contains(sql, "VALUES (@page + 1, 'B', 0)") || !strings.Contains(sql, ", 2975);") {
		t.Fatalf("got\n%s", sql)
	}
	if len(changed) != 0 {
		t.Fatalf("a new text changed no cached page, got %v", changed)
	}
}

func TestPagesSQLRefusesBadTexts(t *testing.T) {
	bad := map[string]struct {
		first int
		texts []string
	}{
		"no pages":    {10, nil},
		"empty page":  {10, []string{"One", "  "}},
		"no entry":    {0, []string{"One"}},
		"entry range": {maxPageEntry + 1, []string{"One"}},
		"too long":    {10, make([]string, maxPages+1)},
	}
	for name, c := range bad {
		if _, _, err := pagesSQL(c.first, []int{c.first}, c.texts); err == nil {
			t.Errorf("%s: no error", name)
		}
	}
}

func TestPageUsersSQLSkipsTheObject(t *testing.T) {
	sql := pageUsersSQL([]int{245, 246}, 1726)
	for _, want := range []string{"t.data0 IN (245, 246)", "t.data7 IN (245, 246)", "t.entry <> 1726", "i.page_text IN (245, 246)", "p.next_page IN (245, 246) AND p.entry NOT IN (245, 246)"} {
		if !strings.Contains(sql, want) {
			t.Errorf("no %q in\n%s", want, sql)
		}
	}
	users := parsePageUsers([]byte("item\t889\tA Dusty Unsent Letter\t0\nobject\t2082\tUther the Lightbringer\t3\n"))
	if len(users) != 2 || users[1] != (PageUser{Kind: "object", Entry: 2082, Name: "Uther the Lightbringer", Spawns: 3}) {
		t.Fatalf("got %+v", users)
	}
}
