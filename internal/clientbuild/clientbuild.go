// Package clientbuild tells which WoW client a folder holds (1.12.1, 2.4.3 or 3.3.5a), so the
// readers of its archives can follow that client's formats (#1063, groundwork of #1060).
//
// The build comes from the version resource of the folder's Wow.exe (its FileVersion, e.g.
// 1.12.1.5875), else from the names of the archives in its Data folder (Benilla's folder, and the
// probes' sandbox, have no Wow.exe). A build other than the three is read as 1.12, with a warning.
// It is read once when a client opens (mpq.OpenDataDir), never per frame. It imports only the
// standard library, so internal/mpq can import it.
package clientbuild

import (
	"bytes"
	"debug/pe"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Build is a client's build number.
type Build int

const (
	// Unknown is a build Meld does not know; its readers treat it as Vanilla.
	Unknown Build = 0
	Vanilla Build = 5875  // 1.12.1
	TBC     Build = 8606  // 2.4.3
	WotLK   Build = 12340 // 3.3.5a
)

// Known reports whether b is one of the builds Meld reads.
func (b Build) Known() bool { return b == Vanilla || b == TBC || b == WotLK }

// Version is the client version b is the build of ("1.12.1"), or "" for another build.
func (b Build) Version() string {
	switch b {
	case Vanilla:
		return "1.12.1"
	case TBC:
		return "2.4.3"
	case WotLK:
		return "3.3.5a"
	}
	return ""
}

func (b Build) String() string {
	if v := b.Version(); v != "" {
		return fmt.Sprintf("%s (%d)", v, int(b))
	}
	return fmt.Sprintf("build %d", int(b))
}

// Info is what Detect found.
type Info struct {
	// Build is the build the readers follow: one of the known builds, Vanilla for an unknown one.
	Build Build
	// Exe is the FileVersion Wow.exe names ("1.12.1.5875"), "" when it was not read.
	Exe string
	// From says where the build came from: "Wow.exe", "archives", or "" when nothing told it and
	// it was assumed to be 1.12.
	From string
	// Warning is set when the client's build is not one Meld knows, for the status line.
	Warning string
}

// Detect tells the build of the client whose Data folder (or root) is dir: Wow.exe's version
// resource in dir or its parent (the root of a Data folder) first, then the archive names in dir.
func Detect(dir string) Info {
	for _, d := range []string{dir, filepath.Dir(dir)} {
		exe := findExe(d)
		if exe == "" {
			continue
		}
		v, err := exeVersion(exe)
		if err != nil {
			continue // no version resource: the archives tell
		}
		info := Info{Build: Build(v[3]), Exe: fmt.Sprintf("%d.%d.%d.%d", v[0], v[1], v[2], v[3]), From: "Wow.exe"}
		if !info.Build.Known() {
			info.Warning = fmt.Sprintf("Unknown client build %s (%s): Meld reads it as 1.12.1", info.Exe, filepath.Base(exe))
			info.Build = Vanilla
		}
		return info
	}
	if b := fromArchives(dir); b != Unknown {
		return Info{Build: b, From: "archives"}
	}
	return Info{Build: Vanilla}
}

// findExe is the path of dir's Wow.exe, in any case, or "".
func findExe(dir string) string {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return ""
	}
	for _, e := range entries {
		if !e.IsDir() && strings.EqualFold(e.Name(), "wow.exe") {
			return filepath.Join(dir, e.Name())
		}
	}
	return ""
}

// fromArchives tells the build by the archives each client ships: 3.3.5a's lichking.MPQ and
// common-2.MPQ, 2.4.3's expansion.MPQ and common.MPQ, 1.12's dbc.MPQ and terrain.MPQ.
func fromArchives(dir string) Build {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return Unknown
	}
	has := map[string]bool{}
	for _, e := range entries {
		if !e.IsDir() {
			has[strings.ToLower(e.Name())] = true
		}
	}
	switch {
	case has["lichking.mpq"] || has["common-2.mpq"]:
		return WotLK
	case has["expansion.mpq"] || has["common.mpq"]:
		return TBC
	case has["dbc.mpq"] || has["terrain.mpq"]:
		return Vanilla
	}
	return Unknown
}

type exeKey struct {
	path string
	size int64
	mod  time.Time
}

// exeCache keeps each Wow.exe's version by its size and time, since every mpq.OpenDataDir (the DBC
// readers open the client per call) asks again.
var exeCache sync.Map // exeKey -> [4]uint16

func exeVersion(path string) ([4]uint16, error) {
	st, err := os.Stat(path)
	if err != nil {
		return [4]uint16{}, err
	}
	key := exeKey{path, st.Size(), st.ModTime()}
	if v, ok := exeCache.Load(key); ok {
		return v.([4]uint16), nil
	}
	f, err := os.Open(path)
	if err != nil {
		return [4]uint16{}, err
	}
	defer f.Close()
	v, err := FileVersion(f)
	if err != nil {
		return v, err
	}
	exeCache.Store(key, v)
	return v, nil
}

