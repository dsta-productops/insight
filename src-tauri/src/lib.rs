use std::process::Child;
use std::sync::Mutex;

use tauri::{App, Manager, RunEvent};

/// Fixed local ports for the bundled backends. A desktop app is single-instance,
/// so fixed ports are fine (revisit with a free-port scan if collisions bite).
const NODE_PORT: u16 = 3000;
const LLAMA_PORT: u16 = 8080;

/// Child processes we spawn (Next server, llama-server) so we can kill them when
/// the app exits — otherwise they orphan and keep holding ports + the GPU.
struct Backends(Mutex<Vec<Child>>);

/// Build the main window in Rust (instead of tauri.conf.json) so we can attach a
/// navigation handler. The window loads REMOTE http content from the bundled
/// Node server, so the page itself can't use the JS Tauri API. That's why the
/// "test script" link is a plain same-window `<a href="/test-script">`: we
/// intercept that navigation here, cancel it, and pop the test script into its
/// own window instead — the operator reads it while the live view keeps running
/// in the main window. Everything else navigates normally.
fn build_main_window(app: &App) -> tauri::Result<()> {
  let handle = app.handle().clone();
  tauri::WebviewWindowBuilder::new(
    app,
    "main",
    // Dev serves here directly; a packaged build loads nothing useful until the
    // readiness thread navigates it to the bundled server, and it stays hidden
    // until then, so this initial URL is only ever seen in dev.
    tauri::WebviewUrl::External("http://localhost:3000".parse().expect("static url")),
  )
  .title("INSIGHT")
  .inner_size(1280.0, 832.0)
  .min_inner_size(1024.0, 700.0)
  .center()
  .resizable(true)
  .visible(false)
  .on_navigation(move |url| {
    if url.path() == "/test-script" {
      let h = handle.clone();
      let target = url.clone();
      // Defer to the main thread to avoid reentrancy inside the nav callback.
      let _ = handle.run_on_main_thread(move || {
        if let Some(w) = h.get_webview_window("test-script") {
          let _ = w.show();
          let _ = w.set_focus();
        } else if let Err(e) = tauri::WebviewWindowBuilder::new(
          &h,
          "test-script",
          tauri::WebviewUrl::External(target),
        )
        .title("INSIGHT · Test script")
        .inner_size(720.0, 900.0)
        .min_inner_size(420.0, 520.0)
        .resizable(true)
        .build()
        {
          log::error!("failed to open test-script window: {e}");
        }
      });
      return false; // keep the live view in the main window
    }

    // File downloads (Save As). The buttons on /sessions/[id] navigate to the
    // export/audio endpoints, which respond with `Content-Disposition:
    // attachment`. The main window loads REMOTE content, so the page can't use
    // the JS dialog/fs APIs — instead we intercept the navigation, fetch the
    // bytes from the local server, and let the operator pick a destination via
    // a native Save As panel. Matches: /api/sessions/<id>/export?format=...,
    // /api/sessions/<id>/recap?format=... (recap-only download), and
    // /api/sessions/<id>/audio?download=1 (the inline <audio> player loads
    // /audio WITHOUT download= as a subresource, so it never reaches here).
    let is_export = url.path().ends_with("/export") || url.path().ends_with("/recap");
    let is_audio_download =
      url.path().ends_with("/audio") && url.query().is_some_and(|q| q.contains("download"));
    if is_export || is_audio_download {
      let h = handle.clone();
      let dl_url = url.to_string();
      std::thread::spawn(move || {
        if let Err(e) = save_download(&h, &dl_url) {
          log::error!("save download failed for {dl_url}: {e}");
        }
      });
      return false; // we handle the download ourselves; don't navigate the view
    }

    true
  })
  .build()?;
  Ok(())
}

/// Fetch a download URL from the bundled local server and write it to a path the
/// operator chooses in a native Save As panel. Runs on a worker thread (the
/// dialog plugin dispatches the panel to the main thread internally, so calling
/// the blocking variant off the main thread is the correct, deadlock-free path).
fn save_download(
  app: &tauri::AppHandle,
  url: &str,
) -> Result<(), Box<dyn std::error::Error>> {
  use std::io::Read;
  use tauri_plugin_dialog::DialogExt;

  let resp = ureq::get(url).call()?;
  // Prefer the filename the server already computed (session slug / safe name).
  let filename = resp
    .header("Content-Disposition")
    .and_then(disposition_filename)
    .unwrap_or_else(|| "insight-download".to_string());

  let mut bytes: Vec<u8> = Vec::new();
  resp.into_reader().read_to_end(&mut bytes)?;

  // Blocking Save As: None if the operator cancels — nothing to do then.
  if let Some(target) = app
    .dialog()
    .file()
    .set_file_name(&filename)
    .blocking_save_file()
  {
    let path = target.into_path()?;
    std::fs::write(&path, &bytes)?;
  }
  Ok(())
}

