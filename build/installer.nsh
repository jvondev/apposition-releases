!macro customHeader
  !define MUI_TEXT_WELCOME_INFO_TITLE "Welcome to Apposition"
  !define MUI_TEXT_WELCOME_INFO_TEXT "Setup will guide you through the installation of Apposition.$\r$\n$\r$\nClick Next to choose your installation directory, or install immediately."
  !define MUI_TEXT_DIRECTORY_TITLE "Choose Installation Location"
  !define MUI_TEXT_DIRECTORY_SUBTITLE "Select the destination folder for Apposition."
!macroend

!macro customInit
  nsProcess::_KillProcess "Apposition.exe"
  nsProcess::_KillProcess "Apposition App.exe"
  nsProcess::_KillProcess "Apposition Dev.exe"
!macroend

!macro customUnInit
  nsProcess::_KillProcess "Apposition.exe"
  nsProcess::_KillProcess "Apposition App.exe"
  nsProcess::_KillProcess "Apposition Dev.exe"
!macroend
