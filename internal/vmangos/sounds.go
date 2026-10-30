package vmangos

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"Meld/internal/mpq"
)

// The Sound tool (#684): the client's sounds listed, played, exported as the files they are, imported
// from WAV or MP3 files and replaced. The game never plays a bare file: a zone (through its ZoneMusic,
// ZoneIntroMusicTable and SoundAmbience rows), a game object display's sound slots and the interface
// name a SoundEntries.dbc row, which lists up to ten files in one folder. So an imported sound is its
// file in Meld's patch under ImportedSoundDir plus a SoundEntries row naming it, and for zone music or
// ambience a ZoneMusic or SoundAmbience row playing that sound day and night, which the Zones dialog
// lists. A replace puts a new file at a client sound's own path, which every row naming it then plays.
// Every file goes into Meld's patch as the editors' tables do (at once, or once the game has closed).

// SoundDir is the folder of the client's sounds, and ImportedSoundDir the one Meld's imports go in.
const (
	SoundDir         = `Sound\`
	ImportedSoundDir = `Sound\Meld`
)

// ZoneMusicPath and SoundAmbiencePath are the zone sound tables an import adds a row to.
const (
	ZoneMusicPath     = `DBFilesClient\ZoneMusic.dbc`
	ZoneIntroPath     = `DBFilesClient\ZoneIntroMusicTable.dbc`
	SoundAmbiencePath = `DBFilesClient\SoundAmbience.dbc`
)

// SoundEntries.dbc's 1.12 fields (wowdev's SoundEntries, checked against the client): ID, the sound
// type, the name, ten files, their ten frequencies (weights), the folder, then volume, flags, minimum
// distance, distance cutoff and EAX definition.
const (
	seType     = 1
	seName     = 2
	seFile     = 3
	seFreq     = 13
	seDir      = 23
	seVolume   = 24
	seFlags    = 25
	seMinDist  = 26
	seCutoff   = 27
	seEAX      = 28
	soundFiles = 10
)

// IsSoundPath says whether a client file is a sound the WebView and the game play: a WAV or an MP3
// under Sound\.
func IsSoundPath(path string) bool {
	l := strings.ToLower(strings.ReplaceAll(path, "/", `\`))
	return strings.HasPrefix(l, `sound\`) && (strings.HasSuffix(l, ".wav") || strings.HasSuffix(l, ".mp3"))
}

// PendingSound is the data of a sound file waiting for the game to close, so Play plays an imported or
// replaced sound before the patch has it.
func PendingSound(dataDir, path string) ([]byte, bool) {
	if !IsSoundPath(path) {
		return nil, false
	}
	return pendingFile(dataDir, strings.ReplaceAll(path, "/", `\`))
}

// SoundFileList lists the client's sound files (WAV and MP3 under Sound\, the ones waiting for the
// game to close included), by path, one of each in any case.
func SoundFileList(dataDir string) ([]string, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	seen := map[string]bool{}
	var out []string
	for _, f := range append(set.List(), pendingFileNames(dataDir)...) {
		f = strings.ReplaceAll(f, "/", `\`)
		k := strings.ToLower(f)
		if !IsSoundPath(f) || seen[k] {
			continue
		}
		seen[k] = true
		out = append(out, f)
	}
	if len(out) == 0 {
		return nil, errors.New("the client's archives list no sounds")
	}
	sort.Slice(out, func(i, j int) bool { return strings.ToLower(out[i]) < strings.ToLower(out[j]) })
	return out, nil
}

// SoundEntryInfo is a SoundEntries row as the Sound tool shows it: its fields, its files (client
// paths) and what plays it.
type SoundEntryInfo struct {
	ID       uint32   `json:"id"`
	Name     string   `json:"name"`
	Type     uint32   `json:"type"`
	Dir      string   `json:"dir"`
	Files    []string `json:"files"`
	Volume   float64  `json:"volume"`
	Flags    uint32   `json:"flags"`
	MinDist  float64  `json:"minDist"`
	Cutoff   float64  `json:"cutoff"`
	Imported bool     `json:"imported"`
	// The ZoneMusic, ZoneIntroMusicTable and SoundAmbience rows that play it, and how many game
	// object displays have it in a sound slot.
	Music    []SoundOption `json:"music"`
	Intro    []SoundOption `json:"intro"`
	Ambience []SoundOption `json:"ambience"`
	Displays int           `json:"displays"`
}

// round3 keeps a float32 field's value as it reads (0.69, not 0.6899999976).
func round3(v float32) float64 { return math.Round(float64(v)*1000) / 1000 }

// soundEntryInfo reads row id of SoundEntries and what plays it from the zone tables and
// GameObjectDisplayInfo (by name; a table missing from tables is skipped).
func soundEntryInfo(tables map[string][]byte, id uint32) (SoundEntryInfo, error) {
	se, err := parseSized(tables["SoundEntries"], "SoundEntries.dbc", soundTableFields["SoundEntries"])
	if err != nil {
		return SoundEntryInfo{}, err
	}
	r, ok := se.row(id)
	if !ok || id == 0 {
		return SoundEntryInfo{}, fmt.Errorf("the client has no sound %d in SoundEntries.dbc", id)
	}
	dir := strings.TrimSuffix(se.str(r, seDir), `\`)
	out := SoundEntryInfo{
		ID: id, Name: se.str(r, seName), Type: se.u32(r, seType), Dir: dir, Files: []string{},
		Volume: round3(se.f32(r, seVolume)), Flags: se.u32(r, seFlags), MinDist: round3(se.f32(r, seMinDist)), Cutoff: round3(se.f32(r, seCutoff)),
		Imported: strings.EqualFold(dir, ImportedSoundDir),
		Music:    []SoundOption{}, Intro: []SoundOption{}, Ambience: []SoundOption{},
	}
	for f := seFile; f < seFile+soundFiles; f++ {
		if file := se.str(r, f); file != "" {
			out.Files = append(out.Files, dir+`\`+file)
		}
	}
	if m, err := parseSized(tables["ZoneMusic"], "ZoneMusic.dbc", soundTableFields["ZoneMusic"]); err == nil {
		for i := 0; i < m.records; i++ {
			if m.u32(i, 6) == id || m.u32(i, 7) == id {
				out.Music = append(out.Music, SoundOption{ID: m.u32(i, 0), Name: m.str(i, 1)})
			}
		}
	}
	if in, err := parseSized(tables["ZoneIntroMusicTable"], "ZoneIntroMusicTable.dbc", soundTableFields["ZoneIntroMusicTable"]); err == nil {
		for i := 0; i < in.records; i++ {
			if in.u32(i, 2) == id {
				out.Intro = append(out.Intro, SoundOption{ID: in.u32(i, 0), Name: in.str(i, 1)})
			}
		}
	}
	if a, err := parseSized(tables["SoundAmbience"], "SoundAmbience.dbc", soundTableFields["SoundAmbience"]); err == nil {
		for i := 0; i < a.records; i++ {
			if a.u32(i, 1) == id || a.u32(i, 2) == id {
				out.Ambience = append(out.Ambience, SoundOption{ID: a.u32(i, 0), Name: out.Name})
			}
		}
	}
	if d, err := parseSized(tables["GameObjectDisplayInfo"], "GameObjectDisplayInfo.dbc", objectDisplayFields); err == nil {
		for i := 0; i < d.records; i++ {
			for s := 2; s < objectDisplayFields; s++ {
				if d.u32(i, s) == id {
					out.Displays++
					break
				}
			}
		}
	}
	return out, nil
}

// soundTablePaths are the tables the Sound tool reads, by the name soundEntryInfo and the import
// take them under.
var soundTablePaths = map[string]string{
	"SoundEntries":          SoundEntriesPath,
	"ZoneMusic":             ZoneMusicPath,
	"ZoneIntroMusicTable":   ZoneIntroPath,
	"SoundAmbience":         SoundAmbiencePath,
	"GameObjectDisplayInfo": GameObjectDisplayInfoPath,
}

// readSoundTables reads the Sound tool's tables as the game will have them (readOverlay).
func readSoundTables(set *mpq.Set, dataDir string) (map[string][]byte, error) {
	out := make(map[string][]byte, len(soundTablePaths))
	for name, path := range soundTablePaths {
		b, err := readOverlay(set, dataDir, path)
		if err != nil {
			return nil, fmt.Errorf("%s.dbc: %w", name, err)
		}
		out[name] = b
	}
	return out, nil
}

// ReadSoundEntry reads a SoundEntries row and what plays it, as the game will have them.
func ReadSoundEntry(dataDir string, id uint32) (SoundEntryInfo, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return SoundEntryInfo{}, err
	}
	defer set.Close()
	tables, err := readSoundTables(set, dataDir)
	if err != nil {
		return SoundEntryInfo{}, err
	}
	return soundEntryInfo(tables, id)
}

// SoundFormat says which kind of sound data is, "wav" or "mp3", or why the game can't play it: a WAV
// must be uncompressed PCM of 8 or 16 bits, one or two channels (as the client's own are), and an MP3
// must start with an ID3 tag or an MPEG audio frame.
func SoundFormat(data []byte) (string, error) {
	if len(data) >= 12 && string(data[:4]) == "RIFF" && string(data[8:12]) == "WAVE" {
		var fmtSeen, dataSeen bool
		for at := 12; at+8 <= len(data); {
			id, size := string(data[at:at+4]), int(binary.LittleEndian.Uint32(data[at+4:]))
			body := at + 8
			if size < 0 || body+size > len(data) {
				if id == "data" {
					// A data chunk cut short still plays to its end.
					dataSeen = true
				}
				break
			}
			switch id {
			case "fmt ":
				if size < 16 {
					return "", errors.New("the WAV's format chunk is too short")
				}
				tag := binary.LittleEndian.Uint16(data[body:])
				channels := binary.LittleEndian.Uint16(data[body+2:])
				bits := binary.LittleEndian.Uint16(data[body+14:])
				if tag != 1 {
					return "", fmt.Errorf("the WAV is compressed (format %d); save it as 16-bit PCM", tag)
				}
				if bits != 8 && bits != 16 {
					return "", fmt.Errorf("the WAV has %d-bit samples; save it as 16-bit PCM", bits)
				}
				if channels != 1 && channels != 2 {
					return "", fmt.Errorf("the WAV has %d channels; save it as mono or stereo", channels)
				}
				fmtSeen = true
			case "data":
				dataSeen = true
			}
			at = body + size + size&1
		}
		if !fmtSeen || !dataSeen {
			return "", errors.New("the WAV has no format or no sound data")
		}
		return "wav", nil
	}
	if len(data) >= 3 && string(data[:3]) == "ID3" || len(data) >= 2 && data[0] == 0xFF && data[1]&0xE0 == 0xE0 {
		return "mp3", nil
	}
	return "", errors.New("not a WAV or MP3 file")
}

var soundStemRe = regexp.MustCompile(`^[A-Za-z0-9_-]+$`)

// SoundFileName is the file name a sound file takes in the client: its name, spaces as underscores,
// letters, digits, _ and - only, with its .wav or .mp3 extension in lower case.
func SoundFileName(file string) (string, error) {
	base := filepath.Base(file)
	ext := strings.ToLower(filepath.Ext(base))
	if ext != ".wav" && ext != ".mp3" {
		return "", fmt.Errorf("%s: a sound is a .wav or .mp3 file", base)
	}
	stem := strings.ReplaceAll(strings.TrimSpace(strings.TrimSuffix(base, filepath.Ext(base))), " ", "_")
	if !soundStemRe.MatchString(stem) {
		return "", fmt.Errorf("%s: a sound file's name takes only letters, digits, _ and -", base)
	}
	if len(stem) > 80 {
		return "", fmt.Errorf("%s: the name is longer than 80 letters", base)
	}
	return stem + ext, nil
}

// SoundImport is what a sound file is imported as: the SoundEntries row's name, its kind (what uses
// it) and its volume (0 to 1).
type SoundImport struct {
	Name   string  `json:"name"`
	Kind   string  `json:"kind"`
	Volume float64 `json:"volume"`
}

// soundKind is a kind's SoundEntries type, flags, distances and EAX definition, from the client's own
// rows of that use: a one-shot like ChestOpen, a loop like CampFireLargeLoop, zone music like
// Zone-Forest Day, ambience like BeachDay.
type soundKind struct {
	typ, flags      uint32
	minDist, cutoff float32
	eax             uint32
}

// soundKinds are the kinds an import takes: "sound" (a one-shot, for an object's open or close slot
// or the interface), "loop" (an object's stand or loop slot), "music" (adds a ZoneMusic row) and
// "ambience" (adds a SoundAmbience row).
var soundKinds = map[string]soundKind{
	"sound":    {typ: 25, flags: 0, minDist: 8, cutoff: 45, eax: 2},
	"loop":     {typ: 25, flags: 0x220, minDist: 4, cutoff: 30, eax: 2},
	"music":    {typ: 28, flags: 0, minDist: 8, cutoff: 45, eax: 2},
	"ambience": {typ: 50, flags: 0x220, minDist: 8, cutoff: 45, eax: 0},
}

// ZoneMusic's silence between two plays (ms, the least and the most, day then night): the client's
// own rows' values.
var zoneMusicSilence = []uint32{180000, 180000, 300000, 300000}

// soundImported is what importSoundRows did: the SoundEntries ID and, for music or ambience, the
// ZoneMusic or SoundAmbience ID; reused says the sound's row was there already (an imported file
// imported again).
type soundImported struct {
	id, zone uint32
	reused   bool
}

// maxID is a table's largest ID.
func maxID(t *dbcTable) uint32 {
	var m uint32
	for id := range t.byID {
		m = max(m, id)
	}
	return m
}

// importSoundRows returns the tables (by name: SoundEntries, ZoneMusic, SoundAmbience) with a row for
// the sound file fileName in ImportedSoundDir, and for music or ambience a zone row playing it, only
// the tables it changed. A row that already names that file in that folder (an earlier import of it)
// is updated in place, keeping its ID, and a zone row already playing it is kept. A name another
// sound has is refused: the interface plays a sound by its name (PlaySound).
func importSoundRows(tables map[string][]byte, fileName string, opt SoundImport) (map[string][]byte, soundImported, error) {
	kind, ok := soundKinds[opt.Kind]
	if !ok {
		return nil, soundImported{}, fmt.Errorf("no sound kind %q", opt.Kind)
	}
	name := strings.TrimSpace(opt.Name)
	switch {
	case name == "":
		return nil, soundImported{}, errors.New("the sound needs a name")
	case len(name) > 100:
		return nil, soundImported{}, errors.New("the name is longer than 100 letters")
	case strings.ContainsFunc(name, func(r rune) bool { return r < ' ' || r == '"' || r == '\\' }):
		return nil, soundImported{}, errors.New(`the name can't hold quotes, backslashes or control characters`)
	case !(opt.Volume > 0 && opt.Volume <= 1):
		return nil, soundImported{}, errors.New("the volume is from 0 to 1")
	}
	se, err := parseSized(tables["SoundEntries"], "SoundEntries.dbc", soundTableFields["SoundEntries"])
	if err != nil {
		return nil, soundImported{}, err
	}
	var res soundImported
	for r := 0; r < se.records; r++ {
		if strings.EqualFold(strings.TrimSuffix(se.str(r, seDir), `\`), ImportedSoundDir) && strings.EqualFold(se.str(r, seFile), fileName) {
			res.id, res.reused = se.u32(r, 0), true
			break
		}
	}
	for r := 0; r < se.records; r++ {
		if id := se.u32(r, 0); id != res.id && strings.EqualFold(se.str(r, seName), name) {
			return nil, soundImported{}, fmt.Errorf("the client has a sound named %s (%d); give this one another name", se.str(r, seName), id)
		}
	}
	rec := make([]uint32, se.fields)
	if res.reused {
		r, _ := se.row(res.id)
		rec = se.record(r)
		for f := seFile; f < seFile+soundFiles; f++ {
			rec[f], rec[f+soundFiles] = 0, 0
		}
	} else {
		res.id = maxID(se) + 1
	}
	rec[0] = res.id
	rec[seType], rec[seFlags], rec[seEAX] = kind.typ, kind.flags, kind.eax
	rec[seFreq] = 1
	rec[seVolume] = math.Float32bits(float32(opt.Volume))
	rec[seMinDist], rec[seCutoff] = math.Float32bits(kind.minDist), math.Float32bits(kind.cutoff)
	out := map[string][]byte{}
	if out["SoundEntries"], err = putRecord(tables["SoundEntries"], rec, map[int]string{seName: name, seFile: fileName, seDir: ImportedSoundDir}); err != nil {
		return nil, soundImported{}, err
	}
	switch opt.Kind {
	case "music":
		m, err := parseSized(tables["ZoneMusic"], "ZoneMusic.dbc", soundTableFields["ZoneMusic"])
		if err != nil {
			return nil, soundImported{}, err
		}
		for r := 0; r < m.records && res.zone == 0; r++ {
			if m.u32(r, 6) == res.id && m.u32(r, 7) == res.id {
				res.zone = m.u32(r, 0)
			}
		}
		if res.zone == 0 {
			res.zone = maxID(m) + 1
			row := append(append([]uint32{res.zone, 0}, zoneMusicSilence...), res.id, res.id)
			if out["ZoneMusic"], err = putRecord(tables["ZoneMusic"], row, map[int]string{1: name}); err != nil {
				return nil, soundImported{}, err
			}
		}
	case "ambience":
		a, err := parseSized(tables["SoundAmbience"], "SoundAmbience.dbc", soundTableFields["SoundAmbience"])
		if err != nil {
			return nil, soundImported{}, err
		}
		for r := 0; r < a.records && res.zone == 0; r++ {
			if a.u32(r, 1) == res.id && a.u32(r, 2) == res.id {
				res.zone = a.u32(r, 0)
			}
		}
		if res.zone == 0 {
			res.zone = maxID(a) + 1
			if out["SoundAmbience"], err = setRecords(tables["SoundAmbience"], [][]uint32{{res.zone, res.id, res.id}}); err != nil {
				return nil, soundImported{}, err
			}
		}
	}
	return out, res, nil
}

// SoundImported is what an import added: the sound's SoundEntries ID and file, the ZoneMusic or
// SoundAmbience ID for music or ambience (0 otherwise), and whether it updated an earlier import of
// the same file.
type SoundImported struct {
	ID      uint32 `json:"id"`
	File    string `json:"file"`
	Zone    uint32 `json:"zone"`
	Updated bool   `json:"updated"`
	Waiting bool   `json:"waiting"`
}

// PlanSoundImport makes the patch files that import data (the sound file named file) as opt says:
// the file under ImportedSoundDir and the tables importSoundRows changed. A file the client has at that
// path outside Meld's patch is refused, so a client sound is never covered by an import (Replace does
// that on purpose).
func PlanSoundImport(dataDir, file string, data []byte, opt SoundImport) ([]mpq.File, SoundImported, error) {
	fileName, err := SoundFileName(file)
	if err != nil {
		return nil, SoundImported{}, err
	}
	format, err := SoundFormat(data)
	if err != nil {
		return nil, SoundImported{}, fmt.Errorf("%s: %w", filepath.Base(file), err)
	}
	if "."+format != filepath.Ext(fileName) {
		return nil, SoundImported{}, fmt.Errorf("%s holds %s sound, not what its extension says", filepath.Base(file), strings.ToUpper(format))
	}
	path := ImportedSoundDir + `\` + fileName
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, SoundImported{}, err
	}
	defer set.Close()
	if _, err := set.ReadFileExcept(path, PatchName); err == nil {
		return nil, SoundImported{}, fmt.Errorf("the client has %s already (rename the file)", path)
	}
	tables, err := readSoundTables(set, dataDir)
	if err != nil {
		return nil, SoundImported{}, err
	}
	changed, res, err := importSoundRows(tables, fileName, opt)
	if err != nil {
		return nil, SoundImported{}, err
	}
	files := []mpq.File{{Name: path, Data: data}}
	for _, name := range []string{"SoundEntries", "ZoneMusic", "SoundAmbience"} {
		if b, ok := changed[name]; ok {
			files = append(files, mpq.File{Name: soundTablePaths[name], Data: b})
		}
	}
	return files, SoundImported{ID: res.id, File: path, Zone: res.zone, Updated: res.reused}, nil
}

// PlanSoundReplace makes the patch file that replaces the client's sound at target with data, which
// must be the same kind of sound (a WAV for a .wav, an MP3 for an .mp3) and one the game plays. Every
// SoundEntries row naming that file plays the new one.
func PlanSoundReplace(dataDir, target string, data []byte) ([]mpq.File, error) {
	target = strings.ReplaceAll(target, "/", `\`)
	if !IsSoundPath(target) {
		return nil, fmt.Errorf("%s is not a sound file under Sound\\", target)
	}
	format, err := SoundFormat(data)
	if err != nil {
		return nil, err
	}
	if !strings.EqualFold(filepath.Ext(target), "."+format) {
		return nil, fmt.Errorf("%s is %s and the file given is %s: convert it first", filepath.Base(target), strings.ToUpper(strings.TrimPrefix(filepath.Ext(target), ".")), strings.ToUpper(format))
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	if _, err := readOverlay(set, dataDir, target); err != nil {
		return nil, fmt.Errorf("the client has no %s", target)
	}
	return []mpq.File{{Name: target, Data: data}}, nil
}

// ExportSounds writes the client's sound files at paths into dir, each under its own file name, as
// the game will play them (a file waiting for the game to close included), and returns how many it
// wrote and the paths it could not read.
func ExportSounds(dataDir string, paths []string, dir string) (int, []string, error) {
	if info, err := os.Stat(dir); err != nil || !info.IsDir() {
		return 0, nil, fmt.Errorf("%s is not a folder", dir)
	}
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return 0, nil, err
	}
	defer set.Close()
	n := 0
	var failed []string
	for _, p := range paths {
		p = strings.ReplaceAll(p, "/", `\`)
		name := p[strings.LastIndex(p, `\`)+1:]
		if !IsSoundPath(p) || !iconNameOK(name) {
			failed = append(failed, p)
			continue
		}
		data, err := readOverlay(set, dataDir, p)
		if err != nil {
			failed = append(failed, p)
			continue
		}
		if err := os.WriteFile(filepath.Join(dir, name), data, 0o644); err != nil {
			return n, failed, err
		}
		n++
	}
	if n == 0 && len(failed) > 0 {
		return 0, failed, errors.New("none of the sounds could be read")
	}
	return n, failed, nil
}
