package scripts

import (
	"errors"
	"fmt"
	"image"
	"image/png"
	"os"
	"path/filepath"
	"strings"
)

// The file functions of a script (#761): read_file, write_file, append_file, path_exists and image:save,
// as Noggit Red's are. A path is relative to the scripts folder, or a whole one. Reads go anywhere, as
// load_png does; writes stay inside the scripts folder unless the user's preference (passed with each
// call, never taken from the script) lets a script write any file.

// MaxReadBytes is the largest file read_file reads whole into the script (64 MB).
const MaxReadBytes = 64 << 20

// Resolve is the file a script's path names: the path itself when it is whole, else that path under dir
// (the scripts folder). A path with a drive but no root (C:x on Windows) is refused, as it would name a
// file relative to that drive's current folder.
func Resolve(dir, path string) (string, error) {
	if path == "" {
		return "", errors.New("no file named")
	}
	p := filepath.FromSlash(path)
	if filepath.IsAbs(p) {
		return filepath.Clean(p), nil
	}
	if filepath.VolumeName(p) != "" {
		return "", fmt.Errorf("%s names a drive without a folder", path)
	}
	return filepath.Join(dir, p), nil
}

// Inside tells whether file lies under dir (not dir itself), comparing the cleaned paths without
// following links.
func Inside(dir, file string) bool {
	rel, err := filepath.Rel(filepath.Clean(dir), filepath.Clean(file))
	if err != nil || rel == "." || filepath.IsAbs(rel) {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// WritePath is the file a script may write for path: inside dir, or anywhere when anyFile is set.
func WritePath(dir, path string, anyFile bool) (string, error) {
	file, err := Resolve(dir, path)
	if err != nil {
		return "", err
	}
	if !anyFile && !Inside(dir, file) {
		return "", fmt.Errorf("%s is outside the scripts folder (Edit › Preferences › General › Scripts may write any file allows it)", path)
	}
	return file, nil
}

// ReadFile reads the file path names, whole, as text.
func ReadFile(dir, path string) (string, error) {
	file, err := Resolve(dir, path)
	if err != nil {
		return "", err
	}
	st, err := os.Stat(file)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return "", fmt.Errorf("no such file: %s", path)
		}
		return "", err
	}
	if st.IsDir() {
		return "", fmt.Errorf("%s is a folder", path)
	}
	if st.Size() > MaxReadBytes {
		return "", fmt.Errorf("%s is over 64 MB", path)
	}
	b, err := os.ReadFile(file)
	return string(b), err
}

// Exists tells whether the file or folder path names is there.
func Exists(dir, path string) (bool, error) {
	file, err := Resolve(dir, path)
	if err != nil {
		return false, err
	}
	_, err = os.Stat(file)
	if err == nil {
		return true, nil
	}
	if errors.Is(err, os.ErrNotExist) {
		return false, nil
	}
	return false, err
}

// WriteFile writes text to the file path names (adding it at the end with appendTo), making the folders
// it lies in, as Noggit Red's write_file does.
func WriteFile(dir, path, text string, appendTo, anyFile bool) error {
	file, err := WritePath(dir, path, anyFile)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	flag := os.O_WRONLY | os.O_CREATE | os.O_TRUNC
	if appendTo {
		flag = os.O_WRONLY | os.O_CREATE | os.O_APPEND
	}
	f, err := os.OpenFile(file, flag, 0o644)
	if err != nil {
		return err
	}
	if _, err := f.WriteString(text); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

// SavePNG writes w by h RGBA pixels (a byte each, not premultiplied, row by row from the top) as a PNG,
// for image:save.
func SavePNG(dir, path string, w, h int, pix []byte, anyFile bool) error {
	if w <= 0 || h <= 0 || w*h > MaxImagePixels || len(pix) != w*h*4 {
		return fmt.Errorf("%d bytes for a %d×%d image", len(pix), w, h)
	}
	file, err := WritePath(dir, path, anyFile)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(file), 0o755); err != nil {
		return err
	}
	f, err := os.Create(file)
	if err != nil {
		return err
	}
	img := &image.NRGBA{Pix: pix, Stride: 4 * w, Rect: image.Rect(0, 0, w, h)}
	if err := png.Encode(f, img); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}
