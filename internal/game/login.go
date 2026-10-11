package game

import (
	"errors"
	"time"

	"WorldEditor/internal/config"
)

// windowTitle is the client's window title, which the login is typed into.
const windowTitle = "World of Warcraft"

// settle is how long the login screen gets to draw after its window appears. It's a guess, not measured.
const settle = 3 * time.Second

// windowWait is how long to wait for the client's window to appear after it's started.
const windowWait = 90 * time.Second

// Virtual-key codes for the keys the login uses.
const (
	vkBack   = 0x08
	vkTab    = 0x09
	vkReturn = 0x0D
)

// clearLen is how many backspaces empty a login field. The client's fields hold 16 characters, and the
// spare backspaces do nothing on an empty field.
const clearLen = 32

// stroke is one key press: a virtual key, or a character when char is set.
type stroke struct {
	vk   uint16
	char rune
}

// loginStrokes is the key presses that log the client in: clear the account, type it, Tab to the
// password, clear it, type it, and press Enter.
func loginStrokes(l config.Login) []stroke {
	var s []stroke
	s = appendKeys(s, vkBack, clearLen)
	s = appendText(s, l.Account)
	s = append(s, stroke{vk: vkTab})
	s = appendKeys(s, vkBack, clearLen)
	s = appendText(s, l.Password)
	return append(s, stroke{vk: vkReturn})
}

func appendKeys(s []stroke, vk uint16, n int) []stroke {
	for range n {
		s = append(s, stroke{vk: vk})
	}
	return s
}

func appendText(s []stroke, text string) []stroke {
	for _, r := range text {
		s = append(s, stroke{char: r})
	}
	return s
}

// Login waits for the client's window, then types the account and password into its login screen.
// It only types while that window is in front, so the password can't reach another program.
func Login(l config.Login, log func(string)) error {
	hwnd := findWindow(windowTitle, windowWait)
	if hwnd == 0 {
		return errors.New("the World of Warcraft window did not appear")
	}
	time.Sleep(settle)
	if log != nil {
		log("Logging in as " + l.Account + "…")
	}
	return typeInto(hwnd, loginStrokes(l))
}