// errNoVersion is a PE file without a version resource.
var errNoVersion = errors.New("no version resource")

const (
	rtVersion       = 16         // RT_VERSION
	fixedSignature  = 0xFEEF04BD // VS_FIXEDFILEINFO.dwSignature
	resourceDirSize = 16         // IMAGE_RESOURCE_DIRECTORY
	resourceEntry   = 8          // IMAGE_RESOURCE_DIRECTORY_ENTRY
	subdirectoryBit = 0x80000000
)

// FileVersion reads a PE file's FileVersion from its VS_VERSIONINFO resource (VS_FIXEDFILEINFO's
// dwFileVersionMS and LS): major, minor, patch and build. Go's debug/pe reads the sections but not
// the resource tree, which this walks: the RT_VERSION type, its first name, its first language.
func FileVersion(r io.ReaderAt) ([4]uint16, error) {
	var v [4]uint16
	f, err := pe.NewFile(r)
	if err != nil {
		return v, err
	}
	var dir pe.DataDirectory
	switch oh := f.OptionalHeader.(type) {
	case *pe.OptionalHeader32:
		if oh.NumberOfRvaAndSizes > pe.IMAGE_DIRECTORY_ENTRY_RESOURCE {
			dir = oh.DataDirectory[pe.IMAGE_DIRECTORY_ENTRY_RESOURCE]
		}
	case *pe.OptionalHeader64:
		if oh.NumberOfRvaAndSizes > pe.IMAGE_DIRECTORY_ENTRY_RESOURCE {
			dir = oh.DataDirectory[pe.IMAGE_DIRECTORY_ENTRY_RESOURCE]
		}
	}
	if dir.VirtualAddress == 0 {
		return v, errNoVersion
	}
	sec := sectionAt(f, dir.VirtualAddress)
	if sec == nil {
		return v, errNoVersion
	}
	data, err := sec.Data()
	if err != nil {
		return v, err
	}
	rsrc := uint32(dir.VirtualAddress - sec.VirtualAddress)
	if rsrc >= uint32(len(data)) {
		return v, errNoVersion
	}
	root := data[rsrc:]
	// Type, name, language: each level's entry points at the next directory, the last at the data entry.
	off, ok := entry(root, 0, rtVersion)
	for level := 0; ok && level < 2; level++ {
		if off&subdirectoryBit == 0 {
			return v, errNoVersion
		}
		off, ok = entry(root, off&^subdirectoryBit, -1)
	}
	if !ok || off&subdirectoryBit != 0 || int(off)+8 > len(root) {
		return v, errNoVersion
	}
	dataRVA := binary.LittleEndian.Uint32(root[off:])
	size := binary.LittleEndian.Uint32(root[off+4:])
	ds := sectionAt(f, dataRVA)
	if ds == nil {
		return v, errNoVersion
	}
	if ds != sec {
		if data, err = ds.Data(); err != nil {
			return v, err
		}
	}
	start := dataRVA - ds.VirtualAddress
	if uint64(start)+uint64(size) > uint64(len(data)) {
		return v, errNoVersion
	}
	info := data[start : start+size]
	var sig [4]byte
	binary.LittleEndian.PutUint32(sig[:], fixedSignature)
	i := bytes.Index(info, sig[:])
	if i < 0 || i+16 > len(info) {
		return v, errNoVersion
	}
	ms := binary.LittleEndian.Uint32(info[i+8:])
	ls := binary.LittleEndian.Uint32(info[i+12:])
	return [4]uint16{uint16(ms >> 16), uint16(ms), uint16(ls >> 16), uint16(ls)}, nil
}

// entry is the OffsetToData of the directory at off's entry with the ID id, or of its first entry
// when id is -1.
func entry(root []byte, off uint32, id int) (uint32, bool) {
	if uint64(off)+resourceDirSize > uint64(len(root)) {
		return 0, false
	}
	named := int(binary.LittleEndian.Uint16(root[off+12:]))
	ids := int(binary.LittleEndian.Uint16(root[off+14:]))
	for i := 0; i < named+ids; i++ {
		e := int(off) + resourceDirSize + i*resourceEntry
		if e+resourceEntry > len(root) {
			return 0, false
		}
		name := binary.LittleEndian.Uint32(root[e:])
		if id < 0 || (name&subdirectoryBit == 0 && name == uint32(id)) {
			return binary.LittleEndian.Uint32(root[e+4:]), true
		}
	}
	return 0, false
}

// sectionAt is the section that holds rva, or nil.
func sectionAt(f *pe.File, rva uint32) *pe.Section {
	for _, s := range f.Sections {
		size := s.VirtualSize
		if s.Size > size {
			size = s.Size
		}
		if rva >= s.VirtualAddress && rva < s.VirtualAddress+size {
			return s
		}
	}
	return nil
}
