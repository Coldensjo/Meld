package clientbuild

import (
	"bytes"
	"debug/pe"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
	"unicode/utf16"
)

const rsrcRVA = 0x1000

// versionInfo is a VS_VERSIONINFO holding only its VS_FIXEDFILEINFO with the version v.
func versionInfo(v [4]uint16) []byte {
	var b bytes.Buffer
	w := func(x any) { _ = binary.Write(&b, binary.LittleEndian, x) }
	w(uint16(0))  // wLength, set below
	w(uint16(52)) // wValueLength
	w(uint16(0))  // wType
	for _, c := range utf16.Encode([]rune("VS_VERSION_INFO\x00")) {
		w(c)
	}
	w(uint16(0)) // padding to 32 bits
	w(uint32(fixedSignature))
	w(uint32(0x10000)) // dwStrucVersion
	w(uint32(v[0])<<16 | uint32(v[1]))
	w(uint32(v[2])<<16 | uint32(v[3]))
	w(uint32(v[0])<<16 | uint32(v[1])) // product version
	w(uint32(v[2])<<16 | uint32(v[3]))
	w([7]uint32{}) // flags mask, flags, OS, type, subtype, date
	out := b.Bytes()
	binary.LittleEndian.PutUint16(out, uint16(len(out)))
	return out
}

// resources is a .rsrc section holding an RT_ICON type ahead of RT_VERSION (name 1, language
// 0x409), the version's data entry pointing at info.
func resources(info []byte) []byte {
	var b bytes.Buffer
	w := func(x any) { _ = binary.Write(&b, binary.LittleEndian, x) }
	dir := func(ids uint16) { w([8]uint16{7: ids}) }
	dir(2)                                              // 0: the types
	w([2]uint32{3, subdirectoryBit | 32})               // 16: RT_ICON
	w([2]uint32{16, subdirectoryBit | 32})              // 24: RT_VERSION
	dir(1)                                              // 32: the names
	w([2]uint32{1, subdirectoryBit | 56})               // 48
	dir(1)                                              // 56: the languages
	w([2]uint32{0x409, 80})                             // 72: the data entry
	w([4]uint32{rsrcRVA + 96, uint32(len(info)), 0, 0}) // 80
	b.Write(info)                                       // 96
	return b.Bytes()
}

// peFile is a 32-bit PE whose one section is rsrc, named in the resource directory unless rsrc is nil.
func peFile(rsrc []byte) []byte {
	var b bytes.Buffer
	w := func(x any) { _ = binary.Write(&b, binary.LittleEndian, x) }
	dos := make([]byte, 0x40)
	copy(dos, "MZ")
	binary.LittleEndian.PutUint32(dos[0x3c:], 0x40)
	b.Write(dos)
	b.WriteString("PE\x00\x00")
	oh := pe.OptionalHeader32{Magic: 0x10b, SectionAlignment: 0x1000, FileAlignment: 0x200, NumberOfRvaAndSizes: 16}
	if rsrc != nil {
		oh.DataDirectory[pe.IMAGE_DIRECTORY_ENTRY_RESOURCE] = pe.DataDirectory{VirtualAddress: rsrcRVA, Size: uint32(len(rsrc))}
	}
	w(pe.FileHeader{Machine: pe.IMAGE_FILE_MACHINE_I386, NumberOfSections: 1, SizeOfOptionalHeader: uint16(binary.Size(oh)), Characteristics: 0x102})
	w(oh)
	sh := pe.SectionHeader32{VirtualSize: uint32(len(rsrc)), VirtualAddress: rsrcRVA, SizeOfRawData: uint32(len(rsrc)), PointerToRawData: 0x200}
	copy(sh.Name[:], ".rsrc")
	w(sh)
	b.Write(make([]byte, 0x200-b.Len()))
	b.Write(rsrc)
	return b.Bytes()
}

func exe(v [4]uint16) []byte { return peFile(resources(versionInfo(v))) }

func TestFileVersion(t *testing.T) {
	for _, v := range [][4]uint16{{1, 12, 1, 5875}, {2, 4, 3, 8606}, {3, 3, 5, 12340}, {0, 9, 0, 3734}} {
		got, err := FileVersion(bytes.NewReader(exe(v)))
		if err != nil || got != v {
			t.Errorf("FileVersion of %v = %v, %v", v, got, err)
		}
	}
	if _, err := FileVersion(bytes.NewReader(peFile(nil))); err == nil {
		t.Error("a PE without resources has no version, want an error")
	}
	if _, err := FileVersion(bytes.NewReader([]byte("not a PE file at all"))); err == nil {
		t.Error("not a PE file, want an error")
	}
}

// client makes a client folder: Wow.exe (when exe isn't nil) and Data with the archives named.
func client(t *testing.T, exe []byte, archives ...string) string {
	root := t.TempDir()
	data := filepath.Join(root, "Data")
	if err := os.Mkdir(data, 0o755); err != nil {
		t.Fatal(err)
	}
	if exe != nil {
		if err := os.WriteFile(filepath.Join(root, "WoW.exe"), exe, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	for _, a := range archives {
		if err := os.WriteFile(filepath.Join(data, a), nil, 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return data
}

func TestDetect(t *testing.T) {
	cases := []struct {
		name    string
		data    string
		want    Info
		warning bool
	}{
		{"1.12 Wow.exe", client(t, exe([4]uint16{1, 12, 1, 5875}), "dbc.MPQ"), Info{Build: Vanilla, Exe: "1.12.1.5875", From: "Wow.exe"}, false},
		{"2.4.3 Wow.exe", client(t, exe([4]uint16{2, 4, 3, 8606}), "common.MPQ"), Info{Build: TBC, Exe: "2.4.3.8606", From: "Wow.exe"}, false},
		{"3.3.5a Wow.exe", client(t, exe([4]uint16{3, 3, 5, 12340}), "dbc.MPQ"), Info{Build: WotLK, Exe: "3.3.5.12340", From: "Wow.exe"}, false},
		{"unknown Wow.exe", client(t, exe([4]uint16{1, 11, 2, 5464}), "dbc.MPQ"), Info{Build: Vanilla, Exe: "1.11.2.5464", From: "Wow.exe"}, true},
		{"Wow.exe without a version", client(t, peFile(nil), "lichking.MPQ"), Info{Build: WotLK, From: "archives"}, false},
		{"3.3.5a archives", client(t, nil, "common.MPQ", "common-2.MPQ", "expansion.MPQ", "lichking.MPQ"), Info{Build: WotLK, From: "archives"}, false},
		{"2.4.3 archives", client(t, nil, "common.MPQ", "expansion.MPQ"), Info{Build: TBC, From: "archives"}, false},
		{"1.12 archives (Benilla)", client(t, nil, "dbc.MPQ", "terrain.MPQ", "model.MPQ"), Info{Build: Vanilla, From: "archives"}, false},
		{"nothing to tell", client(t, nil, "patch-3.MPQ"), Info{Build: Vanilla}, false},
	}
	for _, c := range cases {
		got := Detect(c.data)
		if (got.Warning != "") != c.warning {
			t.Errorf("%s: warning %q, want one: %v", c.name, got.Warning, c.warning)
		}
		got.Warning = ""
		if got != c.want {
			t.Errorf("%s: Detect = %+v, want %+v", c.name, got, c.want)
		}
	}
}

func TestDetectReadsTheRoot(t *testing.T) {
	data := client(t, exe([4]uint16{2, 4, 3, 8606}))
	if got := Detect(filepath.Dir(data)).Build; got != TBC {
		t.Errorf("Detect of the client root = %v, want %v", got, TBC)
	}
}
