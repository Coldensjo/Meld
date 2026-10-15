//! Opens the window in the world. With a login and a character in the environment (`WOW_USER`,
//! `WOW_PASS`, `WOW_CHAR`) Benilla passes the login, realm and character screens by itself, so
//! the window opens hidden and is shown once the character is in the world. The 1.12.1 client
//! always shows those screens, which is why this lives on top of Benilla and not in it.

use std::time::Duration;

use benilla_app::Objects;
use bevy::prelude::*;
use bevy::window::PrimaryWindow;

/// How long the window may stay hidden without the character entering the world. Past it, the
/// login has stopped at a dialog (a wrong password, a realm that is down, a character not on the
/// account), and the window is shown so the dialog can be read.
const REVEAL_AFTER: Duration = Duration::from_secs(30);

/// Hides the window until the character is in the world, when the environment logs in to one.
pub struct HiddenLoginPlugin {
	hide: bool,
}

impl HiddenLoginPlugin {
	/// Hides the window when `WOW_USER`, `WOW_PASS` and `WOW_CHAR` are all set and not empty.
	pub fn from_env() -> Self {
		Self {
			hide: logs_in_to_a_character(|key| std::env::var(key).ok()),
		}
	}
}

impl Plugin for HiddenLoginPlugin {
	fn build(&self, app: &mut App) {
		if !self.hide {
			return;
		}
		// The primary window is an entity once the app is built, and winit opens it only when the
		// app runs, so a window hidden here never shows the login screen at all.
		let world = app.world_mut();
		let mut windows = world.query_filtered::<&mut Window, With<PrimaryWindow>>();
		for mut window in windows.iter_mut(world) {
			window.visible = false;
		}
		app.init_resource::<Hidden>()
			.add_systems(Update, reveal.run_if(resource_exists::<Hidden>));
	}
}

/// Present while the window is hidden.
#[derive(Resource, Default)]
struct Hidden;

/// Shows the window once the character is in the world (Benilla's own player object exists), or
/// once [`REVEAL_AFTER`] has passed without it.
fn reveal(
	mut commands: Commands,
	objects: Objects,
	time: Res<Time<Real>>,
	mut windows: Query<&mut Window, With<PrimaryWindow>>,
) {
	let in_world = objects.player().is_some();
	if !should_reveal(in_world, time.elapsed()) {
		return;
	}
	if in_world {
		info!("meld-benilla: in the world, showing the window");
	} else {
		warn!(
			"meld-benilla: not in the world after {} s, showing the window",
			REVEAL_AFTER.as_secs()
		);
	}
	for mut window in &mut windows {
		window.visible = true;
		window.focused = true;
	}
	commands.remove_resource::<Hidden>();
}

/// Whether a login from the environment goes all the way into the world: an account, a password
/// and a character, none of them empty.
fn logs_in_to_a_character(var: impl Fn(&str) -> Option<String>) -> bool {
	["WOW_USER", "WOW_PASS", "WOW_CHAR"]
		.into_iter()
		.all(|key| var(key).is_some_and(|value| !value.is_empty()))
}

/// Whether the hidden window is shown now: in the world, or hidden for too long.
fn should_reveal(in_world: bool, hidden_for: Duration) -> bool {
	in_world || hidden_for >= REVEAL_AFTER
}

#[cfg(test)]
mod tests {
	use super::*;

	fn env<'a>(vars: &'a [(&str, &str)]) -> impl Fn(&str) -> Option<String> + 'a {
		move |key| {
			vars.iter()
				.find(|(k, _)| *k == key)
				.map(|(_, v)| v.to_string())
		}
	}

	#[test]
	fn a_login_to_a_character_hides_the_window() {
		let vars = [("WOW_USER", "1"), ("WOW_PASS", "1"), ("WOW_CHAR", "Sizaro")];
		assert!(logs_in_to_a_character(env(&vars)));
	}

	#[test]
	fn a_login_that_stops_at_a_screen_shows_it() {
		// Without a character the player picks one at character select, and without the
		// credentials types them at the login screen, so the window must show those screens.
		let no_char = [("WOW_USER", "1"), ("WOW_PASS", "1")];
		let empty_char = [("WOW_USER", "1"), ("WOW_PASS", "1"), ("WOW_CHAR", "")];
		let no_pass = [("WOW_USER", "1"), ("WOW_CHAR", "Sizaro")];
		assert!(!logs_in_to_a_character(env(&no_char)));
		assert!(!logs_in_to_a_character(env(&empty_char)));
		assert!(!logs_in_to_a_character(env(&no_pass)));
		assert!(!logs_in_to_a_character(env(&[])));
	}

	#[test]
	fn the_window_shows_in_the_world_or_after_the_wait() {
		assert!(!should_reveal(false, Duration::ZERO));
		assert!(!should_reveal(
			false,
			REVEAL_AFTER - Duration::from_millis(1)
		));
		assert!(should_reveal(true, Duration::from_secs(3)));
		assert!(should_reveal(false, REVEAL_AFTER));
	}
}
