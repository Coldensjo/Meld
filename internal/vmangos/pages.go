package vmangos

import (
	"fmt"
	"strconv"
	"strings"
)

// Readable game objects (#139): using a text object (type 9: a tombstone, a plaque, a wanted poster)
// opens the pages of page_text, from the page its data0 names; a goober (type 10) reads from its
// data7. Each page_text row is one page: its text, and next_page, the page after it (0 for the
// last). Items read pages too (item_template.page_text), and two texts can share pages, so the
// Text tab names everything else that reads them before a change.

const (
	// objectTypeText is a text object; a goober is objectTypeGoober (teleport.go).
	objectTypeText = 9
	// maxPages is the longest chain of pages read or saved: a chain stops there, or at a page it
	// already read (a loop), or at a page the table lacks.
	maxPages = 100
	// maxPageEntry is the largest page_text.entry (an unsigned mediumint).
	maxPageEntry = 0xFFFFFF
)

// Page is one page_text row of a text: its entry and what it says.
type Page struct {
	Entry int    `json:"entry"`
	Text  string `json:"text"`
}

// PageUser is something else that reads one of a text's pages: a game object template ("object",
// with its spawn count), an item ("item"), or a page of another text whose next page is one of them
// ("page", named by its first words).
type PageUser struct {
	Kind   string `json:"kind"`
	Entry  int    `json:"entry"`
	Name   string `json:"name"`
	Spawns int    `json:"spawns"`
}

// ObjectPages is what a readable object says: the pages from its first page on, what else reads
// them, and how many spawns the object itself has.
type ObjectPages struct {
	First  int        `json:"first"`
	Pages  []Page     `json:"pages"`
	Users  []PageUser `json:"users"`
	Spawns int        `json:"spawns"`
}

// PagesSaved is what SavePages did: the SQL it ran, and the pages that existed before and were
// rewritten, which the game's page cache has to forget.
type PagesSaved struct {
	SQL     string `json:"sql"`
	Changed []int  `json:"changed"`
}

// pageChain follows next_page from first through links (entry → next_page): the entries of the
// text's pages, in order. A page the table lacks ends it, and so does a loop or maxPages.
func pageChain(links map[int]int, first int) []int {
	var out []int
	seen := map[int]bool{}
	for p := first; p > 0 && !seen[p] && len(out) < maxPages; {
		next, ok := links[p]
		if !ok {
			break
		}
		seen[p] = true
		out = append(out, p)
		p = next
	}
	return out
}

// readPageChain reads the entries of the pages from first on.
func readPageChain(db worldDB, first int) ([]int, error) {
	if first <= 0 {
		return nil, nil
	}
	raw, err := runSQL(db, "SELECT `entry`, `next_page` FROM `page_text`")
	if err != nil {
		return nil, err
	}
	links := map[int]int{}
	for _, f := range batchRows(raw, 2) {
		links[f.num(0)] = f.num(1)
	}
	return pageChain(links, first), nil
}

// intsSQL lists ids for an SQL IN (...).
func intsSQL(ids []int) string {
	s := make([]string, len(ids))
	for i, id := range ids {
		s[i] = strconv.Itoa(id)
	}
	return strings.Join(s, ", ")
}

// pageUsersSQL lists what reads any of pages besides game object template entry: the object
// templates (newest patch) whose first page is one of them, the items (newest patch), and the pages
// outside them whose next page is one of them.
func pageUsersSQL(pages []int, entry int) string {
	in := intsSQL(pages)
	return fmt.Sprintf("SELECT 'object', t.entry, t.name, (SELECT COUNT(*) FROM gameobject s WHERE s.id = t.entry) FROM %s "+
		"WHERE ((t.type = %d AND t.data0 IN (%s)) OR (t.type = %d AND t.data7 IN (%s))) AND t.entry <> %d "+
		"UNION ALL SELECT 'item', i.entry, i.name, 0 FROM item_template i WHERE i.page_text IN (%s) "+
		"AND i.patch = (SELECT MAX(patch) FROM item_template WHERE entry = i.entry) "+
		"UNION ALL SELECT 'page', p.entry, LEFT(REPLACE(REPLACE(p.text, '\\n', ' '), '\\r', ''), 60), 0 FROM page_text p WHERE p.next_page IN (%s) AND p.entry NOT IN (%s) "+
		"ORDER BY 1, 3, 2",
		newestObjects, objectTypeText, in, objectTypeGoober, in, entry, in, in, in)
}

// parsePageUsers reads pageUsersSQL's output.
func parsePageUsers(raw []byte) []PageUser {
	var out []PageUser
	for _, f := range batchRows(raw, 4) {
		out = append(out, PageUser{Kind: f[0], Entry: f.num(1), Name: f[2], Spawns: f.num(3)})
	}
	return out
}

