package vmangos

import (
	"errors"
	"fmt"
	"math"
	"sort"
	"strings"

	"Meld/internal/mpq"
)

// Lifts and elevators (#956). A game object of type 11 (GAMEOBJECT_TYPE_TRANSPORT) is a lift: it moves
// along a loop of keyframes in TransportAnimation.dbc, keyed by its gameobject_template entry, so every
// spawn of the entry moves the same way. A keyframe is a time in milliseconds since the loop's start
// and an offset in yards from the spawn's position, turned by the spawn's rotation; between two frames
// the lift moves in a straight line at an even speed, two frames at the same offset are a wait, and the
// last frame's time is the loop's length, after which it starts again at the first (at time 0). The
// client moves the lift from its own copy of the table (Benilla's elevators.rs, the client's 0x5f6280)
// and the server from its own (ElevatorTransport::Update), on the same clock, so a save writes both.
// The server reads the table and the type 11 spawns only when it starts.

// TransportAnimationPath is the lifts' table in the client's archives.
const TransportAnimationPath = `DBFilesClient\TransportAnimation.dbc`

// The 1.12 layout (VMaNGOS's DBCfmt.h "diifffx", Benilla's schema): ID, the template entry, the time,
// the offset's x, y and z, and the model's animation for the span after the frame (the client's
// SequenceID; neither the server nor Benilla reads it, the client's own lifts hold 0 or 162 and 164).
const (
	liftFields = 7
	liftEntry  = 1
	liftTime   = 2
	liftX      = 3
	liftSeq    = 6
)

// objectTypeLift is gameobject_template's type of a lift (GAMEOBJECT_TYPE_TRANSPORT).
const objectTypeLift = 11

// liftFlags is the flags most of the client's own lifts' templates have: 0x20 (no despawn) and 0x08
// (transport). The server sets both on a type 11 object anyway (GameObject::Create).
const liftFlags = 0x28

// maxLiftFrames and maxLiftTime bound a lift's loop: far more frames than the client's own (the
// longest has 22) and a day, so a slip of a typed number is refused rather than written.
const (
	maxLiftFrames = 1000
	maxLiftTime   = 24 * 60 * 60 * 1000
	maxLiftOffset = 5000
)

// LiftFrame is a keyframe of a lift's loop: Time milliseconds after the loop's start, the lift stands
// X, Y and Z yards from its spawn (the server's axes, before the spawn's rotation). Seq is the model's
// animation for the span after it, kept as the table has it.
type LiftFrame struct {
	Time uint32  `json:"time"`
	X    float32 `json:"x"`
	Y    float32 `json:"y"`
	Z    float32 `json:"z"`
	Seq  uint32  `json:"seq"`
}

// LiftMotion is a lift template's loop: its keyframes in time order.
type LiftMotion struct {
	Entry  uint32      `json:"entry"`
	Frames []LiftFrame `json:"frames"`
}

// LiftEdit is what World › Lifts saves: a template's loop, and for a new lift (New) its template's
// name, model (a display) and size.
type LiftEdit struct {
	Entry     uint32      `json:"entry"`
	New       bool        `json:"new"`
	Name      string      `json:"name"`
	DisplayID uint32      `json:"displayId"`
	Size      float32     `json:"size"`
	Frames    []LiftFrame `json:"frames"`
}

// liftTable parses TransportAnimation.dbc and checks it has the 1.12 layout.
func liftTable(dbc []byte) (*dbcTable, error) {
	t, err := parseDBC(dbc)
	if err != nil {
		return nil, fmt.Errorf("TransportAnimation.dbc: %w", err)
	}
	if t.fields != liftFields || t.recSize != liftFields*4 {
		return nil, fmt.Errorf("TransportAnimation.dbc has %d fields of %d bytes a record, not 1.12's %d", t.fields, t.recSize, liftFields)
	}
	return t, nil
}

// ReadLiftMotions lists every template's loop in TransportAnimation.dbc, by entry, each loop's frames
// in time order.
func ReadLiftMotions(dbc []byte) ([]LiftMotion, error) {
	t, err := liftTable(dbc)
	if err != nil {
		return nil, err
	}
	by := map[uint32][]LiftFrame{}
	for r := 0; r < t.records; r++ {
		e := t.u32(r, liftEntry)
		by[e] = append(by[e], LiftFrame{Time: t.u32(r, liftTime), X: t.f32(r, liftX), Y: t.f32(r, liftX+1), Z: t.f32(r, liftX+2), Seq: t.u32(r, liftSeq)})
	}
	out := make([]LiftMotion, 0, len(by))
	for e, f := range by {
		sort.SliceStable(f, func(i, j int) bool { return f[i].Time < f[j].Time })
		out = append(out, LiftMotion{Entry: e, Frames: f})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Entry < out[j].Entry })
	return out, nil
}

