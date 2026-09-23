# Windows installer and manual updates

Baseline: main `2a439524e580e24d3eb792b0e686deffc3878594`.

- Publish two Windows 11 x64 artifacts from every PR and merged release: the existing portable EXE and a current-user NSIS installer. Keep one SHA256SUMS.txt covering both.
- The installer opens with a Chinese choice page showing **安装** and **更新**. On a new machine, installation is selected and update is unavailable. If an existing per-user AIReader installation is found, update is selected and fresh installation is unavailable. A same-version run repairs program files. A newer installed version blocks a downgrade.
- Installation uses `%LOCALAPPDATA%\Programs\AIReader`, creates Windows shortcuts and an uninstall entry, and requires no administrator permission. Updates reuse the existing installation location. The portable build remains available and does not register an installation.
- The data directory remains `%LOCALAPPDATA%\AIReader`; install, update and uninstall preserve the library, notes, chats, account state and component downloads. A user who previously used only the portable EXE sees the same library in the installed build.
- The installer never downloads code or performs background updates. The user obtains a newer installer from the GitHub Release and selects Update. Existing application/installer version numbers are shown before continuing.
- CI runs real installation and a same-version repair/update in a clean Windows runner, checks registration and shortcuts, launches the installed app with a generated PDF, verifies data survival and uninstalls program files. It retains the portable smoke test and adds both EXEs to PR artifacts and Releases.
