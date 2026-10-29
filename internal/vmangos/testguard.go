package vmangos

import (
	"fmt"
	"os"
	"testing"
)

// testDatabaseEnv is the variable a Go test sets, through testclient.AllowDatabase (which
// testclient.ServerDir calls), to let the mariadb runners reach a real database. It must match
// testclient.DatabaseEnv; vmangos does not import the test helper package.
const testDatabaseEnv = "MELD_TEST_DATABASE"

// guardTestDatabase panics when a Go test reaches a real mariadb call it did not ask for: a test that
// stands in runSQL but forgets pipeMariadb (or shutdownDatabase) would otherwise run its script on the
// machine's own databases, as one deleted a character and an account there (#884, #885). A panic
// rather than an error, so a caller that swallows the error still fails the test. Outside tests it
// does nothing.
func guardTestDatabase(what string) {
	if testing.Testing() && os.Getenv(testDatabaseEnv) == "" {
		panic(fmt.Sprintf("a test ran a real %s without asking for the database: stand in runSQL, pipeMariadb and shutdownDatabase, or call testclient.AllowDatabase in a live test (#885)", what))
	}
}
