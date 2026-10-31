package vmangos

import (
	"errors"
	"html"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

// fakeConsole is a SOAP console that records each command it gets and answers ok, or a fault for a
// command naming "Nobody", the way VMaNGOS answers a player it doesn't know.
func fakeConsole(t *testing.T, got *[]string) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		b, _ := io.ReadAll(r.Body)
		s := string(b)
		cmd := html.UnescapeString(s[strings.Index(s, "<command>")+len("<command>") : strings.Index(s, "</command>")])
		*got = append(*got, cmd)
		if strings.Contains(cmd, "Nobody") {
			w.WriteHeader(http.StatusInternalServerError)
			_, _ = io.WriteString(w, `<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Body><SOAP-ENV:Fault><faultstring>Player not found!</faultstring></SOAP-ENV:Fault></SOAP-ENV:Body></SOAP-ENV:Envelope>`)
			return
		}
		_, _ = io.WriteString(w, `<?xml version="1.0"?><SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ns1="urn:MaNGOS"><SOAP-ENV:Body><ns1:executeCommandResponse><result>done</result></ns1:executeCommandResponse></SOAP-ENV:Body></SOAP-ENV:Envelope>`)
	}))
	t.Cleanup(srv.Close)
	c := consoleAt(t, srv)
	return soapServer(t, "SOAP.Enabled = 1\nSOAP.IP = \""+c.host+"\"\nSOAP.Port = "+strconv.Itoa(c.port)+"\n")
}

// TestSetCharacterLevelSendsCharacterLevel checks the level command (#962): `.character level` with the
// name, since the console has no selection, and a level past 60 taken as 60.
func TestSetCharacterLevelSendsCharacterLevel(t *testing.T) {
	var got []string
	root := fakeConsole(t, &got)
	out, err := SetCharacterLevel(root, "gm", "pw", " Siz ", 63)
	if err != nil || out != "done" {
		t.Fatalf("got %q, %v", out, err)
	}
	if _, err := SetCharacterLevel(root, "gm", "pw", "Siz", 12); err != nil {
		t.Fatal(err)
	}
	if strings.Join(got, "|") != "character level Siz 60|character level Siz 12" {
		t.Fatalf("sent %q", got)
	}
	got = nil
	if _, err := SetCharacterLevel(root, "gm", "pw", "Nobody", 5); err == nil || !strings.Contains(err.Error(), "Player not found") {
		t.Fatalf("unknown player: %v", err)
	}
	got = nil
	for _, bad := range []struct {
		name  string
		level int
	}{{"Siz", 0}, {"", 5}, {"Two Words", 5}, {`Quo"te`, 5}} {
		if _, err := SetCharacterLevel(root, "gm", "pw", bad.name, bad.level); err == nil {
			t.Fatalf("%q at %d: no error", bad.name, bad.level)
		}
	}
	if _, err := SetCharacterLevel(root, "", "pw", "Siz", 5); err == nil {
		t.Fatal("no account: no error")
	}
	if got != nil {
		t.Fatalf("sent %q for a refused call", got)
	}
	if _, err := SetCharacterLevel(soapServer(t, "SOAP.Enabled = 0\n"), "gm", "pw", "Siz", 5); !errors.Is(err, ErrSoapOff) {
		t.Fatalf("console off: %v", err)
	}
}

// TestMailItemsSendsItems checks the item command (#962): `.send items` with the name, the letter's
// quoted subject and text, and item:count.
func TestMailItemsSendsItems(t *testing.T) {
	var got []string
	root := fakeConsole(t, &got)
	if _, err := MailItems(root, "gm", "pw", "Siz", 2589, 20); err != nil {
		t.Fatal(err)
	}
	if want := `send items Siz "From Meld" "Sent from Meld for testing." 2589:20`; len(got) != 1 || got[0] != want {
		t.Fatalf("sent %q, want %q", got, want)
	}
	got = nil
	if _, err := MailItems(root, "gm", "pw", "Siz", 0, 1); err == nil {
		t.Fatal("item 0: no error")
	}
	if _, err := MailItems(root, "gm", "pw", "Siz", 2589, 0); err == nil {
		t.Fatal("count 0: no error")
	}
	if got != nil {
		t.Fatalf("sent %q for a refused call", got)
	}
	if err := ConsoleReady(root); err != nil {
		t.Fatal(err)
	}
	if err := ConsoleReady(soapServer(t, "SOAP.Enabled = 0\n")); !errors.Is(err, ErrSoapOff) {
		t.Fatalf("console off: %v", err)
	}
}
