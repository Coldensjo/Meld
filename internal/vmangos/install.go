package vmangos

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"WorldEditor/internal/mpq"
)

// PatchName is the client's patch archive that map edits go into. The VMaNGOS tools read
// patch-3 through patch-9 for the server's map data, so it's the one the server sees too.
const PatchName = "patch-3.MPQ"

// IronforgeMarker is the file Ironforge's exports carry. Its patch is replaced by WorldEditor's,
// after a backup, since WorldEditor takes over the same job.
const IronforgeMarker = "(ironforge)"

// BackupSuffix is added to an existing patch before WorldEditor first replaces it.
const BackupSuffix = ".before-worldeditor"

// CheckServer reports whether dir looks like a VMaNGOS server folder: it has the configuration and
// the map data the update script writes.
func CheckServer(dir string) error {
	if _, err := os.Stat(filepath.Join(dir, "run", "mangosd.conf")); err != nil {
		return fmt.Errorf("%s has no run/mangosd.conf: not a VMaNGOS server folder", dir)
	}
	if info, err := os.Stat(filepath.Join(dir, "data")); err != nil || !info.IsDir() {
		return fmt.Errorf("%s has no data folder", dir)
	}
	return nil
}

// InstallPatch writes files as the client's patch archive in its Data folder. An archive that
// WorldEditor or Ironforge wrote is replaced (Ironforge's after a backup); any other patch-3 is
// left alone, since it may be the game's. Returns the archive's path.
func InstallPatch(dataDir string, files []mpq.File) (string, error) {
	target := filepath.Join(dataDir, PatchName)
	if _, err := os.Stat(target); err == nil {
		owner, err := archiveOwner(target)
		if err != nil {
			return "", fmt.Errorf("cannot read %s: %w", PatchName, err)
		}
		switch owner {
		case "":
			return "", fmt.Errorf("%s is not a patch WorldEditor or Ironforge wrote; move it out of the Data folder first", PatchName)
		case IronforgeMarker:
			if err := backup(target, target+BackupSuffix); err != nil {
				return "", err
			}
		}
	}

	// Written beside the target and renamed over it, so a failed write leaves the old patch.
	tmp := target + ".tmp"
	if err := os.WriteFile(tmp, mpq.Write(files), 0o644); err != nil {
		return "", err
	}
	if err := os.Rename(tmp, target); err != nil {
		os.Remove(tmp)
		return "", err
	}
	return target, nil
}

// archiveOwner returns the marker of an archive WorldEditor or Ironforge wrote, or "" for any other.
func archiveOwner(path string) (string, error) {
	a, err := mpq.Open(path)
	if err != nil {
		return "", err
	}
	defer a.Close()
	switch {
	case a.Has(mpq.MarkerName):
		return mpq.MarkerName, nil
	case a.Has(IronforgeMarker):
		return IronforgeMarker, nil
	}
	return "", nil
}

// backup copies src to dst unless dst exists already, so the first backup is kept.
func backup(src, dst string) error {
	if _, err := os.Stat(dst); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(dst)
		return err
	}
	return out.Close()
}