/// Pull the filename out of a `Content-Disposition: attachment; filename="x"`
/// header value. Returns None if there's no usable name.
fn disposition_filename(value: &str) -> Option<String> {
  let after = value.split("filename=").nth(1)?;
  let name = after
    .split(';')
    .next()
    .unwrap_or(after)
    .trim()
    .trim_matches('"')
    .trim();
  if name.is_empty() {
    None
  } else {
    Some(name.to_string())
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .setup(|app| {
      app.manage(Backends(Mutex::new(Vec::new())));

      // Built hidden (build_main_window) so a packaged build never flashes a
      // connection error before its server is up.
      build_main_window(app)?;

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
        // In dev, `beforeDevCommand` (npm run dev) already serves the app via
        // `devUrl` — nothing to spawn; just reveal the window.
        if let Some(w) = app.get_webview_window("main") {
          let _ = w.show();
        }
      } else {
        // Packaged build: no external server exists, so start the bundled
        // Node + llama-server; the readiness thread reveals the window.
        if let Err(e) = start_backends(app) {
          log::error!("failed to start bundled backends: {e}");
          return Err(e);
        }
      }

      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app_handle, event| {
      // Reap the spawned backends on quit.
      if let RunEvent::Exit = event {
        if let Some(state) = app_handle.try_state::<Backends>() {
          if let Ok(mut children) = state.0.lock() {
            for child in children.iter_mut() {
              let _ = child.kill();
            }
          }
        }
      }
    });
}

/// On Windows, stop spawned console apps (node, llama-server) from flashing a
/// terminal window behind the app. No-op on macOS/Linux.
fn no_console_window(cmd: &mut std::process::Command) {
  #[cfg(windows)]
  {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    cmd.creation_flags(CREATE_NO_WINDOW);
  }
  #[cfg(not(windows))]
  {
    let _ = cmd;
  }
}

/// Launch the bundled backends from the app's read-only resource dir and point
/// the writable data at the OS app-data dir, then reveal the window once the
/// Next server answers on NODE_PORT.
fn start_backends(app: &App) -> Result<(), Box<dyn std::error::Error>> {
  use std::process::Command;

  let resource_dir = app.path().resource_dir()?;
  let data_dir = app.path().app_data_dir()?;
  std::fs::create_dir_all(&data_dir)?;

  let assets_dir = resource_dir.join("assets");
  let standalone_dir = resource_dir.join("standalone");
  let bin_dir = resource_dir.join("bin");

  // Bundled executables carry a .exe suffix on Windows. Keep the platform
  // difference in one place so the paths below stay readable.
  let exe = |name: &str| -> String {
    if cfg!(windows) {
      format!("{name}.exe")
    } else {
      name.to_string()
    }
  };
  let node_bin = bin_dir.join(exe("node"));
  let llama_bin = bin_dir.join(exe("llama-server"));
  let whisper_bin = bin_dir.join(exe("whisper-cli"));
  // macOS transcription shells out to the built-in `afconvert`; on Windows the
  // Node server uses this bundled ffmpeg instead (see lib/transcribe/providers.ts).
  let ffmpeg_bin = bin_dir.join(exe("ffmpeg"));
  let server_js = standalone_dir.join("server.js");
  let llama_model = assets_dir.join("models").join("llama-3.1-8b-instruct.gguf");

  // 1) Coach LLM: llama.cpp's OpenAI-compatible server.
  let mut llama_cmd = Command::new(&llama_bin);
  llama_cmd
    .arg("-m")
    .arg(&llama_model)
    .args(["--host", "127.0.0.1", "--port", &LLAMA_PORT.to_string()])
    .args(["-c", "4096"]);
  no_console_window(&mut llama_cmd);
  let llama = llama_cmd.spawn()?;

  // 2) The app itself: the Next standalone server. paths.ts reads the DATA/ASSETS
  //    env overrides; transcription reads WHISPER_CPP_BIN (+ FFMPEG_BIN off
  //    macOS); the coach reads SUGGEST_PROVIDER=llamacpp + LLAMACPP_URL.
  //    current_dir must be the standalone dir (Next's server.js resolves its
  //    assets relative to it).
  let mut node_cmd = Command::new(&node_bin);
  node_cmd
    .arg(&server_js)
    .current_dir(&standalone_dir)
    .env("PORT", NODE_PORT.to_string())
    .env("HOSTNAME", "127.0.0.1")
    .env("INSIGHT_DATA_DIR", &data_dir)
    .env("INSIGHT_ASSETS_DIR", &assets_dir)
    .env("SUGGEST_PROVIDER", "llamacpp")
    .env("LLAMACPP_URL", format!("http://127.0.0.1:{LLAMA_PORT}"))
    .env("TRANSCRIBE_PROVIDER", "local")
    .env("WHISPER_CPP_BIN", &whisper_bin)
    .env("FFMPEG_BIN", &ffmpeg_bin);
  no_console_window(&mut node_cmd);
  let node = node_cmd.spawn()?;

  if let Some(state) = app.try_state::<Backends>() {
    if let Ok(mut children) = state.0.lock() {
      children.push(llama);
      children.push(node);
    }
  }

  // 3) Wait for the Next server to accept connections, then show the window.
  let handle = app.handle().clone();
  std::thread::spawn(move || {
    let addr = format!("127.0.0.1:{NODE_PORT}");
    // ~60s budget; the first run pays model-load time.
    for _ in 0..300 {
      if std::net::TcpStream::connect(&addr).is_ok() {
        break;
      }
      std::thread::sleep(std::time::Duration::from_millis(200));
    }
    let show = handle.clone();
    let _ = handle.run_on_main_thread(move || {
      if let Some(w) = show.get_webview_window("main") {
        if let Ok(url) = tauri::Url::parse(&format!("http://127.0.0.1:{NODE_PORT}/")) {
          let _ = w.navigate(url);
        }
        let _ = w.show();
        let _ = w.set_focus();
      }
    });
  });

  Ok(())
}
