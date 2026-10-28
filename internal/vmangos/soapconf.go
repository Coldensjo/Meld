package vmangos

import (
	"os"
	"path/filepath"
	"strings"
)

// EnableSoap sets SOAP.Enabled = 1 in the server's mangosd.conf and leaves every other byte of the file
// as it was: the line is changed in place when the conf has one (a commented `#SOAP.Enabled` is not
// that line), else added at the end. It does nothing when SOAP is on already. The running world
// server reads the conf only at its start, so it must be restarted for this to count.
func EnableSoap(serverRoot string) error {
	conf := filepath.Join(serverRoot, "run", "mangosd.conf")
	b, err := os.ReadFile(conf)
	if err != nil {
		return err
	}
	out, changed := withSoapEnabled(string(b))
	if !changed {
		return nil
	}
	return os.WriteFile(conf, []byte(out), 0o644)
}

// withSoapEnabled is EnableSoap's edit of the conf's text; changed is false when it is on already.
func withSoapEnabled(text string) (out string, changed bool) {
	lines := strings.SplitAfter(text, "\n")
	for i, line := range lines {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "#") {
			continue
		}
		k, v, ok := strings.Cut(t, "=")
		if !ok || strings.TrimSpace(k) != "SOAP.Enabled" {
			continue
		}
		if strings.Trim(strings.TrimSpace(v), `"`) == "1" {
			return text, false
		}
		body := strings.TrimRight(line, "\r\n")
		eol := line[len(body):]
		lead := body[:len(body)-len(strings.TrimLeft(body, " \t"))]
		lines[i] = lead + "SOAP.Enabled = 1" + eol
		return strings.Join(lines, ""), true
	}
	eol := "\n"
	if strings.Contains(text, "\r\n") {
		eol = "\r\n"
	}
	if text != "" && !strings.HasSuffix(text, "\n") {
		text += eol
	}
	return text + "SOAP.Enabled = 1" + eol, true
}
