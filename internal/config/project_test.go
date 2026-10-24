package config

import (
	"fmt"
	"path/filepath"
	"testing"
)

func TestTouchProjectMovesItToTheFront(t *testing.T) {
	list := []Project{{Name: "a", Path: "/p/a"}, {Name: "b", Path: "/p/b"}, {Name: "c", Path: "/p/c"}}
	got := TouchProject(list, Project{Name: "b2", Path: "/p/b/"})
	if len(got) != 3 || got[0].Name != "b2" || got[1].Name != "a" || got[2].Name != "c" {
		t.Fatalf("recent list = %+v", got)
	}
}

func TestTouchProjectKeepsTheNewest(t *testing.T) {
	var list []Project
	for i := 0; i < MaxRecentProjects+3; i++ {
		list = TouchProject(list, Project{Name: fmt.Sprint(i), Path: fmt.Sprintf("/p/%d", i)})
	}
	if len(list) != MaxRecentProjects || list[0].Name != fmt.Sprint(MaxRecentProjects+2) {
		t.Fatalf("recent list = %+v", list)
	}
}

func TestForgetProject(t *testing.T) {
	list := []Project{{Path: "/p/a"}, {Path: "/p/b"}}
	got := ForgetProject(list, "/p/a")
	if len(got) != 1 || got[0].Path != "/p/b" || FindProject(got, "/p/a") != nil || FindProject(got, "/p/b") == nil {
		t.Fatalf("after forgetting = %+v", got)
	}
}

func TestProjectFolderRoundTrip(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "Elwynn")
	p, err := ReadProjectFolder(dir)
	if err != nil || p.Name != "Elwynn" {
		t.Fatalf("a folder with no project file = %+v %v", p, err)
	}
	if err := WriteProjectFolder(Project{Name: "My Elwynn", Path: dir}); err != nil {
		t.Fatal(err)
	}
	p, err = ReadProjectFolder(dir)
	if err != nil || p.Name != "My Elwynn" || p.Path != dir {
		t.Fatalf("read back = %+v %v", p, err)
	}
}
