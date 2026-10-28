package vmangos

import (
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// soapServer is a server folder whose mangosd.conf names the databases and sets the SOAP console.
func soapServer(t *testing.T, soap string) string {
	t.Helper()
	root := characterServer(t)
	conf := filepath.Join(root, "run", "mangosd.conf")
	b, err := os.ReadFile(conf)
	if err != nil {
		t.Fatal(err)
	}
	b = append(b, "WorldDatabase.Info = \"127.0.0.1;3307;mangos;mangos;mangos\"\n"+soap...)
	if err := os.WriteFile(conf, b, 0o644); err != nil {
		t.Fatal(err)
	}
	return root
}

func TestConfSoapReadsTheConsole(t *testing.T) {
	root := soapServer(t, "#SOAP.Enabled = 1\nSOAP.Enabled = 1\nSOAP.IP = 0.0.0.0\nSOAP.Port = 7979\n")
	c, err := confSoap(root)
	if err != nil {
		t.Fatal(err)
	}
	if !c.enabled || c.host != "127.0.0.1" || c.port != 7979 {
		t.Fatalf("got %+v", c)
	}
	off, err := confSoap(soapServer(t, "SOAP.Enabled = 0\n"))
	if err != nil {
		t.Fatal(err)
	}
	if off.enabled || off.port != 7878 {
		t.Fatalf("got %+v", off)
	}
}

// consoleAt is the SOAP console of the test server srv.
func consoleAt(t *testing.T, srv *httptest.Server) soapConsole {
	t.Helper()
	host, port, err := net.SplitHostPort(strings.TrimPrefix(srv.URL, "http://"))
	if err != nil {
		t.Fatal(err)
	}
	p, _ := strconv.Atoi(port)
	return soapConsole{enabled: true, host: host, port: p}
}

func TestSoapCommandSendsTheCommand(t *testing.T) {
	var got string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		user, pass, ok := r.BasicAuth()
		if !ok || user != "gm" || pass != "pw" {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		b, _ := io.ReadAll(r.Body)
		got = string(b)
		if strings.Contains(got, "bad") {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = io.WriteString(w, `<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault><faultcode>SOAP-ENV:Client</faultcode><faultstring>Player not found!</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`)
			return
		}
		_, _ = io.WriteString(w, `<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:MaNGOS"><SOAP-ENV:Body><ns1:executeCommandResponse><result>Teleporting Siz to meld_here.&#xD;
</result></ns1:executeCommandResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`)
	}))
	defer srv.Close()
	c := consoleAt(t, srv)

	out, err := soapCommand(c, "gm", "pw", "tele name Siz <meld_here>")
	if err != nil {
		t.Fatal(err)
	}
	if out != "Teleporting Siz to meld_here." {
		t.Fatalf("result %q", out)
	}
	if !strings.Contains(got, "<ns1:executeCommand><command>tele name Siz &lt;meld_here&gt;</command>") {
		t.Fatalf("request %s", got)
	}
	if _, err := soapCommand(c, "gm", "pw", "tele name bad meld_here"); err == nil || !strings.Contains(err.Error(), "Player not found!") {
		t.Fatalf("fault: %v", err)
	}
	if _, err := soapCommand(c, "gm", "wrong", "reload game_tele"); err == nil || !strings.Contains(err.Error(), "password") {
		t.Fatalf("refused: %v", err)
	}
}

func TestSoapCommandSaysWhenNothingAnswers(t *testing.T) {
	srv := httptest.NewServer(http.NotFoundHandler())
	c := consoleAt(t, srv)
	srv.Close()
	if _, err := soapCommand(c, "gm", "pw", "server info"); err != errSoapClosed {
		t.Fatalf("got %v", err)
	}
}

func TestTeleportCharacterMovesTheCharacter(t *testing.T) {
	root := soapServer(t, "SOAP.Enabled = 1\n")
	oldSQL, oldSoap := runSQL, soapCommand
	defer func() { runSQL, soapCommand = oldSQL, oldSoap }()
	online := "1"
	var tele string
	runSQL = func(db worldDB, sql string) ([]byte, error) {
		switch {
		case db.name == "characters" && strings.HasPrefix(sql, "SELECT online"):
			return []byte(online + "\n"), nil
		case db.name == "mangos" && strings.Contains(sql, "game_tele"):
			tele = sql
			return nil, nil
		}
		t.Fatalf("query on %s: %s", db.name, sql)
		return nil, nil
	}
	var sent []string
	soapCommand = func(c soapConsole, account, password, command string) (string, error) {
		if account != "gm" || password != "pw" || c.port != 7878 {
			t.Fatalf("console %+v as %s", c, account)
		}
		sent = append(sent, command)
		return "", nil
	}
	spot := CharacterSpot{Map: 1, X: -1000.5, Y: 2000.25, Z: 30, O: 1.5}
	if err := TeleportCharacter(root, "gm", "pw", "Siz", spot); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(tele, "DELETE FROM game_tele WHERE name = 'meld_here'") || !strings.Contains(tele, "-1000.5, 2000.25, 30, 1.5, 1, 'meld_here'") {
		t.Fatalf("game_tele SQL: %s", tele)
	}
	if strings.Join(sent, "|") != "reload game_tele|tele name Siz meld_here" {
		t.Fatalf("commands %q", sent)
	}

	online, sent = "0", nil
	if err := TeleportCharacter(root, "gm", "pw", "Siz", spot); err == nil || !strings.Contains(err.Error(), "isn't in the world") || len(sent) > 0 {
		t.Fatalf("offline: %v, sent %q", err, sent)
	}
}

func TestTeleportCharacterNeedsSoap(t *testing.T) {
	root := soapServer(t, "SOAP.Enabled = 0\n")
	err := TeleportCharacter(root, "gm", "pw", "Siz", CharacterSpot{})
	if err != ErrSoapOff {
		t.Fatalf("got %v", err)
	}
}
