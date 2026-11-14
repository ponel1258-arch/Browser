#![cfg_attr(all(windows, not(debug_assertions)), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    time::{Duration, Instant},
};
use tao::{
    dpi::{LogicalPosition, LogicalSize},
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy},
    window::{Window, WindowBuilder},
};
use url::Url;
use wry::{NewWindowResponse, PageLoadEvent, Rect, WebContext, WebView, WebViewBuilder};

const BAR_HEIGHT: u32 = 100;

#[derive(Debug, Deserialize)]
struct Command {
    action: String,
    value: Option<serde_json::Value>,
}
#[derive(Debug)]
enum Message {
    Command(Command),
    Loaded(u64, String),
    Title(u64, String),
    Popup(String),
    Started(u64),
    Download(u64, bool),
    Protected(u64),
    Sweep,
    SleepResult(u64, u64, bool, bool),
}

struct Tab {
    id: u64,
    title: String,
    view: Option<WebView>,
    history: Vec<String>,
    index: usize,
    pending: bool,
    loading: bool,
    sleeping: bool,
    protected: bool,
    downloads: usize,
    version: u64,
    last_active: Instant,
    restored: bool,
}
impl Tab {
    fn new(id: u64) -> Self {
        Self {
            id,
            title: "Новая вкладка".into(),
            view: None,
            history: vec![String::new()],
            index: 0,
            pending: false,
            loading: false,
            sleeping: false,
            protected: false,
            downloads: 0,
            version: 0,
            last_active: Instant::now(),
            restored: false,
        }
    }
    fn current(&self) -> &str {
        &self.history[self.index]
    }
    fn home(&self) -> bool {
        self.current().is_empty()
    }
    fn visit(&mut self, url: String) {
        if self.current() == url {
            return;
        }
        self.history.truncate(self.index + 1);
        self.history.push(url);
        self.index += 1;
    }
}
#[derive(Serialize)]
struct UiTab<'a> {
    id: u64,
    title: &'a str,
    sleeping: bool,
}
#[derive(Serialize)]
struct UiState<'a> {
    tabs: Vec<UiTab<'a>>,
    active: u64,
    home: bool,
    url: &'a str,
    can_back: bool,
    can_forward: bool,
    memory_saver: bool,
    light_theme: bool,
}

struct Browser {
    window: Window,
    #[cfg(target_os = "linux")]
    fixed: gtk::Fixed,
    chrome: WebView,
    context: WebContext,
    proxy: EventLoopProxy<Message>,
    tabs: Vec<Tab>,
    active: u64,
    next_id: u64,
    memory_saver: bool,
    light_theme: bool,
    settings_path: PathBuf,
}

fn to_url(value: &str) -> Option<String> {
    let text = value.trim();
    if text.is_empty() {
        return None;
    }
    if let Ok(url) = Url::parse(text) {
        if matches!(url.scheme(), "http" | "https") && url.host().is_some() {
            return Some(url.into());
        }
    }
    let authority = text.split(['/', '?', '#']).next().unwrap_or("");
    let looks_local = authority == "localhost"
        || authority.starts_with("localhost:")
        || authority.starts_with("127.0.0.1");
    let looks_domain =
        authority.contains('.') && !text.contains(char::is_whitespace) && !text.contains("://");
    if looks_local || looks_domain {
        let prefix = if looks_local { "http" } else { "https" };
        if let Ok(url) = Url::parse(&format!("{prefix}://{text}")) {
            if url.host().is_some() {
                return Some(url.into());
            }
        }
    }
    let mut search = Url::parse("https://www.google.com/search").expect("static URL");
    search.query_pairs_mut().append_pair("q", text);
    Some(search.into())
}
fn allowed_url(url: &str) -> bool {
    Url::parse(url)
        .map(|url| matches!(url.scheme(), "http" | "https") && url.host().is_some())
        .unwrap_or(false)
}

