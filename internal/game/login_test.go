package game

import (
	"testing"

	"WorldEditor/internal/config"
)

func TestLoginStrokesTypeAccountThenPassword(t *testing.T) {
	s := loginStrokes(config.Login{Account: "ab", Password: "x"})
	var text []rune
	for _, k := range s {
		if k.char != 0 {
			text = append(text, k.char)
		}
	}
	if string(text) != "abx" {
		t.Fatalf("typed %q, want the account and then the password", string(text))
	}
	// The clear, Tab, clear and Enter keys frame the two fields.
	if s[0].vk != vkBack || s[clearLen-1].vk != vkBack {
		t.Fatal("the account field isn't cleared first")
	}
	tab := clearLen + 2
	if s[tab].vk != vkTab || s[tab+clearLen].vk != vkBack || s[tab+clearLen].char != 0 {
		t.Fatalf("Tab and the password clear are not where expected: %+v", s[tab:tab+2])
	}
	if s[tab+1+clearLen].char != 'x' {
		t.Fatalf("password is not typed after its clear: %+v", s[tab+1+clearLen])
	}
	if last := s[len(s)-1]; last.vk != vkReturn {
		t.Fatalf("last key = %+v, want Enter", last)
	}
}