// ReadObjectPages reads what game object template entry says when its first page is first: the
// pages, what else reads them, and the object's spawn count.
func ReadObjectPages(serverRoot string, entry, first int) (ObjectPages, error) {
	out := ObjectPages{First: first}
	db, err := openWorld(serverRoot)
	if err != nil {
		return out, err
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT COUNT(*) FROM gameobject WHERE id = %d", entry))
	if err != nil {
		return out, err
	}
	out.Spawns, _ = strconv.Atoi(strings.TrimSpace(string(raw)))
	chain, err := readPageChain(db, first)
	if err != nil || len(chain) == 0 {
		return out, err
	}
	if raw, err = runSQL(db, fmt.Sprintf("SELECT `entry`, `text` FROM `page_text` WHERE `entry` IN (%s)", intsSQL(chain))); err != nil {
		return out, err
	}
	texts := map[int]string{}
	for _, f := range batchRows(raw, 2) {
		texts[f.num(0)] = f[1]
	}
	for _, p := range chain {
		out.Pages = append(out.Pages, Page{Entry: p, Text: texts[p]})
	}
	if raw, err = runSQL(db, pageUsersSQL(chain, entry)); err != nil {
		return out, err
	}
	out.Users = parsePageUsers(raw)
	return out, nil
}

// lastPageSQL is the largest page entry in use: page_text's, and any a text object, goober or item
// names without the table having it, so a new page never turns up in something else's text.
var lastPageSQL = fmt.Sprintf("GREATEST((SELECT COALESCE(MAX(`entry`), 0) FROM `page_text`), "+
	"(SELECT COALESCE(MAX(`data0`), 0) FROM `gameobject_template` WHERE `type` = %d), "+
	"(SELECT COALESCE(MAX(`data7`), 0) FROM `gameobject_template` WHERE `type` = %d), "+
	"(SELECT COALESCE(MAX(`page_text`), 0) FROM `item_template`))", objectTypeText, objectTypeGoober)

// pagesSQL writes texts as the pages of the text starting at page first, whose pages are now chain
// (empty when page first doesn't exist yet). The pages it has are rewritten in place, in order; a
// text with more pages gets new ones after the last page in use (@page); a text with fewer drops
// its last pages, deleting each that nothing else reads. A first page that doesn't exist is made
// with entry first, so a copy (or a new text) takes the entry the object was pointed at.
func pagesSQL(first int, chain []int, texts []string) (string, []int, error) {
	if first <= 0 || first > maxPageEntry {
		return "", nil, fmt.Errorf("page %d is not one page_text can hold", first)
	}
	if len(texts) == 0 {
		return "", nil, fmt.Errorf("the text has no pages")
	}
	if len(texts) > maxPages {
		return "", nil, fmt.Errorf("the text has %d pages: %d at most", len(texts), maxPages)
	}
	for i, t := range texts {
		if strings.TrimSpace(t) == "" {
			return "", nil, fmt.Errorf("page %d is empty: write something on it or remove it", i+1)
		}
	}
	fresh := len(chain) == 0
	if fresh {
		chain = []int{first}
	}
	// Each page's entry, as an SQL value: an existing page's number, or @page + n for a new one.
	ids := make([]string, len(texts))
	for i := range texts {
		if i < len(chain) {
			ids[i] = strconv.Itoa(chain[i])
		} else {
			ids[i] = fmt.Sprintf("@page + %d", i-len(chain)+1)
		}
	}
	var b strings.Builder
	if len(texts) > len(chain) {
		// Past first too: a new first page isn't in the table yet when @page is set.
		fmt.Fprintf(&b, "SET @page = GREATEST(%s, %d);\n", lastPageSQL, first)
	}
	var changed []int
	for i, t := range texts {
		next := "0"
		if i+1 < len(texts) {
			next = ids[i+1]
		}
		fmt.Fprintf(&b, "INSERT INTO `page_text` (`entry`, `text`, `next_page`) VALUES (%s, %s, %s) ON DUPLICATE KEY UPDATE `text` = VALUES(`text`), `next_page` = VALUES(`next_page`);\n", ids[i], sqlQuote(t), next)
		if i < len(chain) && !fresh {
			changed = append(changed, chain[i])
		}
	}
	if len(chain) > len(texts) {
		dropped := intsSQL(chain[len(texts):])
		// The derived table lets the DELETE read the table it deletes from.
		fmt.Fprintf(&b, "DELETE FROM `page_text` WHERE `entry` IN (%s) AND `entry` NOT IN (SELECT `n` FROM (SELECT `next_page` AS `n` FROM `page_text` WHERE `entry` NOT IN (%s)) `x`) "+
			"AND `entry` NOT IN (SELECT `data0` FROM `gameobject_template` WHERE `type` = %d) AND `entry` NOT IN (SELECT `data7` FROM `gameobject_template` WHERE `type` = %d) "+
			"AND `entry` NOT IN (SELECT `page_text` FROM `item_template`);",
			dropped, intsSQL(chain), objectTypeText, objectTypeGoober)
	}
	return strings.TrimRight(b.String(), "\n"), changed, nil
}

// SavePages writes texts as the pages of the text starting at page first (pagesSQL) and returns the
// SQL it ran with the pages it rewrote.
func SavePages(serverRoot string, first int, texts []string) (PagesSaved, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return PagesSaved{}, err
	}
	chain, err := readPageChain(db, first)
	if err != nil {
		return PagesSaved{}, err
	}
	sql, changed, err := pagesSQL(first, chain, texts)
	if err != nil {
		return PagesSaved{}, err
	}
	if err := runScript(db, sql); err != nil {
		return PagesSaved{}, err
	}
	return PagesSaved{SQL: sql, Changed: changed}, nil
}

// NextPage is the first page entry nothing uses yet, for an object given its first text or its own
// copy of a shared one.
func NextPage(serverRoot string) (int, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return 0, err
	}
	raw, err := runSQL(db, "SELECT "+lastPageSQL+" + 1")
	if err != nil {
		return 0, err
	}
	return strconv.Atoi(strings.TrimSpace(string(raw)))
}