fn bounds(window: &Window, top: u32) -> Rect {
    let size = window.inner_size().to_logical::<u32>(window.scale_factor());
    Rect {
        position: LogicalPosition::new(0, top).into(),
        size: LogicalSize::new(size.width, size.height.saturating_sub(top)).into(),
    }
}
#[cfg(target_os = "linux")]
fn build_view(
    builder: WebViewBuilder<'_>,
    _window: &Window,
    fixed: &gtk::Fixed,
) -> wry::Result<WebView> {
    use wry::WebViewBuilderExtUnix;
    builder.build_gtk(fixed)
}
#[cfg(not(target_os = "linux"))]
fn build_view(builder: WebViewBuilder<'_>, window: &Window) -> wry::Result<WebView> {
    builder.build_as_child(window)
}

impl Browser {
    fn active_index(&self) -> usize {
        self.tabs
            .iter()
            .position(|tab| tab.id == self.active)
            .expect("active tab")
    }
    fn render(&self) {
        let tab = &self.tabs[self.active_index()];
        let state = UiState {
            tabs: self
                .tabs
                .iter()
                .map(|tab| UiTab {
                    id: tab.id,
                    title: &tab.title,
                    sleeping: tab.sleeping,
                })
                .collect(),
            active: self.active,
            home: tab.home(),
            url: tab.current(),
            can_back: tab.index > 0,
            can_forward: tab.index + 1 < tab.history.len(),
            memory_saver: self.memory_saver,
            light_theme: self.light_theme,
        };
        if let Ok(json) = serde_json::to_string(&state) {
            let _ = self.chrome.evaluate_script(&format!(
                "window.renderBrowser && window.renderBrowser({json})"
            ));
        }
    }
    fn resize(&self) {
        let _ = self.chrome.set_bounds(bounds(&self.window, 0));
        for tab in &self.tabs {
            if let Some(view) = &tab.view {
                let _ = view.set_bounds(bounds(&self.window, BAR_HEIGHT));
            }
        }
    }
    fn select(&mut self, id: u64) {
        if !self.tabs.iter().any(|tab| tab.id == id) {
            return;
        }
        if let Some(view) = self
            .tabs
            .iter()
            .find(|tab| tab.id == self.active)
            .and_then(|tab| tab.view.as_ref())
        {
            let _ = view.set_visible(false);
        }
        if let Some(tab) = self.tabs.iter_mut().find(|tab| tab.id == self.active) {
            tab.last_active = Instant::now();
            tab.version += 1;
        }
        self.active = id;
        let index = self.active_index();
        self.tabs[index].version += 1;
        if self.tabs[index].sleeping {
            let url = self.tabs[index].current().to_owned();
            self.tabs[index].restored = true;
            self.open(url);
        }
        let tab = &self.tabs[self.active_index()];
        if !tab.home() {
            if let Some(view) = &tab.view {
                let _ = view.set_visible(true);
                let _ = view.focus();
            }
        }
        self.render();
    }
    fn new_tab(&mut self) {
        let id = self.next_id;
        self.next_id += 1;
        self.tabs.push(Tab::new(id));
        self.select(id);
    }
    fn close_tab(&mut self, id: u64) {
        let Some(index) = self.tabs.iter().position(|tab| tab.id == id) else {
            return;
        };
        let was_active = self.active == id;
        self.tabs.remove(index);
        if self.tabs.is_empty() {
            self.new_tab();
        } else if was_active {
            self.active = self.tabs[index.min(self.tabs.len() - 1)].id;
            let selected = self.active;
            self.select(selected);
        } else {
            self.render();
        }
    }
    fn open(&mut self, url: String) {
        if !allowed_url(&url) {
            return;
        }
        let index = self.active_index();
        if self.tabs[index].view.is_none() {
            let id = self.active;
            let proxy_title = self.proxy.clone();
            let proxy_load = self.proxy.clone();
            let proxy_popup = self.proxy.clone();
            let proxy_permission = self.proxy.clone();
            let proxy_download_start = self.proxy.clone();
            let proxy_download_end = self.proxy.clone();
            let builder = WebViewBuilder::new_with_web_context(&mut self.context)
                .with_bounds(bounds(&self.window, BAR_HEIGHT))
                .with_clipboard(true)
                .with_permission_handler(move |_| {
                    let _ = proxy_permission.send_event(Message::Protected(id));
                    wry::PermissionResponse::Default
                })
                .with_download_started_handler(move |_, _| {
                    let _ = proxy_download_start.send_event(Message::Download(id, true));
                    true
                })
                .with_download_completed_handler(move |_, _, _| {
                    let _ = proxy_download_end.send_event(Message::Download(id, false));
                })
                .with_navigation_handler(|url| allowed_url(&url))
                .with_new_window_req_handler(move |url, _| {
                    if allowed_url(&url) {
                        let _ = proxy_popup.send_event(Message::Popup(url));
                    }
                    NewWindowResponse::Deny
                })
                .with_document_title_changed_handler(move |title| {
                    let _ = proxy_title.send_event(Message::Title(id, title));
                })
                .with_on_page_load_handler(move |event, url| match event {
                    PageLoadEvent::Started => {
                        let _ = proxy_load.send_event(Message::Started(id));
                    }
                    PageLoadEvent::Finished => {
                        let _ = proxy_load.send_event(Message::Loaded(id, url));
                    }
                })
                .with_url(&url);
            #[cfg(target_os = "linux")]
            let result = build_view(builder, &self.window, &self.fixed);
            #[cfg(not(target_os = "linux"))]
            let result = build_view(builder, &self.window);
            match result {
                Ok(view) => {
                    self.tabs[index].view = Some(view);
                    self.tabs[index].sleeping = false;
                }
                Err(error) => {
                    eprintln!("Не удалось открыть страницу: {error}");
                    return;
                }
            }
        } else if let Some(view) = &self.tabs[index].view {
            let _ = view.set_visible(true);
            if let Err(error) = view.load_url(&url) {
                eprintln!("Не удалось открыть страницу: {error}");
                return;
            }
        }
        self.tabs[index].visit(url);
        self.tabs[index].pending = true;
        self.tabs[index].title = "Загрузка…".into();
        self.render();
    }
    fn traverse(&mut self, offset: isize) {
        let index = self.active_index();
        let position = self.tabs[index].index as isize + offset;
        if position < 0 || position >= self.tabs[index].history.len() as isize {
            return;
        }
        self.tabs[index].index = position as usize;
        let url = self.tabs[index].current().to_owned();
        let tab = &mut self.tabs[index];
        if let Some(view) = &tab.view {
            if url.is_empty() {
                let _ = view.set_visible(false);
                tab.title = "Новая вкладка".into();
            } else {
                let _ = view.set_visible(true);
                if view.url().ok().as_deref() != Some(url.as_str()) {
                    tab.pending = true;
                    if tab.restored {
                        let _ = view.load_url(&url);
                    } else {
                        let script = if offset < 0 {
                            "history.back()"
                        } else {
                            "history.forward()"
                        };
                        let _ = view.evaluate_script(script);
                    }
                }
                let _ = view.focus();
            }
        }
        self.render();
    }
    fn request_sleep(&self, automatic: bool) {
        for tab in &self.tabs {
            if tab.id == self.active
                || tab.home()
                || tab.loading
                || tab.protected
                || tab.downloads > 0
                || (automatic && tab.last_active.elapsed() < Duration::from_secs(300))
            {
                continue;
            }
            if let Some(view) = &tab.view {
                let proxy = self.proxy.clone();
                let id = tab.id;
                let version = tab.version;
                // Inaccessible frames, media, editable regions and changed form fields keep a tab alive.
                let script = r#"(() => {
                  if (document.querySelector('iframe,frame,[contenteditable],video,audio')) return false;
                  return ![...document.querySelectorAll('input,textarea,select')].some(el => {
                    if (el.tagName === 'SELECT') return [...el.options].some(o => o.selected !== o.defaultSelected);
                    return el.value !== el.defaultValue || ('checked' in el && el.checked !== el.defaultChecked);
                  });
                })()"#;
                let _ = view.evaluate_script_with_callback(script, move |result| {
                    let _ = proxy.send_event(Message::SleepResult(
                        id,
                        version,
                        automatic,
                        result == "true",
                    ));
                });
            }
        }
    }
    fn handle(&mut self, message: Message) {
        match message {
            Message::Command(command) => match command.action.as_str() {
                "ready" => self.render(),
                "new_tab" => self.new_tab(),
                "toggle_theme" => {
                    self.light_theme = !self.light_theme;
                    if let Err(error) = std::fs::write(
                        &self.settings_path,
                        if self.light_theme { "light" } else { "dark" },
                    ) {
                        eprintln!("Не удалось сохранить тему: {error}");
                    }
                    self.render();
                }
                "toggle_saver" => {
                    self.memory_saver = !self.memory_saver;
                    self.render();
                }
                "sleep_tabs" => self.request_sleep(false),
                "select_tab" => {
                    if let Some(id) = command.value.and_then(|value| value.as_u64()) {
                        self.select(id);
                    }
                }
                "close_tab" => {
                    if let Some(id) = command.value.and_then(|value| value.as_u64()) {
                        self.close_tab(id);
                    }
                }
                "close_active" => self.close_tab(self.active),
                "navigate" => {
                    if let Some(url) = command
                        .value
                        .and_then(|value| value.as_str().and_then(to_url))
                    {
                        self.open(url);
                    }
                }
                "back" => self.traverse(-1),
                "forward" => self.traverse(1),
                "reload" => {
                    if let Some(view) = &self.tabs[self.active_index()].view {
                        if !self.tabs[self.active_index()].home() {
                            let _ = view.evaluate_script("location.reload()");
                        }
                    }
                }
                "home" => {
                    let index = self.active_index();
                    if !self.tabs[index].home() {
                        if let Some(view) = &self.tabs[index].view {
                            let _ = view.set_visible(false);
                        }
                        self.tabs[index].visit(String::new());
                        self.tabs[index].title = "Новая вкладка".into();
                        self.render();
                    }
                }
                _ => (),
            },
            Message::Sweep => {
                if self.memory_saver {
                    self.request_sleep(true);
                }
            }
            Message::Started(id) => {
                if let Some(tab) = self.tabs.iter_mut().find(|tab| tab.id == id) {
                    tab.loading = true;
                    tab.version += 1;
                }
            }
            Message::Download(id, started) => {
                if let Some(tab) = self.tabs.iter_mut().find(|tab| tab.id == id) {
                    if started {
                        tab.downloads += 1;
                    } else {
                        tab.downloads = tab.downloads.saturating_sub(1);
                    }
                    tab.version += 1;
                }
            }
            Message::Protected(id) => {
                if let Some(tab) = self.tabs.iter_mut().find(|tab| tab.id == id) {
                    tab.protected = true;
                    tab.version += 1;
                }
            }
            Message::SleepResult(id, version, automatic, safe) => {
                if safe && (!automatic || self.memory_saver) && id != self.active {
                    if let Some(tab) = self.tabs.iter_mut().find(|tab| tab.id == id) {
                        if tab.version == version
                            && !tab.loading
                            && !tab.protected
                            && tab.downloads == 0
                            && (!automatic || tab.last_active.elapsed() >= Duration::from_secs(300))
                            && tab.view.is_some()
                        {
                            tab.view.take();
                            tab.sleeping = true;
                            tab.pending = false;
                            tab.version += 1;
                        }
                    }
                }
                self.render();
            }
            Message::Popup(url) => {
                self.new_tab();
                self.open(url);
            }
            Message::Title(id, title) => {
                if let Some(tab) = self.tabs.iter_mut().find(|tab| tab.id == id) {
                    if !tab.home() && !title.is_empty() {
                        tab.title = title;
                    }
                }
                self.render();
            }
            Message::Loaded(id, url) => {
                if let Some(tab) = self.tabs.iter_mut().find(|tab| tab.id == id) {
                    tab.loading = false;
                    if !tab.home() && allowed_url(&url) {
                        if tab.pending {
                            tab.history[tab.index] = url;
                            tab.pending = false;
                        } else {
                            tab.visit(url);
                        }
                    }
                }
                self.render();
            }
        }
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let event_loop = EventLoopBuilder::<Message>::with_user_event().build();
    let proxy = event_loop.create_proxy();
    let window = WindowBuilder::new()
        .with_title("Luma")
        .with_inner_size(LogicalSize::new(1280.0, 800.0))
        .with_min_inner_size(LogicalSize::new(600.0, 400.0))
        .build(&event_loop)?;
    #[cfg(target_os = "linux")]
    let fixed = {
        use gtk::prelude::*;
        use tao::platform::unix::WindowExtUnix;
        let fixed = gtk::Fixed::new();
        window
            .default_vbox()
            .expect("GTK window")
            .pack_start(&fixed, true, true, 0);
        fixed.show_all();
        fixed
    };
    let html = include_str!("../ui/index.html")
        .replace("/*LUMA_STYLES*/", include_str!("../ui/style.css"))
        .replace("/*LUMA_SCRIPT*/", include_str!("../ui/app.js"));
    let proxy_ipc = proxy.clone();
    let builder = WebViewBuilder::new()
        .with_html(html)
        .with_bounds(bounds(&window, 0))
        .with_navigation_handler(|url| url == "about:blank")
        .with_ipc_handler(move |request| {
            if let Ok(command) = serde_json::from_str::<Command>(request.body()) {
                let _ = proxy_ipc.send_event(Message::Command(command));
            }
        });
    #[cfg(target_os = "linux")]
    let chrome = build_view(builder, &window, &fixed)?;
    #[cfg(not(target_os = "linux"))]
    let chrome = build_view(builder, &window)?;
    let profile = dirs::data_local_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("Luma")
        .join("web-data");
    std::fs::create_dir_all(&profile)?;
    let settings_path = profile.parent().expect("profile parent").join("theme");
    let light_theme =
        std::fs::read_to_string(&settings_path).is_ok_and(|value| value.trim() == "light");
    let mut browser = Browser {
        window,
        #[cfg(target_os = "linux")]
        fixed,
        chrome,
        context: WebContext::new(Some(profile)),
        proxy,
        tabs: vec![Tab::new(1)],
        active: 1,
        next_id: 2,
        memory_saver: true,
        light_theme,
        settings_path,
    };
    let timer_proxy = browser.proxy.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(30));
        if timer_proxy.send_event(Message::Sweep).is_err() {
            break;
        }
    });
    event_loop.run(move |event, _, control| {
        *control = ControlFlow::Wait;
        match event {
            Event::UserEvent(message) => browser.handle(message),
            Event::WindowEvent {
                event: WindowEvent::Resized(_) | WindowEvent::ScaleFactorChanged { .. },
                ..
            } => browser.resize(),
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => *control = ControlFlow::Exit,
            _ => (),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn address_search_and_protocols() {
        assert_eq!(to_url("youtube.com").unwrap(), "https://youtube.com/");
        assert_eq!(
            to_url("localhost:3000/test").unwrap(),
            "http://localhost:3000/test"
        );
        assert_eq!(
            to_url("котики").unwrap(),
            "https://www.google.com/search?q=%D0%BA%D0%BE%D1%82%D0%B8%D0%BA%D0%B8"
        );
        assert!(to_url("javascript:alert(1)")
            .unwrap()
            .starts_with("https://www.google.com/search?"));
        assert!(!allowed_url("file:///etc/passwd"));
    }
    #[test]
    fn history_truncates_forward_entries() {
        let mut tab = Tab::new(1);
        tab.visit("https://a.test".into());
        tab.visit("https://b.test".into());
        tab.index = 1;
        tab.visit("https://c.test".into());
        assert_eq!(tab.history, vec!["", "https://a.test", "https://c.test"]);
    }
}
