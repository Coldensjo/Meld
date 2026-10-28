package vmangos

import "testing"

func TestWithSoapEnabledChangesOnlyThatLine(t *testing.T) {
	cases := []struct {
		in, want string
		changed  bool
	}{
		{"A = 1\r\n#SOAP.Enabled = 1\r\nSOAP.Enabled = 0\r\nB = 2\r\n", "A = 1\r\n#SOAP.Enabled = 1\r\nSOAP.Enabled = 1\r\nB = 2\r\n", true},
		{"SOAP.Enabled = 1\nB\n", "SOAP.Enabled = 1\nB\n", false},
		{"A = 1\n#SOAP.Enabled = 0", "A = 1\n#SOAP.Enabled = 0\nSOAP.Enabled = 1\n", true},
		{"A\r\nB", "A\r\nB\r\nSOAP.Enabled = 1\r\n", true},
		{"  SOAP.Enabled=\"0\"\nX\n", "  SOAP.Enabled = 1\nX\n", true},
	}
	for _, c := range cases {
		got, changed := withSoapEnabled(c.in)
		if got != c.want || changed != c.changed {
			t.Errorf("%q: got %q, %v; want %q, %v", c.in, got, changed, c.want, c.changed)
		}
	}
}

func TestEnableSoapWritesTheConf(t *testing.T) {
	root := soapServer(t, "SOAP.Enabled = 0\n")
	if err := EnableSoap(root); err != nil {
		t.Fatal(err)
	}
	c, err := confSoap(root)
	if err != nil || !c.enabled {
		t.Fatalf("after EnableSoap: %+v, %v", c, err)
	}
}
