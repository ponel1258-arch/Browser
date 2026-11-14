<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:8aa89f3ddfdeed2f775415ca14eb2ee8f9e7e33492553b0627fea838fe1f8b10 --><!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:0a503895ec649dc77c4e9856e79c4e83a2afb5818641dc5577972887c77ee407 -->



# Luma

Настольный браузер на Rust. На Windows использует системный Microsoft WebView2; на Linux — WebKitGTK. Поддерживает вкладки, адресную строку с поиском Google, переходы назад и вперёд, и быстрые ссылки.

## Windows

Установите [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) и Rust 1.93 или новее, затем выполните в PowerShell:

```powershell
cargo build --locked --release
.\target\release\luma.exe
```

Сборка MSVC статически включает загрузчик WebView2; пакет для Windows GNU должен содержать `WebView2Loader.dll` рядом с `luma.exe`.

## Linux

Установите Rust 1.93+, GTK 3, WebKitGTK 4.1 и инструменты сборки. В Ubuntu:

```sh
sudo apt install build-essential libwebkit2gtk-4.1-dev libgtk-3-dev libxdo-dev
cargo run --locked --release
```

Для воспроизведения некоторых видеоформатов могут понадобиться системные плагины GStreamer.

## Проверки

```sh
cargo test --locked
xvfb-run -a python3 native-tests/smoke.py
xvfb-run -a python3 native-tests/memory.py
```



<!-- /coderabbit-ai-generated:v1 --><!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:1bf5e01ea2c38f45b268fdc630317d845b319c867b9961bf3ebfc086e215dfff --><!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:af3f1340af3f7578352713308f62a34abafde33582e96e8095ddfc309653c89f -->



## Вкладки и экономия памяти

Неактивные вкладки без медиа, фреймов, изменённых полей и запросов доступа к устройствам могут выгружаться через пять минут. Кнопка `zᶻ` запускает проверку сразу; кнопка рядом включает и выключает автоматическую проверку. При возврате выгруженная страница загружается заново. Её адреса сохраняются, но внутреннее состояние сайта может быть потеряно.

Вкладки с медиа, фреймами, изменёнными полями и активными загрузками оставляются в памяти. Сайты могут хранить данные и другими способами: перед длительной работой с несохранёнными данными отключите автоусыпление.



<!-- /coderabbit-ai-generated:v1 --><!-- /coderabbit-ai-generated:v1 --><!-- coderabbit-ai-generated:v1 -->

<!-- coderabbit-ai-generated-section:v1:eb308b5a7bcda598e25b4768628439dd06e2601779a9d300a403820090598ec0 -->



## Ограничения

Это ранняя версия, а не полная замена Chrome: расширения, менеджер закладок, восстановление вкладок между запусками и синхронизация пока отсутствуют. История переходов внутри некоторых одностраничных сайтов может отслеживаться неполно. Восстановленные после усыпления страницы загружаются заново.

На Windows требуется установленный WebView2 Runtime. WebView2 использует отдельный профиль; куки и пароли Electron-версии не переносятся автоматически. Windows-сборка проверена кросс-компиляцией, но её запуск на Windows пока не проверен.

В проверенной Linux-среде WebKitGTK 2.52.6 аварийно завершился на странице видео YouTube; то же произошло с минимальным примером Wry. Домашняя страница YouTube открылась. Воспроизведение видео на Windows пока не проверено.

## Измерение памяти

`native-tests/memory.py` измеряет PSS процесса приложения и его дочерних процессов в Linux через `/proc`. Результаты зависят от окружения, открытых сайтов и общих системных библиотек и не являются оценкой расхода в Windows.



<!-- /coderabbit-ai-generated:v1 --><!-- /coderabbit-ai-generated:v1 -->