// CheckLiftFrames refuses a loop the client and the server would not move a lift along: at least two
// frames, the first at time 0, each later than the one before (the server keys them by time, so two at
// one time would leave one), and offsets that are numbers within reach.
func CheckLiftFrames(frames []LiftFrame) error {
	if len(frames) < 2 {
		return errors.New("a lift's loop needs at least two frames")
	}
	if len(frames) > maxLiftFrames {
		return fmt.Errorf("a lift's loop has %d frames, more than %d", len(frames), maxLiftFrames)
	}
	if frames[0].Time != 0 {
		return errors.New("a lift's loop starts at time 0")
	}
	for i, f := range frames {
		if i > 0 && f.Time <= frames[i-1].Time {
			return fmt.Errorf("frame %d comes no later than the frame before it: each frame needs a later time", i+1)
		}
		if !finite(f.X, f.Y, f.Z) {
			return fmt.Errorf("frame %d has an offset that is not a number", i+1)
		}
		if math.Abs(float64(f.X)) > maxLiftOffset || math.Abs(float64(f.Y)) > maxLiftOffset || math.Abs(float64(f.Z)) > maxLiftOffset {
			return fmt.Errorf("frame %d is more than %d yards from the lift's spawn", i+1, maxLiftOffset)
		}
	}
	if frames[len(frames)-1].Time > maxLiftTime {
		return errors.New("a lift's loop takes longer than a day")
	}
	return nil
}

// CheckLift refuses an edit the server would not take: a loop CheckLiftFrames refuses, an entry out of
// range, and for a new lift a missing name or model.
func CheckLift(e LiftEdit) error {
	if e.Entry == 0 || e.Entry > 1<<24-1 {
		return fmt.Errorf("lift %d: the entry must be 1 to %d", e.Entry, 1<<24-1)
	}
	if e.New {
		if strings.TrimSpace(e.Name) == "" {
			return errors.New("the lift needs a name")
		}
		if len(e.Name) > 100 {
			return errors.New("the lift's name is longer than 100 characters")
		}
		if e.DisplayID == 0 || e.DisplayID > 1<<24-1 {
			return errors.New("the lift needs a model (a game object display)")
		}
		if !(e.Size > 0) || !finite(e.Size) {
			return errors.New("the lift's size must be above 0")
		}
	}
	return CheckLiftFrames(e.Frames)
}

// SetLiftFrames returns TransportAnimation.dbc with entry's frames replaced by frames: they take the
// entry's old rows' IDs in order and, past those, IDs after the table's highest; the entry's rows left
// over are taken out. No frames takes the entry's loop out.
func SetLiftFrames(dbc []byte, entry uint32, frames []LiftFrame) ([]byte, error) {
	t, err := liftTable(dbc)
	if err != nil {
		return nil, err
	}
	var ids []uint32
	var top uint32
	for r := 0; r < t.records; r++ {
		id := t.u32(r, 0)
		top = max(top, id)
		if t.u32(r, liftEntry) == entry {
			ids = append(ids, id)
		}
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	rows := make([][]uint32, len(frames))
	for i, f := range frames {
		var id uint32
		if i < len(ids) {
			id = ids[i]
		} else {
			top++
			id = top
		}
		rows[i] = []uint32{id, entry, f.Time, math.Float32bits(f.X), math.Float32bits(f.Y), math.Float32bits(f.Z), f.Seq}
	}
	out := dbc
	if len(ids) > len(frames) {
		gone := map[uint32]bool{}
		for _, id := range ids[len(frames):] {
			gone[id] = true
		}
		if out, err = removeRecords(out, gone); err != nil {
			return nil, err
		}
	}
	if len(rows) == 0 {
		return out, nil
	}
	return setRecords(out, rows)
}

// LoadLiftTable reads the client's TransportAnimation.dbc as the game will see it, Meld's patch and a
// save waiting for the game to close included.
func LoadLiftTable(dataDir string) ([]byte, error) {
	set, err := mpq.OpenDataDir(dataDir)
	if err != nil {
		return nil, err
	}
	defer set.Close()
	return readOverlay(set, dataDir, TransportAnimationPath)
}

// LiftSQL writes a new lift's template into the world database: a type 11 row (patch 0, the client's
// lifts' flags) when the entry has none, then every patch row of the entry takes the name, model and
// size.
func LiftSQL(e LiftEdit) (string, error) {
	name, err := templateName(e.Name)
	if err != nil {
		return "", err
	}
	var b strings.Builder
	fmt.Fprintf(&b, "INSERT IGNORE INTO `gameobject_template` (`entry`, `patch`, `type`, `displayId`, `name`, `flags`, `size`) VALUES (%d, 0, %d, %d, %s, %d, %s);\n",
		e.Entry, objectTypeLift, e.DisplayID, name, liftFlags, num32(e.Size))
	fmt.Fprintf(&b, "UPDATE `gameobject_template` SET `displayId` = %d, `name` = %s, `size` = %s WHERE `entry` = %d AND `type` = %d;\n",
		e.DisplayID, name, num32(e.Size), e.Entry, objectTypeLift)
	return b.String(), nil
}

// LiftEntryType is the type of game object entry's template (its newest patch), -1 when the world
// database has none.
func LiftEntryType(serverRoot string, entry uint32) (int, error) {
	db, err := openWorld(serverRoot)
	if err != nil {
		return 0, err
	}
	raw, err := runSQL(db, fmt.Sprintf("SELECT COALESCE((SELECT `type` FROM `gameobject_template` WHERE `entry` = %d ORDER BY `patch` DESC LIMIT 1), -1)", entry))
	if err != nil {
		return 0, err
	}
	s := strings.TrimSpace(string(raw))
	if s == "-1" {
		return -1, nil
	}
	return int(atou(s)), nil
}

// InstallServerLifts writes TransportAnimation.dbc into the server's data (data/5875/dbc), keeping the
// first copy it replaces as a backup.
func InstallServerLifts(serverDir string, dbc []byte) (string, error) {
	return installServerDBC(serverDir, "TransportAnimation.dbc", dbc)
}
