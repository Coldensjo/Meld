package vmangos

import (
	"strings"
	"testing"
)

// TestRunnersRefuseAnUnaskedCall checks that the mariadb runners panic in a test that did not call
// testclient.AllowDatabase, before they start mariadb (#885). They point at port 1 all the same.
func TestRunnersRefuseAnUnaskedCall(t *testing.T) {
	t.Setenv(testDatabaseEnv, "")
	db := worldDB{host: "127.0.0.1", port: "1", user: "mangos", name: "mangos"}
	for name, call := range map[string]func(){
		"runSQL":           func() { _, _ = runSQL(db, "SELECT 1") },
		"pipeMariadb":      func() { _ = pipeMariadb(db.args(""), db.env(), "SELECT 1;") },
		"shutdownDatabase": func() { _ = shutdownDatabase(db) },
	} {
		func() {
			defer func() {
				if r, _ := recover().(string); !strings.Contains(r, "#885") {
					t.Errorf("%s did not refuse: %q", name, r)
				}
			}()
			call()
		}()
	}
}
