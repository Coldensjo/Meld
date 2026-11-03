package vmangos

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// planServer is a server folder whose world database is a stand-in that answers the reads a template
// plan makes and fails the test on anything else, so a plan that wrote would be caught (#1055).
func planServer(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "run"), 0o755); err != nil {
		t.Fatal(err)
	}
	conf := "WorldDatabase.Info = \"127.0.0.1;1;mangos;mangos;mangos\"\n"
	if err := os.WriteFile(filepath.Join(root, "run", "mangosd.conf"), []byte(conf), 0o644); err != nil {
		t.Fatal(err)
	}
	old := runSQL
	t.Cleanup(func() { runSQL = old })
	runSQL = func(_ worldDB, sql string) ([]byte, error) {
		switch {
		case sql == "SELECT 1":
			return []byte("1\n"), nil
		case strings.HasPrefix(sql, "SHOW COLUMNS FROM"):
			return []byte("entry\tint(10) unsigned\tNO\npatch\ttinyint(3) unsigned\tNO\nname\tvarchar(100)\tNO\nlevel_min\ttinyint(3) unsigned\tNO\n"), nil
		case strings.HasPrefix(sql, "SELECT COALESCE(MAX(entry), 0) + 1"):
			return []byte("42\n"), nil
		case strings.HasPrefix(sql, "SELECT DISTINCT `class`"):
			return []byte("1\n2\n"), nil
		}
		t.Fatalf("a plan ran %s", sql)
		return nil, nil
	}
	return root
}

// TestTemplatePlans checks that the template plans give the SQL their saves run, with the saves'
// checks, and write nothing: meldtool's dry runs (#1055).
func TestTemplatePlans(t *testing.T) {
	root := planServer(t)
	sql, err := PlanCreatureSave(root, 7, 0, map[string]string{"name": "Bob", "level_min": "3"})
	if want := "UPDATE `creature_template` SET `level_min` = 3, `name` = 'Bob' WHERE `entry` = 7 AND `patch` = 0;"; err != nil || sql != want {
		t.Errorf("creature save: %q, %v; want %q", sql, err, want)
	}
	if _, err := PlanCreatureSave(root, 7, 0, map[string]string{"level_min": "300"}); Refused(err) == nil {
		t.Errorf("creature save of 300 in a tinyint: %v, want it refused", err)
	}
	if _, err := PlanCreatureSave(root, 7, 0, map[string]string{"unit_class": "5"}); err == nil || !strings.Contains(err.Error(), "class level stats") {
		t.Errorf("creature save of a class without stats: %v", err)
	}
	if _, err := PlanObjectSave(root, 7, 0, map[string]string{"nope": "1"}); err == nil {
		t.Error("object save of an unknown column: no error")
	}
	if _, err := PlanItemSave(root, 7, 0, map[string]string{"name": " "}); Refused(err) == nil {
		t.Errorf("item save of an empty name: %v, want it refused", err)
	}
	c, err := PlanCreateCreature(root, 0, " Bob ")
	if err != nil || c.Entry != 42 || !strings.Contains(c.SQL, "VALUES (42, 0, 'Bob', 1, 1, 1, 14") {
		t.Errorf("new creature: %+v, %v", c, err)
	}
	o, err := PlanCreateObject(root, 3, "Box")
	if err != nil || o.Entry != 42 || !strings.Contains(o.SQL, "t.`entry` = 3") {
		t.Errorf("new object copied from 3: %+v, %v", o, err)
	}
	i, err := PlanCreateItem(root, 0, "Rock")
	if err != nil || i.Entry != 42 || !strings.Contains(i.SQL, "'Rock'") {
		t.Errorf("new item: %+v, %v", i, err)
	}
	if _, err := PlanCreateItem(root, 0, "  "); err == nil {
		t.Error("new item without a name: no error")
	}
}
