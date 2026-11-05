; INSIGHT NSIS installer hooks.
;
; makensis can't mmap a source file past ~512 MB ("Internal compiler error
; #12345: error mmapping file ... is out of range"), so scripts/
; prepare-bundle-windows.ps1 splits the large models into <=400 MB parts
; (<name>.000, .001, ...) which NSIS embeds fine. Here, after the files are laid
; down, we concatenate each model's parts back into the single file the app
; expects under <install>\assets\models\ and delete the parts.
;
; The base names below must match prepare-bundle-windows.ps1 (the GGUF name and
; the $WhisperModel default). Wired in via tauri.conf.json
; bundle.windows.nsis.installerHooks.

!macro INSIGHT_REASSEMBLE NAME
  ; copy /b with a wildcard concatenates the parts in name order (NTFS returns
  ; directory entries sorted, and the parts are zero-padded), producing the whole
  ; file. The destination name has no trailing ".NNN" so it never self-matches.
  ; (Relative jump, not LogicLib: this macro is inserted more than once, and
  ; LogicLib's line-based labels would collide across insertions.)
  nsExec::ExecToLog 'cmd /c copy /b /y "$INSTDIR\assets\models\${NAME}.0*" "$INSTDIR\assets\models\${NAME}"'
  Pop $0
  StrCmp $0 "0" +2 0   ; success: skip the error box, go straight to cleanup
    MessageBox MB_ICONSTOP "INSIGHT could not assemble a model file (${NAME}, error $0). The app may not start; please reinstall or contact support."
  Delete "$INSTDIR\assets\models\${NAME}.0*"
!macroend

!macro NSIS_HOOK_POSTINSTALL
  DetailPrint "Assembling the models (one-time, this can take a minute)..."
  !insertmacro INSIGHT_REASSEMBLE "llama-3.1-8b-instruct.gguf"
  !insertmacro INSIGHT_REASSEMBLE "ggml-large-v3-turbo-q5_0.bin"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; The assembled files are created after install, so they are not in the
  ; uninstall log; remove them (and any leftover parts) so uninstall leaves nothing.
  Delete "$INSTDIR\assets\models\llama-3.1-8b-instruct.gguf"
  Delete "$INSTDIR\assets\models\llama-3.1-8b-instruct.gguf.0*"
  Delete "$INSTDIR\assets\models\ggml-large-v3-turbo-q5_0.bin"
  Delete "$INSTDIR\assets\models\ggml-large-v3-turbo-q5_0.bin.0*"
!macroend
