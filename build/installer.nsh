!macro customHeader
  !define MUI_TEXT_WELCOME_INFO_TITLE "Welcome to Apposition"
  !define MUI_TEXT_WELCOME_INFO_TEXT "Setup will guide you through the installation of Apposition.$\r$\n$\r$\nClick Next to choose your installation directory, or install immediately."
  !define MUI_TEXT_DIRECTORY_TITLE "Choose Installation Location"
  !define MUI_TEXT_DIRECTORY_SUBTITLE "Select the destination folder for Apposition."
!macroend

!macro customInit
  nsExec::Exec 'taskkill /F /IM Apposition.exe /T'
  nsExec::Exec 'taskkill /F /IM "Apposition Dev.exe" /T'
  nsExec::Exec 'taskkill /F /IM "Apposition App.exe" /T'
!macroend

!macro customUnInit
  nsExec::Exec 'taskkill /F /IM Apposition.exe /T'
  nsExec::Exec 'taskkill /F /IM "Apposition Dev.exe" /T'
  nsExec::Exec 'taskkill /F /IM "Apposition App.exe" /T'
!macroend
