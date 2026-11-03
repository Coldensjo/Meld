package main

import "Meld/internal/records"

// reloadWorld has the world server, when it runs, read again what save wrote into the world database
// (records.Reloads), through its SOAP console, so the change is in the running game without a restart.
// It runs beside the save's reply (a console that doesn't answer takes seconds) and says in the
// status line what it did, or what makes the change take effect; with the server down it says
// nothing, since the server reads it all when it starts.
func (a *App) reloadWorld(save string, entries ...int) {
	cmds, restart := records.Reloads(save, entries...)
	if len(cmds) == 0 && restart == "" {
		return
	}
	if externalOn() {
		// The local world server doesn't read the external database (#856).
		return
	}
	sess, err := a.gameSession()
	if err != nil || !sess.WorldRunning() {
		return
	}
	go func() {
		msg, err := records.Reload(sess, save, entries...)
		if err != nil {
			a.logInfo(msg)
		}
		a.emit("server:reloaded", msg)
	}()
}
