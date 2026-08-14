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
