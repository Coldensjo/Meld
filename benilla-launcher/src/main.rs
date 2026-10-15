//! `meld-benilla`: Benilla as Meld starts it, built on top of Benilla through
//! [`benilla_app::run_with`], the way Benilla's `extended_launcher` example shows. It adds one
//! feature the 1.12.1 client lacks: [`hidden_login::HiddenLoginPlugin`], which keeps the window
//! hidden while a login from the environment passes the login, realm and character screens.
//!
//! On Windows it is a windowed program, so no console window opens beside the game. Its log still
//! goes wherever its output is sent: the terminal under `cargo run`, the log file Meld opens.

// No console of its own; inherited output handles still carry the log.
#![cfg_attr(windows, windows_subsystem = "windows")]

mod hidden_login;

use benilla_app::BuildId;

fn main() -> benilla_app::AppExit {
	benilla_app::run_with(
		BuildId {
			version: env!("CARGO_PKG_VERSION"),
			describe: env!("BENILLA_GIT_DESCRIBE"),
			sha: env!("BENILLA_GIT_SHA"),
			short: env!("BENILLA_GIT_SHORT"),
			date: env!("BENILLA_GIT_DATE"),
			profile: env!("BENILLA_PROFILE"),
			project_dir: env!("BENILLA_PROJECT_DIR"),
			..Default::default()
		},
		|app| {
			app.add_plugins(hidden_login::HiddenLoginPlugin::from_env());
		},
	)
}
