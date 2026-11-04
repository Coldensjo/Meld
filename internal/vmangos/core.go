package vmangos

// Core is the server core an export writes its SQL for (#894). The editor reads and writes the
// VMaNGOS world database; another core only gets what an export writes (File › Export Spawn SQL), in
// its own schema. The server tools (the database editors, Game Login, Play here, launching) stay
// VMaNGOS-only.
type Core string

const (
	// VMaNGOS is the core the editor works with, and the default.
	VMaNGOS Core = "vmangos"
	// CMaNGOSClassic is CMaNGOS's 1.12 core (cmangos/mangos-classic), whose world database differs
	// from VMaNGOS's in its spawn tables: see cmangos.go.
	CMaNGOSClassic Core = "cmangos-classic"
	// AzerothCore is the 3.3.5a core azerothcore/azerothcore-wotlk (#1073), for a map made for a WotLK
	// client: see azerothcore.go.
	AzerothCore Core = "azerothcore"
)

// ParseCore is the core a setting names; anything unknown is VMaNGOS.
func ParseCore(s string) Core {
	switch c := Core(s); c {
	case CMaNGOSClassic, AzerothCore:
		return c
	}
	return VMaNGOS
}

// Title is the core's name in messages and in the SQL's header.
func (c Core) Title() string {
	switch c {
	case CMaNGOSClassic:
		return "CMaNGOS classic"
	case AzerothCore:
		return "AzerothCore"
	}
	return "VMaNGOS"
}
